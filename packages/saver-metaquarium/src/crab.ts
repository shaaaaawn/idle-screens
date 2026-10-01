/**
 * The crab, walking. A crab does not swim and does not wave: it walks
 * SIDEWAYS on eight legs, and its claws work the whole time. The bundled
 * crab is one rigid voxel model whose legs and claws are parts of the same
 * meshes, so — like the seahorse (seahorse.ts) — the motion is a vertex
 * patch in the fish's frame, on every mesh of it, fed once a frame.
 *
 * It already travels sideways: the tank lays every model along its longest
 * axis, and a crab is wider than it is long. So in the fish frame (+z the way
 * it travels, +y up) its legs reach out fore and aft along z, and its claws
 * are at one end of x — the rig finds which, from the claws' own material
 * (GLOW-claws). Fractions of that box:
 *
 *   lat   |z - centre| / half-depth: the body is the inner half, legs beyond
 *   up    height from the bottom: legs are the lower 70 %
 *   u     along x, back (0) to front (1): four legs a side, claws the front 26 %
 *
 * The gait is an alternating tetrapod, the way real crabs walk: each leg
 * lifts and reaches along the direction of travel in turn, the two sides in
 * opposite phase, its tip moving most; the body bobs once a step. It is
 * driven by DISTANCE walked (the wave state's phase), so a crab that stops
 * stops stepping and its feet never slide. The claws lift and pinch on their
 * own clock.
 */

import { Box3, Matrix4, Vector3, Vector4, type Material, type Mesh, type Object3D, type SkinnedMesh } from 'three';
import { cloneWithHooks, hasPatch, stackPatch } from './hooks';
import type { WaveRig, WaveState } from './swimwave';

export const CRAB = {
  /** Where the legs begin, out from the body (lat), and where they fade at the top (up). */
  legFrom: 0.42, legFull: 0.62, legTop: 0.7,
  /** The claws: the front of the crab. */
  clawFrom: 0.72,
  /** Steps per stride of the wave phase (a stride is ~a body length). */
  stepsPerStride: 3,
} as const;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The crab's pose inputs: gait phase (radians, from distance walked), seconds, how hard it walks, its own phase. */
export interface CrabState { gait: number; t: number; amount: number; phase: number }

/** Where a rest-pose point goes, in the fish frame — the GLSL below, in JS. `box` is [xMin, xLen, yMin, yLen, zCentre, zHalf]. */
export function crabPoint(p: Vector3, box: readonly [number, number, number, number, number, number], st: CrabState, out = new Vector3()): Vector3 {
  // box[1] (xl) is negative when the claws are at -x: u still runs back to front.
  const [x0, xl, y0, yl, zc, zh] = box;
  const x = p.x;
  let { y, z } = p;
  const lat = Math.abs(z - zc) / zh, up = (y - y0) / yl, u = (x - x0) / xl, side = z >= zc ? 1 : -1;
  const A = st.amount;
  // Legs: lift and reach in turn, the sides in opposite phase, tips most.
  const leg = smooth(CRAB.legFrom, CRAB.legFull, lat) * (1 - smooth(CRAB.legTop - 0.15, CRAB.legTop + 0.1, up)) * (1 - smooth(CRAB.clawFrom - 0.06, CRAB.clawFrom, u));
  const tip = smooth(CRAB.legFrom, 1, lat);
  const g = st.gait + Math.floor(u * 4) * (Math.PI / 2) + (side > 0 ? Math.PI : 0);
  y += A * 0.16 * yl * leg * tip * Math.max(0, Math.sin(g));
  z += A * 0.16 * zh * leg * tip * Math.cos(g);
  // Claws: lift and settle slowly, pinch now and then.
  const claw = smooth(CRAB.clawFrom - 0.04, CRAB.clawFrom + 0.06, u);
  const lift = 0.5 + 0.5 * Math.sin(st.t * 1.3 + st.phase);
  const pinch = Math.max(0, Math.sin(st.t * 2.7 + st.phase * 1.7)) ** 6;
  y += A * 0.12 * yl * claw * lift * smooth(0.3, 1, up + 0.3);
  z -= side * A * 0.07 * zh * claw * pinch * smooth(0.2, 0.8, lat);
  // The body bobs once a step.
  y += A * 0.025 * yl * Math.abs(Math.sin(st.gait));
  return out.set(x, y, z);
}

export const CRAB_TAG = 'mq-crab-v1';
const PARS = 'uniform vec4 uCrab; uniform vec3 uCrabBoxA; uniform vec3 uCrabBoxB; uniform mat4 uCrabTo; uniform mat4 uCrabFrom;\n';
const VERTEX = /* glsl */ `
  {
    vec3 p = (uCrabTo * vec4(transformed, 1.0)).xyz;
    float x0 = uCrabBoxA.x, xl = uCrabBoxA.y, y0 = uCrabBoxA.z, yl = uCrabBoxB.x, zc = uCrabBoxB.y, zh = uCrabBoxB.z;
    float gait = uCrab.x, t = uCrab.y, A = uCrab.z, ph = uCrab.w;
    float lat = abs(p.z - zc) / zh, up = (p.y - y0) / yl, u = (p.x - x0) / xl, side = p.z >= zc ? 1.0 : -1.0;
    float leg = smoothstep(${CRAB.legFrom.toFixed(3)}, ${CRAB.legFull.toFixed(3)}, lat)
      * (1.0 - smoothstep(${(CRAB.legTop - 0.15).toFixed(3)}, ${(CRAB.legTop + 0.1).toFixed(3)}, up))
      * (1.0 - smoothstep(${(CRAB.clawFrom - 0.06).toFixed(3)}, ${CRAB.clawFrom.toFixed(3)}, u));
    float tip = smoothstep(${CRAB.legFrom.toFixed(3)}, 1.0, lat);
    float g = gait + floor(u * 4.0) * 1.5707963 + (side > 0.0 ? 3.1415927 : 0.0);
    p.y += A * 0.16 * yl * leg * tip * max(0.0, sin(g));
    p.z += A * 0.16 * zh * leg * tip * cos(g);
    float claw = smoothstep(${(CRAB.clawFrom - 0.04).toFixed(3)}, ${(CRAB.clawFrom + 0.06).toFixed(3)}, u);
    float lift = 0.5 + 0.5 * sin(t * 1.3 + ph);
    float pinch = pow(max(0.0, sin(t * 2.7 + ph * 1.7)), 6.0);
    p.y += A * 0.12 * yl * claw * lift * smoothstep(0.3, 1.0, up + 0.3);
    p.z -= side * A * 0.07 * zh * claw * pinch * smoothstep(0.2, 0.8, lat);
    p.y += A * 0.025 * yl * abs(sin(gait));
    transformed = (uCrabFrom * vec4(p, 1.0)).xyz;
  }
  #include <project_vertex>
`;

