/**
 * The swim wave. Most of the cast swims rigid: the angelfish's clip moves the
 * whole model as one piece, and the NPC fish only yaw. A real fish bends — a
 * wave runs from the head to the tail, small at the head and large at the
 * tail, about one body length long, and the body curls into a C through a
 * turn. That is this, as a vertex patch on every mesh of the fish.
 *
 * - The wave is written in the FISH's frame (the tank's fish group, where +z
 *   is the nose), so the body, the eyes and the glow shells bend together.
 *   Each mesh gets its own matrices into and out of that frame.
 * - Phase advances with distance swum (`beat`), so a fast fish beats fast
 *   and a gliding one slows — closed-form, like everything else.
 * - Which fish: not a model with a skeleton (the betafish already bends),
 *   and not a sea turtle, seahorse, crab or jellyfish (flippers, an upright
 *   body, legs, a bell — a sideways body wave is wrong on all of them).
 */

import { Box3, Matrix4, Vector2, Vector3, type Material, type Mesh, type Object3D, type SkinnedMesh } from 'three';
import { cloneWithHooks, hasPatch, stackPatch } from './hooks';

const NO_WAVE = new Set(['seaturtle', 'seahorse', 'crab', 'jellyfish']);

/** Whether a model should swim with a body wave. */
export function waveProfile(breed: string | null | undefined, model: Object3D): boolean {
  if (breed && NO_WAVE.has(breed)) return false;
  let bones = false;
  model.traverse((o) => { if ((o as { isBone?: boolean }).isBone) bones = true; });
  if (bones) return false;
  if (!breed) {
    // A custom model: only if it is longer than it is tall (not an upright one).
    const size = new Box3().setFromObject(model).getSize(new Vector3());
    return Math.max(size.x, size.z) > size.y * 0.8;
  }
  return true;
}

/** Tail beats per body length swum: a real fish covers ~0.7 of its length a beat. */
export const STRIDE = 0.7;
/** Wavelength of the body wave, in body lengths. */
export const WAVELENGTH = 0.95;

export interface WaveState { phase: number; amp: number; bend: number }

/**
 * The wave at this moment, from closed-form inputs only.
 * `beat` is distance swum (units), `length` the fish's length (units),
 * `flurry` 0..1 its maneuver effort, `turn` its signed turn rate
 * (radians per body length), `amount` the `swimWave` param.
 */
export function waveState(beat: number, length: number, flurry: number, turn: number, amount: number, out: WaveState): WaveState {
  out.phase = (beat / (length * STRIDE)) * Math.PI * 2;
  // Tail amplitude as a fraction of body length: ~8 % cruising, more when it works.
  out.amp = amount * (0.08 + 0.07 * Math.min(1, flurry));
  // The C-bend: a body lying along its own curved path. A point half a body
  // from the centre sits turn/8 of a length inside the tangent, nose and tail
  // alike; capped so a hairpin curls the fish rather than folding it.
  out.bend = amount * Math.max(-0.9, Math.min(0.9, turn * 0.5));
  return out;
}

/** Lateral offset (in body lengths) at `s` (0 nose → 1 tail). Mirrors the GLSL. */
export function waveOffset(s: number, w: WaveState): number {
  const env = 0.07 - 0.22 * s + 1.15 * s * s;
  return w.amp * env * Math.sin((s / WAVELENGTH) * Math.PI * 2 - w.phase) + w.bend * (s - 0.5) * (s - 0.5);
}

export const WAVE_TAG = 'mq-wave-v1';
const WAVE_PARS = 'uniform vec3 uWave; uniform vec2 uWaveBody; uniform mat4 uWaveTo; uniform mat4 uWaveFrom;\n';
// Runs just before projection: after skinning, morphs and the glow halos' push.
const WAVE_VERTEX = /* glsl */ `
  {
    vec3 p = (uWaveTo * vec4(transformed, 1.0)).xyz;
    float s = clamp((uWaveBody.x - p.z) / uWaveBody.y, 0.0, 1.0);
    float env = 0.07 - 0.22 * s + 1.15 * s * s;
    float lateral = uWave.y * env * sin(s / ${WAVELENGTH.toFixed(3)} * 6.2831853 - uWave.x) + uWave.z * (s - 0.5) * (s - 0.5);
    // Swing the tail sideways, and pull the swung part back a little so the
    // body keeps its length instead of stretching.
    p.x += lateral * uWaveBody.y;
    p.z += 0.5 * lateral * lateral * uWaveBody.y;
    transformed = (uWaveFrom * vec4(p, 1.0)).xyz;
  }
  #include <project_vertex>
`;

export interface WaveRig {
  set(w: WaveState): void;
  /** Re-attach where something replaced a material or its hook (the eye rig, tinting). Cheap when nothing changed. */
  ensure(): void;
  meshes: number;
}

/**
 * Rig one fish. `group` is the fish's group (its frame: +z nose), `body` the
 * cloned model under it, already scaled and yawed and at its rest pose. Every
 * mesh gets a material of its own: the wave's frame is per mesh, and a
 * template's texture atlas is shared by every fish of that breed.
 */
export function rigSwimWave(group: Object3D, body: Object3D): WaveRig | null {
  group.updateMatrixWorld(true);
  const groupInv = new Matrix4().copy(group.matrixWorld).invert();
  const meshes: Mesh[] = [];
  body.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh && m.geometry && !Array.isArray(m.material) && !(m as unknown as SkinnedMesh).isSkinnedMesh) meshes.push(m);
  });
  if (!meshes.length) return null;
  // The body's extent along the nose, in the fish frame. Halos are the same
  // geometry pushed out, so they do not change it.
  const box = new Box3(), v = new Vector3();
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    const to = new Matrix4().multiplyMatrices(groupInv, m.matrixWorld);
    const stride = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += stride) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(to));
  }
  if (box.isEmpty()) return null;
  const length = Math.max(1e-3, box.max.z - box.min.z);
  const wave = { value: new Vector3(0, 0, 0) };
  const bodyU = { value: new Vector2(box.max.z, length) };
  const seen = new Set<Material>();
  const parts = meshes.map((m) => {
    let mat = m.material as Material;
    // Clone when this fish already claimed it, when it is a template's shared
    // atlas, or when another fish's wave is already on it (its frame, not ours).
    if (seen.has(mat) || !mat.userData.mqOwned || hasPatch(mat, WAVE_TAG)) {
      mat = cloneWithHooks(mat);
      mat.userData.mqOwned = true;
      m.material = mat;
    }
    seen.add(mat);
    const to = new Matrix4().multiplyMatrices(groupInv, m.matrixWorld);
    return { m, uTo: { value: to }, uFrom: { value: to.clone().invert() } };
  });
  const attach = (p: (typeof parts)[number]): void => {
    stackPatch(p.m.material as Material, WAVE_TAG, (shader) => {
      // Idempotent: a chain that somehow runs the wave twice must not redeclare its uniforms.
      if (!shader.vertexShader.includes('#include <project_vertex>') || shader.vertexShader.includes('uWaveTo')) return;
      Object.assign(shader.uniforms, { uWave: wave, uWaveBody: bodyU, uWaveTo: p.uTo, uWaveFrom: p.uFrom });
      shader.vertexShader = WAVE_PARS + shader.vertexShader.replace('#include <project_vertex>', WAVE_VERTEX);
    });
  };
  for (const p of parts) attach(p);
  return {
    meshes: parts.length,
    set(w) { wave.value.set(w.phase, w.amp, w.bend); },
    ensure() { for (const p of parts) if (!hasPatch(p.m.material as Material, WAVE_TAG)) attach(p); },
  };
}
