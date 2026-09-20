/**
 * Eye life. Every breed ships its eyes as two named materials — a white
 * sclera and a black pupil, each its own primitive — and until now they were
 * painted on. Four small tricks, all of them vertex offsets on those two
 * materials (no geometry, no draw calls, works on skinned fish because it
 * happens before skinning):
 *
 *   blink    both squash toward the eye line along the fish's up axis
 *   gaze     the pupil slides inside the sclera — ahead, behind, up, down
 *   dilate   the pupil grows or shrinks in the plane of the eye
 *   widen    the sclera opens a little (surprise)
 *
 * `eyeMood` decides WHEN, as a pure function of t and the fish's slot: blinks
 * on a personal clock (sometimes double), idle saccades — hold, dart, hold —
 * looking where it is going when it moves, a glance at the camera now and
 * then, eyes on whoever it is talking to, wide for a hop, shut for a rest.
 * That is where the personality is; the rig only moves vertices.
 */

import { Matrix4, Vector3, type Material, type Mesh, type MeshBasicMaterial, type Object3D, type SkinnedMesh } from 'three';

export interface EyeRig {
  /** blink 0..1 · gaze (-1..1 ahead, -1..1 up) · dilate ~0.7..1.5 · widen 0..1 */
  set(blink: number, gazeFwd: number, gazeUp: number, dilate: number, widen: number): void;
  /** False when a fish has one eye material only: it can blink but not look. */
  canLook: boolean;
}

interface EyeUniforms {
  uEyeC: { value: Vector3 }; uEyeUp: { value: Vector3 }; uEyeFwd: { value: Vector3 };
  uEyeA: { value: Vector3 }; // blink, dilate/widen scale, —
  uEyeGaze: { value: Vector3 };
}

const EYE_VERTEX = /* glsl */ `
  #include <begin_vertex>
  {
    vec3 d = transformed - uEyeC;
    float k = uEyeA.y - 1.0;
    d += uEyeUp * (dot(d, uEyeUp) * k) + uEyeFwd * (dot(d, uEyeFwd) * k);
    d -= uEyeUp * (dot(d, uEyeUp) * uEyeA.x);
    transformed = uEyeC + d + uEyeGaze;
  }
`;

/**
 * Find a fish's eyes and teach them to move. `body` is the cloned model
 * already scaled and yawed under `group`, whose +z is the fish's nose.
 * Returns null when the model has no eye materials (the tank then does
 * nothing, and the stock program is what compiles).
 */
