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

import { KNEE, SHOULDER_GLSL } from './highlights';
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
      // (A half-float source can be far past white: a shaft is a glow, not a flare.)
      c = min(c, vec3(1.5));
      float l = max(c.r, max(c.g, c.b));
      float k = clamp((l - uThreshold) / (1.0 - uThreshold), 0.0, 1.0);
      c *= k * k;
    }
    gl_FragColor = vec4(c, 1.0);
  }
`;

const COMPOSITE = /* glsl */ `
  uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tTiltQ; uniform sampler2D tTiltE;
  uniform float uAmount; uniform float uBloom; uniform vec2 uRes; uniform float uHighlights; uniform float uTilt;
  uniform sampler2D tDepth; uniform float uDof; uniform float uFocus; uniform float uNear; uniform float uFar;
  uniform float uAo; uniform float uFocal;
  #include <packing>
  float mqViewDepth(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
  // Ambient occlusion from the frame's depth alone: a pixel deeper than its neighbours on BOTH sides
  // (within a few units of world space) sits in a crevice — between voxels, under a ledge, where a
  // fish meets the sand — and takes less of the water's light. Pairs of opposite taps, so a plane
  // seen at a slant (one side nearer, the other farther) averages out and never darkens itself.
  // Six pairs on a spiral, turned per pixel (interleaved gradient noise) so the pattern does not band.
  float mqOcclusion(vec2 uv, float d0) {
    float R = 7.0;
    float px = R * uFocal / max(d0, 1.0);
    if (px < 1.5) return 0.0;
    float spin = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float occ = 0.0;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float a = spin + fi * 2.39996;
      float r = px * (0.25 + 0.75 * (fi + 0.5) / 6.0);
      vec2 o = vec2(cos(a), sin(a)) * r / uRes;
      float da = d0 - mqViewDepth(uv + o), db = d0 - mqViewDepth(uv - o);
      float dent = 0.5 * (da + db); // > 0: deeper than both sides
      float near = min(da, db);      // both sides nearer, not one edge in front
      occ += smoothstep(0.3, 2.0, dent) * smoothstep(0.0, 0.6, near) * (1.0 - smoothstep(R, 3.0 * R, max(da, db)));
    }
    return occ / 6.0;
  }
  varying vec2 vUv;
  ${SHOULDER_GLSL}
  float mqLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float mqRand(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    // The finished frame, in display space: the grade is where "a touch of
    // contrast" means what it says, and the bloom adds like light on glass.
    vec3 g = texture2D(tScene, vUv).rgb;
    if (uAo > 0.0) {
      float d0 = mqViewDepth(vUv);
      if (d0 < uFar * 0.8) g *= 1.0 - 0.55 * uAo * mqOcclusion(vUv, d0);
    }
    // Tilt-shift: in focus through a band across the middle, softer above and
    // below it — a quarter-size blur, then an eighth — the way a lens tilted
    // against a model village sees it. Before the bloom and the grade.
    if (uTilt > 0.0 || uDof > 0.0) {
      float b = smoothstep(0.08, 0.44, abs(vUv.y - 0.5)) * uTilt;
      // Depth of field: soft with distance from the focus — a little in front,
      // more behind (a lens's near field is narrower) — from the frame's own depth.
      if (uDof > 0.0) {
        float vz = -perspectiveDepthToViewZ(texture2D(tDepth, vUv).x, uNear, uFar);
        float off = vz - uFocus;
        // A band in focus round the subject (a cast is never all at one distance), then soft:
        // full by 1.2 x the focus distance behind, sooner in front (a lens's near field is narrower).
        float coc = off > 0.0 ? smoothstep(0.18, 1.2, off / uFocus) : smoothstep(0.15, 0.75, -off / uFocus);
        b = max(b, coc * uDof);
      }
      vec3 soft = mix(texture2D(tTiltQ, vUv).rgb, texture2D(tTiltE, vUv).rgb, smoothstep(0.45, 1.0, b));
      g = mix(g, soft, smoothstep(0.0, 0.55, b));
    }
    g += texture2D(tBloom, vUv).rgb * uBloom;
    // With highlights, the source is the half-float frame: what is past white
    // sits out the grade (its S-curve is for 0–1) and comes back for the shoulder.
    vec3 over = vec3(0.0);
    if (uHighlights > 0.0) { over = max(g - 1.0, 0.0); g = min(g, vec3(1.0)); }
    float a = uAmount;
    g = mix(g, g * g * (3.0 - 2.0 * g), 0.18 * a);       // S-curve
    float l = mqLuma(g);
    g = mix(vec3(l), g, 1.0 + 0.08 * a);                  // saturation
    g += a * ((1.0 - l) * vec3(-0.004, 0.006, 0.012) + l * vec3(0.014, 0.006, -0.008)); // cool shadows, warm highlights
    vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y;
    float vig = 1.0 - 0.2 * a * smoothstep(0.35, 0.95, length(q));
    g *= vig; // vignette
    if (uHighlights > 0.0) g = mqShoulder(g + over * vig, ${KNEE.toFixed(3)}, uHighlights);
    // Dither: triangular noise of ±1 LSB, no visible grain.
    float n = mqRand(gl_FragCoord.xy) + mqRand(gl_FragCoord.xy + 17.31) - 1.0;
    gl_FragColor = vec4(clamp(g, 0.0, 1.0) + n / 255.0, 1.0);
  }
