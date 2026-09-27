/**
 * The seahorse, alive. The body wave is wrong for an upright animal (it is on
 * `NO_WAVE`), so until now the seahorse hovered completely rigid — its one
 * clip only moves the whole model. A seahorse is all small motion:
 *
 * - it swims with its DORSAL FIN, a fast ripple running up the fin (the body
 *   hardly moves while it does);
 * - its TAIL is prehensile: it coils forward under the body and lets go,
 *   tighter when the animal works (a maneuver, a turn);
 * - it rocks upright and NODS its head, as if choosing what to eat.
 *
 * Same shape as the swim wave (swimwave.ts): a vertex patch in the FISH's
 * frame (+z nose, +y up) on every mesh of the fish, so eyes and glow shells
 * move with the body; one rig per fish, fed per frame. All forty seahorses
 * share one voxel geometry (26 long, 52 tall, 14 wide — measured in the breed
 * lab), so the anatomy below is quoted as fractions of that box:
 *
 *   s = height from the crown (0) to the tail tip (1)
 *   f = depth from the snout (0) to the back of the dorsal fin (1)
 *
 *   dorsal fin   f > 0.72, s 0.38–0.72   (it stands off the back, x 8→14 of 26)
 *   tail         s > 0.68, hanging from the spine at f 0.52, hooked forward
 *   neck         s 0.35
 */

import { Box3, Matrix4, Vector3, Vector4, type Material, type Mesh, type Object3D, type SkinnedMesh } from 'three';
import { cloneWithHooks, hasPatch, stackPatch } from './hooks';
import type { WaveRig, WaveState } from './swimwave';

/** Anatomy, as fractions of the fish-frame box (see the header). */
export const SEAHORSE = {
  finFront: 0.72, finSpan: 0.2, finTop: 0.38, finBottom: 0.72,
  tailBase: 0.68, tailSpine: 0.52,
  neck: 0.35, neckSpine: 0.5,
} as const;

/** Rotate (y, z) about (py, pz) by `a` (radians, + swings a downward point FORWARD, toward +z). */
function swing(y: number, z: number, py: number, pz: number, a: number): [number, number] {
  const dy = y - py, dz = z - pz, c = Math.cos(a), s = Math.sin(a);
  return [py + dy * c + dz * s, pz - dy * s + dz * c];
}
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The seahorse's pose inputs at this moment. `t` seconds, `amount` 0.. (≈1 cruising, up to ~2 working), `phase` per fish. */
export interface SeahorseState { t: number; amount: number; phase: number }

/** Tail curl at the tip (radians, + = coiled forward): a slow coil-and-release, never quite straight. */
export function tailCurl(st: SeahorseState): number {
  return st.amount * (0.28 + 0.3 * Math.sin(st.t * 0.55 + st.phase) + 0.12 * Math.sin(st.t * 1.35 + st.phase * 1.7));
}

/**
 * Where a rest-pose point goes, in the fish frame — the GLSL below, in JS, so
 * the anatomy can be tested. `box` is the fish-frame box: [yTop, height, zFront, depth].
 */
export function seahorsePoint(p: Vector3, box: readonly [number, number, number, number], st: SeahorseState, out = new Vector3()): Vector3 {
  const [yTop, H, zFront, D] = box;
  let { x, y, z } = p;
  const s = Math.max(0, Math.min(1, (yTop - y) / H));
  const f = (zFront - z) / D;
  const A = st.amount;
  // 1. The dorsal fin ripples sideways, a wave running up it.
  const fin = Math.max(0, Math.min(1, (f - SEAHORSE.finFront) / SEAHORSE.finSpan))
    * smooth(SEAHORSE.finTop - 0.04, SEAHORSE.finTop + 0.04, s) * (1 - smooth(SEAHORSE.finBottom - 0.04, SEAHORSE.finBottom + 0.04, s));
  // …and its rays flex fore and aft a quarter-beat behind, so the ripple
  // reads from the side too (a sideways-only flutter points at the camera).
  const beatF = st.t * (15 + 5 * Math.min(1, Math.max(0, A - 1))) - y * 0.9 + st.phase;
  x += A * 0.07 * H * fin * Math.sin(beatF);
  z -= A * 0.035 * H * fin * fin * Math.cos(beatF);
  // 2. The tail coils: each point swings about the tail's root by an angle
  //    that grows toward the tip — the spiral a prehensile tail makes.
  const k = smooth(SEAHORSE.tailBase, 1, s);
  if (k > 0) {
    [y, z] = swing(y, z, yTop - SEAHORSE.tailBase * H, zFront - SEAHORSE.tailSpine * D, tailCurl(st) * k * 1.4);
  }
  // 3. The head nods about the neck.
  const n = 1 - smooth(0, SEAHORSE.neck, s);
  if (n > 0) {
    [y, z] = swing(y, z, yTop - SEAHORSE.neck * H, zFront - SEAHORSE.neckSpine * D, A * 0.09 * Math.sin(st.t * 1.15 + st.phase * 1.3) * n);
  }
  // 4. The whole animal rocks gently upright.
  [y, z] = swing(y, z, yTop - 0.5 * H, zFront - 0.5 * D, A * 0.05 * Math.sin(st.t * 0.7 + st.phase * 0.6));
  return out.set(x, y, z);
}

