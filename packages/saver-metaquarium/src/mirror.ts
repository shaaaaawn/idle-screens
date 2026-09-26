/**
 * The surface mirror (the Amano study's signature view): from under water the
 * surface is a window straight up and a mirror everywhere else. Inside
 * Snell's window — about 48.6° either side of straight up — you see through
 * to the light; outside it the surface totally internally reflects the tank
 * below, fish and all, rippling.
 *
 * High tier: the tank is drawn a second time, from a camera reflected in the
 * surface, into a half-size corner of the canvas, and copied out into a
 * texture (finish.ts's own trick — a render TARGET would make every material
 * compile a second, linear-output program and blend differently). An oblique
 * near plane clips the reflected view at the surface, as three's Reflector
 * does; clipping planes would recompile every program. Particles, shafts and
 * the surface itself sit on a layer the mirror camera does not see.
 *
 * The pass is SKIPPED when nothing mirrored could be on screen — the default
 * orbit looks at the fish, not at the sky, so it would be a second render of
 * pure fog. It pays off on the `surface` and `low` shots, steep orbits and a
 * follow camera near the top.
 *
 * Mid tier: the same window-and-mirror look, reflecting the floor-to-water
 * gradient instead of the tank — no second render. Low tier: off. A pixel
 * governor that has had to drop latches the second render off for good (the
 * governor oscillates; the mirror must not).
 */

import {
  Box3, FramebufferTexture, Frustum, LinearFilter, Matrix4, PerspectiveCamera, Plane, Vector2, Vector3, Vector4,
  type Camera, type Object3D, type WebGLRenderer,
} from 'three';

/** Objects on this layer are drawn by the main camera only (never mirrored). */
export const MIRROR_SKIP_LAYER = 3;
/** Water's refractive index: Snell's window is asin(1 / 1.333) either side of straight up. */
export const CRITICAL_ANGLE = Math.asin(1 / 1.333);

/**
 * The mirror camera for a surface at height `y`, seen from `camera` below it:
 * the camera reflected in the plane, looking at the reflection of what it
 * looks at, with `up` reflected too. Returns false when the camera is not
 * below the surface.
 */
export function reflectCamera(camera: PerspectiveCamera, y: number, out: PerspectiveCamera): boolean {
  camera.updateMatrixWorld();
  const pos = new Vector3().setFromMatrixPosition(camera.matrixWorld);
  if (pos.y >= y - 0.5) return false;
  const rot = new Matrix4().extractRotation(camera.matrixWorld);
  const look = new Vector3(0, 0, -1).applyMatrix4(rot).add(pos);
  const up = new Vector3(0, 1, 0).applyMatrix4(rot);
  out.position.set(pos.x, 2 * y - pos.y, pos.z);
  out.up.set(up.x, -up.y, up.z);
  out.lookAt(look.x, 2 * y - look.y, look.z);
  out.fov = camera.fov; out.aspect = camera.aspect; out.near = camera.near; out.far = camera.far;
  out.updateProjectionMatrix();
  out.updateMatrixWorld();
  // Oblique near plane at the surface (Lengyel; three's Reflector): only
  // what lies BELOW the surface — the tank — is drawn in the reflection.
  const plane = new Plane().setFromNormalAndCoplanarPoint(new Vector3(0, -1, 0), new Vector3(0, y, 0));
  plane.applyMatrix4(out.matrixWorldInverse);
  const clip = new Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  const p = out.projectionMatrix.elements;
  const q = new Vector4(
    (Math.sign(clip.x) + p[8]!) / p[0]!, (Math.sign(clip.y) + p[9]!) / p[5]!, -1, (1 + p[10]!) / p[14]!,
  );
  clip.multiplyScalar(2 / clip.dot(q));
  p[2] = clip.x; p[6] = clip.y; p[10] = clip.z + 1; p[14] = clip.w;
  out.projectionMatrixInverse.copy(out.projectionMatrix).invert();
  return true;
}

/** Could anything mirrored be on screen? The reflection of the swim volume, against the frustum. */
export function mirrorVisible(camera: Camera, surfaceY: number, radius: number, top: number): boolean {
  camera.updateMatrixWorld();
  const f = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const box = new Box3(new Vector3(-radius, 2 * surfaceY - top, -radius), new Vector3(radius, 2 * surfaceY, radius));
  return f.intersectsBox(box);
}

export class SurfaceMirror {
  /** What the ceiling samples: the copied reflection, and the matrix that projects a world point into it. */
  texture = new FramebufferTexture(1, 1);
  readonly textureMatrix = new Matrix4();
  private readonly cam = new PerspectiveCamera();
  private readonly size = new Vector2();
  private latchedOff = false;