`;

export class FinishPass {
  private frame = new FramebufferTexture(1, 1);
  private readonly half: WebGLRenderTarget;
  /** Tilt-shift's own blur chain (no bright pass): half, quarter, eighth. */
  private readonly tiltH: WebGLRenderTarget;
  private readonly tiltQ: WebGLRenderTarget;
  private readonly tiltE: WebGLRenderTarget;
  /** `tiltShift`, 0..1: set by the tank each frame. 0 skips the chain. */
  tilt = 0;
  /** `depthOfField`, 0..1, and where it focuses (view distance) with the camera's near and far: set by the tank. Needs a depth (renderFrom with a depth texture). */
  dof = 0;
  /** `ambientOcclusion`, 0..1 (needs a depth, as `dof` does), and the lens's focal length in pixels: set by the tank. */
  ao = 0;
  focal = 500;
  focus = 100;
  near = 1;
  far = 2000;
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
    this.tiltH = small(); this.tiltQ = small(); this.tiltE = small();
    this.box = new ShaderMaterial({
      uniforms: { tSrc: { value: null }, uTexel: { value: new Vector2() }, uThreshold: { value: 0 } },
      vertexShader: VERT, fragmentShader: BOX, depthTest: false, depthWrite: false, blending: NoBlending,
    });
    this.composite = new ShaderMaterial({
      uniforms: {
        tScene: { value: this.frame }, tBloom: { value: this.half.texture },
        uAmount: { value: 0 }, uBloom: { value: 0 }, uRes: { value: new Vector2(1, 1) }, uHighlights: { value: 0 },
        tTiltQ: { value: this.tiltQ.texture }, tTiltE: { value: this.tiltE.texture }, uTilt: { value: 0 },
        tDepth: { value: null }, uAo: { value: 0 }, uFocal: { value: 500 }, uDof: { value: 0 }, uFocus: { value: 100 }, uNear: { value: 1 }, uFar: { value: 2000 },
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
    this.compose(renderer, raw, null, amount, 0);
  }

  /**
   * Finish the frame `hdr` holds (the highlights pass's half-float buffer)
   * onto the canvas, its shoulder applied last — so the grade cannot push a
   * rolled-off highlight back into clipping.
   */
  renderFrom(renderer: WebGLRenderer, raw: (s: Object3D, c: Camera) => void, hdr: WebGLRenderTarget, amount: number, highlights: number): void {
    this.compose(renderer, raw, hdr, amount, highlights);
  }

  private compose(renderer: WebGLRenderer, raw: (s: Object3D, c: Camera) => void, hdr: WebGLRenderTarget | null, amount: number, highlights: number): void {
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
      this.tiltH.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
      this.tiltQ.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
      this.tiltE.setSize(Math.max(1, w >> 3), Math.max(1, h >> 3));
    }
    if (!hdr) renderer.copyFramebufferToTexture(this.frame);
    const src = hdr ?? this.frame;
    this.composite.uniforms.tScene!.value = hdr ? hdr.texture : this.frame;
    const autoClear = renderer.autoClear;
    // The small passes clear (or add) themselves; the composite draws over the frame.
    renderer.autoClear = false;
    let bloom = 0;
    if (this.o.bloom) {
      bloom = 0.24 * amount;
      this.pass(renderer, raw, src, this.half, 0.78, false);
      this.pass(renderer, raw, this.half, this.quarter, 0, false);
      this.pass(renderer, raw, this.quarter, this.eighth, 0, false);
      this.pass(renderer, raw, this.eighth, this.quarter, 0, true);
      this.pass(renderer, raw, this.quarter, this.half, 0, true);
    }
    const tilt = Math.max(0, Math.min(1, this.tilt));
    const depth = hdr?.depthTexture ?? null;
    const dof = depth ? Math.max(0, Math.min(1, this.dof)) : 0;
    const ao = depth ? Math.max(0, Math.min(1, this.ao)) : 0;
    if (tilt > 0 || dof > 0) {
      this.pass(renderer, raw, src, this.tiltH, 0, false);
      this.pass(renderer, raw, this.tiltH, this.tiltQ, 0, false);
      this.pass(renderer, raw, this.tiltQ, this.tiltE, 0, false);
    }
    const u = this.composite.uniforms;
    u.uTilt!.value = tilt;
    u.uDof!.value = dof;
    u.uAo!.value = ao;
    u.uFocal!.value = this.focal;
    u.tDepth!.value = depth;
    u.uFocus!.value = Math.max(1, this.focus);
    u.uNear!.value = this.near;
    u.uFar!.value = this.far;
    u.uAmount!.value = amount;
    u.uBloom!.value = bloom;
    u.uHighlights!.value = highlights;
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
    for (const t of [this.half, this.quarter, this.eighth, this.tiltH, this.tiltQ, this.tiltE]) t.dispose();
    this.frame.dispose();
    this.box.dispose();
    this.composite.dispose();
    this.quad.geometry.dispose();
  }
}
