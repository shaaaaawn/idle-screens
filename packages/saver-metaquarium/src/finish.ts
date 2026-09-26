/**
 * The finish (the Amano study, item 4): one full-screen pass over the frame —
 * a gentle grade, restrained bloom on devices that can afford it, and dither
 * so dark gradients stop banding on TV panels.
 *
 * The scene still draws to the canvas exactly as it always has; the finish
 * then copies that frame into a texture and draws over it. A render target
 * would not do: an sRGB target blends in linear space and treats the tank's
 * hand-rolled shaders differently, so the crystals and every additive glow
 * came out dimmer. Working on the finished frame, everything happens in
 * display space, on the very pixels the viewer would have seen. At
 * `finish: 0` the tank skips the pass entirely, so 0 is byte-identical.
 *
 *   grade   a touch of S-curve contrast, +8 % saturation, cool shadows and
 *           warm highlights (a few percent), and a soft vignette.
 *   bloom   bright pass at half size, blurred down to 1/8 and back up (dual
 *           box filter, five small draws) — high tier only.
 *   dither  ±½ LSB of triangular noise after encoding: the fix for stepped
 *           dark gradients on 8-bit panels.
 */

import {
  Camera, FramebufferTexture, LinearFilter, Mesh, NoBlending, AdditiveBlending, OrthographicCamera, PlaneGeometry,
  Scene, ShaderMaterial, UnsignedByteType, Vector2, WebGLRenderTarget, type Object3D, type WebGLRenderer,
} from 'three';

export interface FinishOptions {
  /** Draw bloom (the high tier). */
  bloom: boolean;
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** 4-tap box at ±offset texels; `uThreshold` > 0 makes it the bright pass. */
const BOX = /* glsl */ `
  uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold;
  varying vec2 vUv;
  void main() {
    vec2 o = uTexel;
    vec3 c = 0.25 * (texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb
      + texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb);
    if (uThreshold > 0.0) {
      // Soft knee: only what is already near white blooms.
      float l = max(c.r, max(c.g, c.b));
      float k = clamp((l - uThreshold) / (1.0 - uThreshold), 0.0, 1.0);
      c *= k * k;
    }
    gl_FragColor = vec4(c, 1.0);
  }
`;

const COMPOSITE = /* glsl */ `
  uniform sampler2D tScene; uniform sampler2D tBloom;
  uniform float uAmount; uniform float uBloom; uniform vec2 uRes;
  varying vec2 vUv;
  float mqLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float mqRand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    // The finished frame, in display space: the grade is where "a touch of
    // contrast" means what it says, and the bloom adds like light on glass.
    vec3 g = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloom;
    float a = uAmount;
    g = mix(g, g * g * (3.0 - 2.0 * g), 0.18 * a);       // S-curve
    float l = mqLuma(g);
    g = mix(vec3(l), g, 1.0 + 0.08 * a);                  // saturation
    g += a * ((1.0 - l) * vec3(-0.004, 0.006, 0.012) + l * vec3(0.014, 0.006, -0.008)); // cool shadows, warm highlights
    vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y;
    g *= 1.0 - 0.2 * a * smoothstep(0.35, 0.95, length(q)); // vignette
    // Dither: triangular noise of ±1 LSB, no visible grain.
    float n = mqRand(gl_FragCoord.xy) + mqRand(gl_FragCoord.xy + 17.31) - 1.0;
    gl_FragColor = vec4(clamp(g, 0.0, 1.0) + n / 255.0, 1.0);
  }
`;

export class FinishPass {
  private frame = new FramebufferTexture(1, 1);
  private readonly half: WebGLRenderTarget;
  private readonly quarter: WebGLRenderTarget;
  private readonly eighth: WebGLRenderTarget;
  private readonly quad: Mesh;
  private readonly quadScene = new Scene();
  private readonly cam: Camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly box: ShaderMaterial;
  private readonly composite: ShaderMaterial;
  private readonly size = new Vector2();

  constructor(private readonly o: FinishOptions) {
    const small = (): WebGLRenderTarget => new WebGLRenderTarget(1, 1, { type: UnsignedByteType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
    this.half = small(); this.quarter = small(); this.eighth = small();
    this.box = new ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new Vector2() }, uThreshold: { value: 0 } },
      vertexShader: VERT, fragmentShader: BOX, depthTest: false, depthWrite: false, blending: NoBlending,
    });
    this.composite = new ShaderMaterial({
      uniforms: {
        tScene: { value: this.frame }, tBloom: { value: this.half.texture },
        uAmount: { value: 0 }, uBloom: { value: 0 }, uRes: { value: new Vector2(1, 1) },
      },
      vertexShader: VERT, fragmentShader: COMPOSITE, depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.box);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Draw `scene` through the finish. `raw` is the renderer's own render (the tank wraps it). */
  render(renderer: WebGLRenderer, raw: (s: Object3D, c: Camera) => void, scene: Object3D, camera: Camera, amount: number): void {
    raw(scene, camera);
    // Only a frame on the canvas is finished (a still drawn into a target is left alone).
    if (renderer.getRenderTarget() !== null) return;
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x)), h = Math.max(1, Math.floor(this.size.y));
    if (this.frame.image.width !== w || this.frame.image.height !== h) {
      this.frame.dispose();
      this.frame = new FramebufferTexture(w, h);
      this.frame.minFilter = LinearFilter; this.frame.magFilter = LinearFilter;
      this.composite.uniforms.tScene!.value = this.frame;
      this.half.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
      this.quarter.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
      this.eighth.setSize(Math.max(1, w >> 3), Math.max(1, h >> 3));
    }
    renderer.copyFramebufferToTexture(this.frame);
    const autoClear = renderer.autoClear;
    // The small passes clear (or add) themselves; the composite draws over the frame.
    renderer.autoClear = false;
    let bloom = 0;
    if (this.o.bloom) {
      bloom = 0.24 * amount;
      this.pass(renderer, raw, this.frame, this.half, 0.78, false);
      this.pass(renderer, raw, this.half, this.quarter, 0, false);
      this.pass(renderer, raw, this.quarter, this.eighth, 0, false);
      this.pass(renderer, raw, this.eighth, this.quarter, 0, true);
      this.pass(renderer, raw, this.quarter, this.half, 0, true);
    }
    const u = this.composite.uniforms;
    u.uAmount!.value = amount;
    u.uBloom!.value = bloom;
    (u.uRes!.value as Vector2).set(w, h);
    this.quad.material = this.composite;
    renderer.setRenderTarget(null);
    raw(this.quadScene, this.cam);
    renderer.autoClear = autoClear;
  }

  private pass(renderer: WebGLRenderer, raw: (s: Object3D, c: Camera) => void, src: WebGLRenderTarget | FramebufferTexture, dst: WebGLRenderTarget, threshold: number, add: boolean): void {
    const u = this.box.uniforms;
    const tex = 'texture' in src ? src.texture : src;
    const sw = 'texture' in src ? src.width : src.image.width, sh = 'texture' in src ? src.height : src.image.height;
    u.tSrc!.value = tex;
    (u.uTexel!.value as Vector2).set(1 / sw, 1 / sh);
    u.uThreshold!.value = threshold;
    this.box.blending = add ? AdditiveBlending : NoBlending;
    this.quad.material = this.box;
    renderer.setRenderTarget(dst);
    if (!add) renderer.clear(true, false, false);
    raw(this.quadScene, this.cam);
  }

  dispose(): void {
    for (const t of [this.half, this.quarter, this.eighth]) t.dispose();
    this.frame.dispose();
    this.box.dispose();
    this.composite.dispose();
    this.quad.geometry.dispose();
  }
}