  constructor() {
    this.cam.layers.set(0); // the mirror sees layer 0 only: MIRROR_SKIP objects stay out
    this.texture.minFilter = LinearFilter; this.texture.magFilter = LinearFilter;
  }

  /** Latch the second render off (the pixel governor has had to drop). */
  latchOff(): void { this.latchedOff = true; }
  get off(): boolean { return this.latchedOff; }

  /**
   * Draw the reflection for this frame into the texture, if it can be seen.
   * `raw` is the renderer's own render (never the finish wrapper).
   */
  render(renderer: WebGLRenderer, raw: (s: Object3D, c: Camera) => void, scene: Object3D, camera: PerspectiveCamera,
    surfaceY: number, bounds: { radius: number; top: number }): boolean {
    if (this.latchedOff || renderer.getRenderTarget() !== null) return false;
    if (!mirrorVisible(camera, surfaceY, bounds.radius, bounds.top)) return false;
    if (!reflectCamera(camera, surfaceY, this.cam)) return false;
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, Math.floor(this.size.x / 2)), h = Math.max(1, Math.floor(this.size.y / 2));
    if (this.texture.image.width !== w || this.texture.image.height !== h) {
      this.texture.dispose();
      this.texture = new FramebufferTexture(w, h);
      this.texture.minFilter = LinearFilter; this.texture.magFilter = LinearFilter;
    }
    const pr = renderer.getPixelRatio();
    const vp = new Vector4(), sc = new Vector4();
    renderer.getViewport(vp); renderer.getScissor(sc);
    const scissorTest = renderer.getScissorTest();
    renderer.setViewport(0, 0, w / pr, h / pr);
    renderer.setScissor(0, 0, w / pr, h / pr);
    renderer.setScissorTest(true);
    raw(scene, this.cam);
    renderer.copyFramebufferToTexture(this.texture);
    renderer.setViewport(vp); renderer.setScissor(sc); renderer.setScissorTest(scissorTest);
    // World → mirror texture: bias(0.5) · projection · view.
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(this.cam.projectionMatrix).multiply(this.cam.matrixWorldInverse);
    return true;
  }

  dispose(): void { this.texture.dispose(); }
}

/**
 * The ceiling's underside: Snell's window and total internal reflection.
 * Needs `vW` (world position), `vRipple` and the uniforms in `mirrorUniforms`.
 * `mqSurfaceUnderside(base)` returns rgb + alpha for a fragment seen from below.
 */
export const MIRROR_GLSL = /* glsl */ `
  uniform sampler2D tMirror;
  uniform mat4 uMirrorMatrix;
  // x: amount, y: 1 when this frame's reflection texture is valid, z: time
  uniform vec3 uMirror;
  uniform vec3 uMirrorDeep;   // display-space: what the mid tier reflects looking back down
  uniform vec3 uMirrorLit;    // display-space: the light seen through the window
  vec4 mqSurfaceUnderside(vec3 base, float baseAlpha) {
    vec3 V = normalize(vW - cameraPosition);           // looking up
    float cosi = clamp(V.y, 0.0, 1.0);                 // 1 straight up
    // Snell's window: clear inside ~48.6° of vertical (cos 0.661), a mirror outside.
    float tir = 1.0 - smoothstep(0.62, 0.70, cosi);
    float r0 = 0.02;
    float fres = r0 + (1.0 - r0) * pow(1.0 - cosi, 5.0);
    float F = max(fres, tir);
    // The ripple's slope (analytic, from the same ripple the vertex shader uses) bends the image.
    float t = uMirror.z;
    vec2 grad = vec2(
      0.012 * cos(vW.x * 0.012 + t * 0.5) * cos(vW.z * 0.014 - t * 0.37),
      -0.014 * sin(vW.x * 0.012 + t * 0.5) * sin(vW.z * 0.014 - t * 0.37));
    vec3 refl;
    if (uMirror.y > 0.5) {
      vec4 m = uMirrorMatrix * vec4(vW, 1.0);
      vec2 uv = m.xy / m.w + grad * 1.6;
      refl = texture2D(tMirror, clamp(uv, vec2(0.002), vec2(0.998))).rgb;
    } else {
      // Mid tier: the deep water mirrored, brighter toward the window's edge.
      refl = mix(uMirrorDeep, uMirrorLit, 0.25 * (1.0 - tir) + 0.1 * (0.5 + 0.5 * vRipple));
    }
    vec3 through = uMirrorLit * (0.9 + 0.2 * vRipple);
    vec3 col = mix(through, refl, F);
    float a = mix(baseAlpha, 0.94, uMirror.x * F);
    return vec4(mix(base, col, uMirror.x), a);
  }
`;