/** A crab's rig: a wave rig that also knows where its feet are. */
export interface CrabRig extends WaveRig {
  /** The lowest point of the model at rest, in the group's own (unscaled) units: it stands with this on the ground. */
  foot: number;
  /** The middle of its footprint, in the same units: the model is not centred on the group. */
  middle: { x: number; z: number };
  /** The footprint's size, same units: `x` across the crab (claws to back), `z` along its walk. */
  span: { x: number; z: number };
}

/**
 * Rig one crab. Same contract as `rigSwimWave` / `rigSeahorse`: `group` is
 * the fish's group (+z the way it travels), `body` the model under it at
 * its rest yaw. `set` reads the wave state's
 * phase (distance walked) and `t` (seconds).
 */
export function rigCrab(group: Object3D, body: Object3D, phase: number): CrabRig | null {
  group.updateMatrixWorld(true);
  const groupInv = new Matrix4().copy(group.matrixWorld).invert();
  const meshes: Mesh[] = [];
  body.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh && m.geometry && !Array.isArray(m.material) && !(m as unknown as SkinnedMesh).isSkinnedMesh) meshes.push(m);
  });
  if (!meshes.length) return null;
  const box = new Box3(), v = new Vector3();
  for (const m of meshes) {
    const pos = m.geometry.getAttribute('position');
    const to = new Matrix4().multiplyMatrices(groupInv, m.matrixWorld);
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(to));
  }
  if (box.isEmpty()) return null;
  // Which end of x the claws are at: their material's centroid. u runs back
  // to front, so if they are at -x the box is read from max.x, length negated.
  let clawX = 0, clawN = 0;
  for (const m of meshes) {
    if (!/claw/i.test((m.material as Material).name ?? '')) continue;
    const pos = m.geometry.getAttribute('position');
    const to = new Matrix4().multiplyMatrices(groupInv, m.matrixWorld);
    for (let i = 0; i < pos.count; i++) { clawX += v.fromBufferAttribute(pos, i).applyMatrix4(to).x; clawN += 1; }
  }
  const front = clawN && clawX / clawN < (box.min.x + box.max.x) / 2 ? -1 : 1;
  const len = Math.max(1e-3, box.max.x - box.min.x);
  const boxA = { value: new Vector3(front > 0 ? box.min.x : box.max.x, front * len, box.min.y) };
  const boxB = { value: new Vector3(Math.max(1e-3, box.max.y - box.min.y), (box.min.z + box.max.z) / 2, Math.max(1e-3, (box.max.z - box.min.z) / 2)) };
  const crab = { value: new Vector4(0, 0, 0, phase) };
  const seen = new Set<Material>();
  const parts = meshes.map((m) => {
    let mat = m.material as Material;
    if (seen.has(mat) || !mat.userData.mqOwned || hasPatch(mat, CRAB_TAG)) {
      mat = cloneWithHooks(mat);
      mat.userData.mqOwned = true;
      m.material = mat;
    }
    seen.add(mat);
    const to = new Matrix4().multiplyMatrices(groupInv, m.matrixWorld);
    return { m, uTo: { value: to }, uFrom: { value: to.clone().invert() } };
  });
  const attach = (p: (typeof parts)[number]): void => {
    stackPatch(p.m.material as Material, CRAB_TAG, (shader) => {
      if (!shader.vertexShader.includes('#include <project_vertex>') || shader.vertexShader.includes('uCrabTo')) return;
      Object.assign(shader.uniforms, { uCrab: crab, uCrabBoxA: boxA, uCrabBoxB: boxB, uCrabTo: p.uTo, uCrabFrom: p.uFrom });
      shader.vertexShader = PARS + shader.vertexShader.replace('#include <project_vertex>', VERTEX);
    });
  };
  for (const p of parts) attach(p);
  return {
    meshes: parts.length,
    // The gait only ever LIFTS a leg, so the rest pose's floor is the crab's.
    foot: box.min.y,
    middle: { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2 },
    span: { x: box.max.x - box.min.x, z: box.max.z - box.min.z },
    set(w: WaveState) {
      // Steps from distance walked; a crab always walks with the same will.
      crab.value.set(w.phase * CRAB.stepsPerStride, w.t ?? 0, 1, phase);
    },
    ensure() { for (const p of parts) if (!hasPatch(p.m.material as Material, CRAB_TAG)) attach(p); },
  };
}