export function rigEyes(group: Object3D, body: Object3D): EyeRig | null {
  group.updateMatrixWorld(true);
  const groupInv = new Matrix4().copy(group.matrixWorld).invert();
  const eyes: { u: EyeUniforms; pupil: boolean; reach: number }[] = [];
  let sclera = false, pupils = false;
  body.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as (Material & MeshBasicMaterial) | undefined;
    const kind = mat?.userData.mqEye as 'sclera' | 'pupil' | undefined;
    if (!mat || !kind) return;
    // Mesh-local → group space. A skinned mesh's vertices live in bind space.
    const skinned = (mesh as unknown as SkinnedMesh).isSkinnedMesh ? (mesh as unknown as SkinnedMesh) : null;
    const toGroup = skinned
      ? new Matrix4().copy(body.matrix).multiply(skinned.bindMatrix)
      : new Matrix4().multiplyMatrices(groupInv, mesh.matrixWorld);
    const toLocal = new Matrix4().copy(toGroup).invert();
    const up = new Vector3(0, 1, 0).transformDirection(toLocal);
    const fwd = new Vector3(0, 0, 1).transformDirection(toLocal);
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox!;
    const c = bb.min.clone().add(bb.max).multiplyScalar(0.5);
    const size = bb.max.clone().sub(bb.min);
    // How tall the eye is along the fish's up axis, in the mesh's own units.
    const tall = Math.abs(size.x * up.x) + Math.abs(size.y * up.y) + Math.abs(size.z * up.z);
    const u: EyeUniforms = {
      uEyeC: { value: c }, uEyeUp: { value: up }, uEyeFwd: { value: fwd },
      uEyeA: { value: new Vector3(0, 1, 0) }, uEyeGaze: { value: new Vector3() },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = 'uniform vec3 uEyeC; uniform vec3 uEyeUp; uniform vec3 uEyeFwd; uniform vec3 uEyeA; uniform vec3 uEyeGaze;\n'
        + shader.vertexShader.replace('#include <begin_vertex>', EYE_VERTEX);
    };
    mat.customProgramCacheKey = () => 'mq-eye-v1';
    mat.needsUpdate = true;
    eyes.push({ u, pupil: kind === 'pupil', reach: tall });
    if (kind === 'pupil') pupils = true; else sclera = true;
  });
  if (!eyes.length) return null;
  // The pupil travels inside the sclera: a fraction of the WHITE's height.
  const white = eyes.find((e) => !e.pupil)?.reach ?? 0;
  const canLook = sclera && pupils;
  return {
    canLook,
    set(blink, gazeFwd, gazeUp, dilate, widen) {
      for (const e of eyes) {
        e.u.uEyeA.value.set(blink, e.pupil ? dilate : 1 + widen * 0.16, 0);
        if (e.pupil && canLook) {
          const r = white * 0.2;
          e.u.uEyeGaze.value.copy(e.u.uEyeFwd.value).multiplyScalar(gazeFwd * r).addScaledVector(e.u.uEyeUp.value, gazeUp * r * 0.8);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Mood: when the eyes do what. Pure in (t, slot) — deterministic like the swim.
// ---------------------------------------------------------------------------

export interface EyeCue {
  /** What the body is doing: a vignette gesture, 'moving', 'idle', or a swimmer's ''. */
  doing: string;
  /** Unit-ish: where the thing worth looking at is, in the fish's own frame (ahead, up). Null = nothing. */
  target: { fwd: number; up: number } | null;
  /** Same frame: where the camera is. */
  camera: { fwd: number; up: number };
  /** Vertical intent of the swim (-1..1): pupils lead a climb or a dive. */
  climb: number;
}

export interface EyeState { blink: number; gazeFwd: number; gazeUp: number; dilate: number; widen: number }

const hash = (n: number): number => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const bell = (u: number): number => (u <= 0 || u >= 1 ? 0 : Math.sin(u * Math.PI));
const ease = (u: number): number => { const c = Math.min(1, Math.max(0, u)); return c * c * (3 - 2 * c); };

export function eyeMood(tSec: number, slot: number, cue: EyeCue, amount: number, out: EyeState): EyeState {
  // Blink: a personal period; one in four is a double.
  const period = 3.1 + hash(slot * 9.7) * 3.6;
  const bt = tSec / period + hash(slot * 3.3);
  const n = Math.floor(bt), into = (bt - n) * period;
  let blink = bell(into / 0.17);
  if (hash(n * 5.1 + slot) > 0.75) blink = Math.max(blink, bell((into - 0.32) / 0.17));
  blink *= 0.93;

  // Idle saccades: hold a point, dart to the next. Steps, not drift — the dart
  // takes 90 ms, the hold 1.1–2.6 s, which is what reads as attention.
  const hold = 1.1 + hash(slot * 1.9) * 1.5;
  const st = tSec / hold + hash(slot * 7.1) * 10;
  const si = Math.floor(st), k = ease((st - si) * hold / 0.09);
  const px = (hash((si - 1) * 2.3 + slot) - 0.5) * 1.6, py = (hash((si - 1) * 4.7 + slot) - 0.5) * 1.1;
  const nx = (hash(si * 2.3 + slot) - 0.5) * 1.6, ny = (hash(si * 4.7 + slot) - 0.5) * 1.1;
  let gx = px + (nx - px) * k, gy = py + (ny - py) * k;

  let dilate = 1 + Math.sin(tSec * 0.5 + slot * 2.1) * 0.05, widen = 0;
  const moving = cue.doing === 'moving' || cue.doing === '';
  if (moving) { gx = 0.75 + gx * 0.2; gy = cue.climb * 0.9 + gy * 0.2; } // looks where it is going
  if (cue.target && !moving) { gx = cue.target.fwd * 0.9 + gx * 0.12; gy = cue.target.up * 0.9 + gy * 0.12; }

  // A glance at the camera: every 8–15 s, 1.3 s long, eased in and out.
  const gp = 8 + hash(slot * 6.3) * 7;
  const gl = tSec / gp + hash(slot * 8.9);
  const glance = ease(bell(((gl - Math.floor(gl)) * gp) / 1.3) * 2.2);
  gx += (cue.camera.fwd - gx) * glance; gy += (cue.camera.up - gy) * glance;

  switch (cue.doing) {
    case 'hop': case 'spin': dilate = 1.38; widen = 1; break;
    case 'wiggle': dilate = 1.25; widen = 0.5; break;
    case 'talk': dilate = 1.1; break;
    case 'shake': dilate = 0.82; break;
    case 'peek': widen = 0.7; gx = Math.sin(tSec * 2.4) * 0.9; break;
    case 'bow': gy = -0.9; blink = Math.max(blink, 0.55); break;
    case 'rest': blink = 0.93; break; // asleep
  }
  const c = (v: number): number => Math.min(1, Math.max(-1, v));
  out.blink = blink * amount;
  out.gazeFwd = c(gx) * amount; out.gazeUp = c(gy) * amount;
  out.dilate = 1 + (dilate - 1) * amount; out.widen = widen * amount;
  return out;
}
