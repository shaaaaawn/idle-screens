/**
 * Highlights: bright light rolls off instead of clipping.
 *
 * The tank draws in display space, and its light is additive: god rays,
 * the sunlit ceiling, crystal halos, glow shells and bloom cards all add on
 * top of each other. On an 8-bit canvas every sum past white is cut, so a
 * fish swimming into a shaft goes flat white, and bright water loses its
 * blue gradient channel by channel (reef-at-noon: over half the frame had a
 * channel at 255).
 *
 * This pass draws the tank into a half-float buffer that holds the very same
 * display-space values (see `displaySpace` below) but keeps whatever goes
 * past 1. A full-screen draw then puts it on the canvas with a shoulder:
 * below the knee nothing changes; above it the brightest channel is eased
 * towards white, the hue kept, so a shaft over a fish reads as glare with
 * the fish still in it. The cost: the top of the range (the knee to 1) is
 * compressed a little too.
 *
 * Off (0) the tank never makes the buffer, so 0 is the original draw. The
 * finish (finish.ts) still works on the canvas afterwards, as before.
 */

import {
  Camera, DepthTexture, HalfFloatType, UnsignedIntType, LinearFilter, Mesh, NoBlending, OrthographicCamera, PlaneGeometry, SRGBColorSpace,
  Scene, ShaderMaterial, Vector2, WebGLRenderTarget, type Object3D, type WebGLRenderer,
} from 'three';

/** Where the shoulder starts: the brightest channel's value below which nothing changes. */
export const KNEE = 0.86;

/**
 * The display-space pixel the canvas would show, before it clips: one
 * channel's shoulder (the GLSL below mirrors this). Slope 1 at the knee, so
 * there is no crease; approaches 1 and never reaches it. Rational, not
 * exponential: an exponential is white again by twice white, and a sunlit
 * shaft over bright sand is often three times it — this keeps a gradient there.
 */
export function shoulder(v: number, knee = KNEE): number {
  if (v <= knee) return v;
  const room = 1 - knee, x = (v - knee) / room;
  return knee + room * (x / (1 + x));
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** The shoulder in GLSL, shared with the finish (which applies it last, after its grade). */
export const SHOULDER_GLSL = /* glsl */ `
  vec3 mqShoulder(vec3 c, float knee, float amount) {
    c = max(c, vec3(0.0));
    float m = max(c.r, max(c.g, c.b));
    vec3 rolled = c;
    if (m > knee) {
      float room = 1.0 - knee;
      float x = (m - knee) / room;
      float mm = knee + room * (x / (1.0 + x));
      rolled = c * (mm / m);
      // Light far past white burns towards it, as film does: a little, and
      // only for what was well over (a shaft on a white fish, not the water).
      rolled = mix(rolled, vec3(mm), 0.35 * smoothstep(1.0, 3.0, m));
    }
    return mix(min(c, vec3(1.0)), rolled, amount);
  }
`;

const RESOLVE = /* glsl */ `
  uniform sampler2D tHdr; uniform float uAmount; uniform float uKnee;
  varying vec2 vUv;
  ${SHOULDER_GLSL}
  void main() { gl_FragColor = vec4(mqShoulder(texture2D(tHdr, vUv).rgb, uKnee, uAmount), 1.0); }
`;

/**
 * Make a render target hold display-space values, as the canvas does.
 *
 * three.js picks a program's output colour space and tone mapping from the
 * bound target: the canvas gets the renderer's sRGB output, any ordinary
 * target gets linear. Only a target flagged as an XR target is treated like
 * the canvas (its own texture's colour space, the renderer's tone mapping),
 * so that flag is what keeps every built-in material and every hand-rolled
 * shader on the same footing they have on screen. highlights.test.ts pins
 * this against the installed three.
 */
export function displaySpace(target: WebGLRenderTarget): WebGLRenderTarget {
  target.texture.colorSpace = SRGBColorSpace;
  (target as WebGLRenderTarget & { isXRRenderTarget: boolean }).isXRRenderTarget = true;
  return target;
}

/** Whether this renderer can draw into a half-float buffer (WebGL2 + EXT_color_buffer_float). */
export function canHoldHighlights(renderer: WebGLRenderer): boolean {
  return renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
}

export class HighlightPass {
  private target: WebGLRenderTarget | null = null;
  private readonly quadScene = new Scene();
  private readonly cam: Camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly resolve: ShaderMaterial;
  private readonly size = new Vector2();
  /** Keep the frame's depth too (`depthOfField` reads it): set by the tank; a change remakes the buffer. */
  withDepth = false;

  /** `samples`: MSAA samples for the buffer (0 where the canvas itself is not antialiased). */
  constructor(private readonly samples: number) {
    this.resolve = new ShaderMaterial({
      uniforms: { tHdr: { value: null }, uAmount: { value: 0 }, uKnee: { value: KNEE } },
      vertexShader: VERT, fragmentShader: RESOLVE, depthTest: false, depthWrite: false, blending: NoBlending, toneMapped: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.resolve);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  /** Draw `scene` with its highlights rolled off, onto the canvas. `raw` is the renderer's own render. */
  render(renderer: WebGLRenderer, raw: (s: Object3D, c: Camera) => void, scene: Object3D, camera: Camera, amount: number): void {
    // Only a frame for the canvas: the mirror, stills and captures draw into their own targets.
    if (renderer.getRenderTarget() !== null) { raw(scene, camera); return; }
    const u = this.resolve.uniforms;
    u.tHdr!.value = this.draw(renderer, raw, scene, camera).texture;
    u.uAmount!.value = amount;
    raw(this.quadScene, this.cam);
  }

  /** Draw `scene` into the half-float buffer and leave it there (the finish takes it from here). */
  draw(renderer: WebGLRenderer, raw: (s: Object3D, c: Camera) => void, scene: Object3D, camera: Camera): WebGLRenderTarget {
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x)), h = Math.max(1, Math.floor(this.size.y));
    if (this.target && !!this.target.depthTexture !== this.withDepth) this.release();
    if (!this.target) {
      this.target = displaySpace(new WebGLRenderTarget(w, h, {
        type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: true, stencilBuffer: false, samples: this.samples,
        ...(this.withDepth ? { depthTexture: new DepthTexture(w, h, UnsignedIntType) } : {}),
      }));
    } else if (this.target.width !== w || this.target.height !== h) {
      // The pixel governor rescales the canvas on the fly.
      this.target.setSize(w, h);
    }
    renderer.setRenderTarget(this.target);
    raw(scene, camera);
    renderer.setRenderTarget(null);
    return this.target;
  }

  /** Free the buffer (about 58 MB at the high tier) while the param is 0; the next frame remakes it. */
  release(): void {
    this.target?.depthTexture?.dispose();
    this.target?.dispose();
    this.target = null;
  }

  dispose(): void {
    this.target?.dispose();
    this.resolve.dispose();
    (this.quadScene.children[0] as Mesh).geometry.dispose();
  }
}