export const SEAHORSE_TAG = 'mq-seahorse-v1';
const PARS = 'uniform vec4 uSea; uniform vec4 uSeaBox; uniform mat4 uSeaTo; uniform mat4 uSeaFrom;\n';
const VERTEX = /* glsl */ `
  {
    vec3 p = (uSeaTo * vec4(transformed, 1.0)).xyz;
    float yTop = uSeaBox.x, H = uSeaBox.y, zF = uSeaBox.z, D = uSeaBox.w;
    float t = uSea.x, A = uSea.y, ph = uSea.z, curl = uSea.w;
    float s = clamp((yTop - p.y) / H, 0.0, 1.0);
    float f = (zF - p.z) / D;
    float fin = clamp((f - ${SEAHORSE.finFront.toFixed(3)}) / ${SEAHORSE.finSpan.toFixed(3)}, 0.0, 1.0)
      * smoothstep(${(SEAHORSE.finTop - 0.04).toFixed(3)}, ${(SEAHORSE.finTop + 0.04).toFixed(3)}, s)
      * (1.0 - smoothstep(${(SEAHORSE.finBottom - 0.04).toFixed(3)}, ${(SEAHORSE.finBottom + 0.04).toFixed(3)}, s));
    float beatF = t * (15.0 + 5.0 * clamp(A - 1.0, 0.0, 1.0)) - p.y * 0.9 + ph;
    p.x += A * 0.07 * H * fin * sin(beatF);
    p.z -= A * 0.035 * H * fin * fin * cos(beatF);
    float k = smoothstep(${SEAHORSE.tailBase.toFixed(3)}, 1.0, s);
    vec2 piv = vec2(yTop - ${SEAHORSE.tailBase.toFixed(3)} * H, zF - ${SEAHORSE.tailSpine.toFixed(3)} * D);
    float a = curl * k * 1.4;
    vec2 d = vec2(p.y, p.z) - piv;
    vec2 r = piv + vec2(d.x * cos(a) + d.y * sin(a), -d.x * sin(a) + d.y * cos(a));
    p.y = r.x; p.z = r.y;
    float n = 1.0 - smoothstep(0.0, ${SEAHORSE.neck.toFixed(3)}, s);
    piv = vec2(yTop - ${SEAHORSE.neck.toFixed(3)} * H, zF - ${SEAHORSE.neckSpine.toFixed(3)} * D);
    a = A * 0.09 * sin(t * 1.15 + ph * 1.3) * n;
    d = vec2(p.y, p.z) - piv;
    r = piv + vec2(d.x * cos(a) + d.y * sin(a), -d.x * sin(a) + d.y * cos(a));
    p.y = r.x; p.z = r.y;
    piv = vec2(yTop - 0.5 * H, zF - 0.5 * D);
    a = A * 0.05 * sin(t * 0.7 + ph * 0.6);
    d = vec2(p.y, p.z) - piv;
    r = piv + vec2(d.x * cos(a) + d.y * sin(a), -d.x * sin(a) + d.y * cos(a));
    p.y = r.x; p.z = r.y;
    transformed = (uSeaFrom * vec4(p, 1.0)).xyz;
  }
  #include <project_vertex>
`;

/**
 * Rig one seahorse. Same contract as `rigSwimWave`: `group` is the fish's
 * group (+z nose), `body` the cloned model at rest pose under it. `set` reads
 * the wave state's `amp` (effort) and its `t` (seconds); `phase` keeps two
 * seahorses from coiling in step.
 */
export function rigSeahorse(group: Object3D, body: Object3D, phase: number): WaveRig | null {
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
  const boxU = { value: new Vector4(box.max.y, Math.max(1e-3, box.max.y - box.min.y), box.max.z, Math.max(1e-3, box.max.z - box.min.z)) };
  const sea = { value: new Vector4(0, 0, phase, 0) };
  const seen = new Set<Material>();
  const parts = meshes.map((m) => {
    let mat = m.material as Material;
    if (seen.has(mat) || !mat.userData.mqOwned || hasPatch(mat, SEAHORSE_TAG)) {
      mat = cloneWithHooks(mat);
      mat.userData.mqOwned = true;
      m.material = mat;
    }
    seen.add(mat);
    const to = new Matrix4().multiplyMatrices(groupInv, m.matrixWorld);
    return { m, uTo: { value: to }, uFrom: { value: to.clone().invert() } };
  });
  const attach = (p: (typeof parts)[number]): void => {
    stackPatch(p.m.material as Material, SEAHORSE_TAG, (shader) => {
      if (!shader.vertexShader.includes('#include <project_vertex>') || shader.vertexShader.includes('uSeaTo')) return;
      Object.assign(shader.uniforms, { uSea: sea, uSeaBox: boxU, uSeaTo: p.uTo, uSeaFrom: p.uFrom });
      shader.vertexShader = PARS + shader.vertexShader.replace('#include <project_vertex>', VERTEX);
    });
  };
  for (const p of parts) attach(p);
  const st: SeahorseState = { t: 0, amount: 0, phase };
  return {
    meshes: parts.length,
    set(w: WaveState) {
      // Effort from the wave state: ~1 cruising (amp 0.08 at swimWave 1), more when it works.
      st.t = w.t ?? 0;
      st.amount = w.amp / 0.08;
      sea.value.set(st.t, st.amount, phase, tailCurl(st));
    },
    ensure() { for (const p of parts) if (!hasPatch(p.m.material as Material, SEAHORSE_TAG)) attach(p); },
  };
}
