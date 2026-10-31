/**
 * The fish's occlusion (`fishAO`): a fish's own corners go dark — the fin's
 * root against the flank, the step where the head meets the body, the gap
 * under a crab's shell — so a fish reads as a solid thing, not as panels of
 * flat colour. Every voxel renderer does it; the plants have it (voxel-ao.ts).
 *
 * The fish are voxel models from the breeds' build (breeds/rig), skinned,
 * Draco-packed, and split into a mesh per material (primary, secondary, glow,
 * eyes). Every face is axis-aligned, so the cubes can be read back off the
 * faces: snap the vertices to the voxel step (Draco leaves ~1e-4 of jitter),
 * and each face says the cell behind it is solid. Then each vertex counts the
 * solid cells in the layer in front of its face, around it — none on an open
 * face, two along an inside edge, three in an inside corner (0fps's voxel AO).
 *
 * Read in the bind pose, the geometry's own space, so it holds however the
 * fish bends. Once per geometry (fish of one breed share theirs), the first
 * frame `fishAO` is on; at 0 nothing is computed or installed. Applied to the
 * surface colour of the lit coats (not eyes, not glow), so it holds on every
 * tier.
 */

import { BufferAttribute, Matrix4, Vector3, type BufferGeometry, type Material, type Mesh, type Object3D } from 'three';
import { stackPatch } from './hooks';

const TAG = 'mq-fish-ao-v1';

/** 0..1 — `fishAO`. Written by the tank each frame. */
export const FISH_AO = { value: 0 };

/** How dark a vertex is per solid cell around it in front of its face (0..3), at fishAO 1. */
export const FISH_AO_LEVELS = [0, 0.28, 0.48, 0.62] as const;

export interface FishPart {
  /** Positions in the part's own space, and its triangles (null: every three vertices). */
  pos: ArrayLike<number>;
  index: ArrayLike<number> | null;
  /** The part's space → the fish's common space (bind pose). */
  matrix?: Matrix4;
}

/** The voxel step: the smallest edge length that is common among the axis-aligned edges. */
export function voxelStep(parts: readonly FishPart[]): number {
  const counts = new Map<number, number>();
  for (const p of parts) eachTriangle(p, (a, b, c) => {
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const d = [Math.abs(u.x - v.x), Math.abs(u.y - v.y), Math.abs(u.z - v.z)].sort((x, y) => y - x);
      if (d[1]! > 1e-3 * d[0]! || !(d[0]! > 1e-6)) continue; // only edges along one axis
      const k = Math.round(d[0]! * 1e3) / 1e3;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  });
  if (!counts.size) return 0;
  const top = Math.max(...counts.values());
  return Math.min(...[...counts].filter(([, n]) => n >= 0.1 * top).map(([k]) => k));
}

const A = new Vector3(), B = new Vector3(), C = new Vector3();
function eachTriangle(p: FishPart, fn: (a: Vector3, b: Vector3, c: Vector3, ia: number, ib: number, ic: number) => void): void {
  const n = p.index ? p.index.length : p.pos.length / 3;
  const at = (i: number, out: Vector3): Vector3 => {
    out.set(p.pos[i * 3]!, p.pos[i * 3 + 1]!, p.pos[i * 3 + 2]!);
    return p.matrix ? out.applyMatrix4(p.matrix) : out;
  };
  for (let t = 0; t + 2 < n; t += 3) {
    const ia = p.index ? p.index[t]! : t, ib = p.index ? p.index[t + 1]! : t + 1, ic = p.index ? p.index[t + 2]! : t + 2;
    fn(at(ia, A), at(ib, B), at(ic, C), ia, ib, ic);
  }
}

/** The triangle's axis (0 x, 1 y, 2 z) and outward sign, or null when it is not axis-aligned. */
function faceAxis(a: Vector3, b: Vector3, c: Vector3): [number, number] | null {
  const nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
  const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
  const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const n = [nx, ny, nz], m = Math.hypot(nx, ny, nz);
  if (!(m > 0)) return null;
  const k = n.findIndex((v) => Math.abs(v) / m > 0.999);
  return k < 0 ? null : [k, Math.sign(n[k]!)];
}

const key = (i: number, j: number, k: number): number => ((i + 4096) * 8192 + (j + 4096)) * 8192 + (k + 4096);

/**
 * Per-vertex occlusion, 0..1, for each part (by vertex index), from the cells
 * every part's faces imply. Parts in one fish share one grid.
 */
export function fishOcclusion(parts: readonly FishPart[]): Float32Array[] {
  const out = parts.map((p) => new Float32Array(p.pos.length / 3));
  const v = voxelStep(parts);
  if (!(v > 0)) return out;
  // The grid's origin: the lowest corner of everything, so every vertex sits on a grid line.
  const lo = [Infinity, Infinity, Infinity];
  for (const p of parts) eachTriangle(p, (a, b, c) => { for (const q of [a, b, c]) { lo[0] = Math.min(lo[0]!, q.x); lo[1] = Math.min(lo[1]!, q.y); lo[2] = Math.min(lo[2]!, q.z); } });
  const g = (q: Vector3): [number, number, number] => [Math.round((q.x - lo[0]!) / v), Math.round((q.y - lo[1]!) / v), Math.round((q.z - lo[2]!) / v)];
  const solid = new Set<number>();
  const cell = [0, 0, 0];
  // Each face marks the cells behind it: every cell whose centre falls inside the triangle, one layer in.
  for (const p of parts) eachTriangle(p, (a, b, c) => {
    const f = faceAxis(a, b, c);
    if (!f) return;
    const [k, s] = f, [ua, ub] = [0, 1, 2].filter((x) => x !== k) as [number, number];
    const ga = g(a), gb = g(b), gc = g(c);
    const layer = s > 0 ? ga[k]! - 1 : ga[k]!;
    const i0 = Math.min(ga[ua]!, gb[ua]!, gc[ua]!), i1 = Math.max(ga[ua]!, gb[ua]!, gc[ua]!);
    const j0 = Math.min(ga[ub]!, gb[ub]!, gc[ub]!), j1 = Math.max(ga[ub]!, gb[ub]!, gc[ub]!);
    for (let i = i0; i < i1; i += 1) for (let j = j0; j < j1; j += 1) {
      if (!inTriangle(i + 0.5, j + 0.5, [ga[ua]!, ga[ub]!], [gb[ua]!, gb[ub]!], [gc[ua]!, gc[ub]!])) continue;
      cell[k] = layer; cell[ua] = i; cell[ub] = j;
      solid.add(key(cell[0]!, cell[1]!, cell[2]!));
    }
  });
  // Each vertex, per face it belongs to: the four cells around it in the layer in front.
  parts.forEach((p, pi) => eachTriangle(p, (a, b, c, ia, ib, ic) => {
    const f = faceAxis(a, b, c);
    if (!f) return;
    const [k, s] = f, [ua, ub] = [0, 1, 2].filter((x) => x !== k) as [number, number];
    for (const [q, vi] of [[a, ia], [b, ib], [c, ic]] as const) {
      const gq = g(q), front = s > 0 ? gq[k]! : gq[k]! - 1;
      let n = 0;
      for (const di of [-1, 0]) for (const dj of [-1, 0]) {
        cell[k] = front; cell[ua] = gq[ua]! + di; cell[ub] = gq[ub]! + dj;
        if (solid.has(key(cell[0]!, cell[1]!, cell[2]!))) n += 1;
      }
      const occ = FISH_AO_LEVELS[Math.min(3, n)]! / FISH_AO_LEVELS[3];
      if (occ > out[pi]![vi]!) out[pi]![vi] = occ;
    }
  }));
  return out;
}

function inTriangle(x: number, y: number, a: number[], b: number[], c: number[]): boolean {
  const d = (p: number[], q: number[]): number => (x - q[0]!) * (p[1]! - q[1]!) - (p[0]! - q[0]!) * (y - q[1]!);
  const d1 = d(a, b), d2 = d(b, c), d3 = d(c, a), e = 1e-9;
  return !((d1 < -e || d2 < -e || d3 < -e) && (d1 > e || d2 > e || d3 > e));
}

const inv = new Matrix4(), rel = new Matrix4();
/**
 * Bake one fish (every mesh under `root`): its occlusion into each geometry as
 * `aMqFishOcc`, once (shared geometries are done once). True when it baked.
 */
export function bakeFishOcclusion(root: Object3D): boolean {
  const meshes: Mesh[] = [];
  root.traverse((n) => { const m = n as Mesh; if (m.isMesh && m.geometry?.getAttribute('position')) meshes.push(m); });
  if (!meshes.length || meshes.every((m) => m.geometry.userData.mqFishOcc)) return false;
  root.updateMatrixWorld(true);
  inv.copy(root.matrixWorld).invert();
  const parts: FishPart[] = meshes.map((m) => ({
    pos: m.geometry.getAttribute('position').array,
    index: m.geometry.index ? m.geometry.index.array : null,
    matrix: rel.copy(inv).multiply(m.matrixWorld).clone(),
  }));
  const occ = fishOcclusion(parts);
  meshes.forEach((m, i) => {
    const geo: BufferGeometry = m.geometry;
    if (geo.userData.mqFishOcc) return;
    geo.setAttribute('aMqFishOcc', new BufferAttribute(occ[i]!, 1));
    geo.userData.mqFishOcc = true;
  });
  return true;
}

const VERT_PARS = 'attribute float aMqFishOcc;\nvarying float vMqFishOcc;\n';
const VERT = '#include <begin_vertex>\n  vMqFishOcc = aMqFishOcc;';
const FRAG_PARS = 'uniform float uMqFishAO;\nvarying float vMqFishOcc;\n';
const FRAG = /* glsl */ `#include <color_fragment>
  // A geometry without the bake reads 0: no occlusion.
  diffuseColor.rgb *= 1.0 - ${FISH_AO_LEVELS[3].toFixed(2)} * uMqFishAO * vMqFishOcc;`;

/** Patch one fish material (true when it took the patch now). Eyes and glow parts (untagged) are left alone. */
export function patchFishAO(material: Material): boolean {
  if (!material.userData.mqFish) return false;
  return stackPatch(material, TAG, (shader) => {
    if (!shader.vertexShader.includes('#include <begin_vertex>') || !shader.fragmentShader.includes('#include <color_fragment>')) return;
    shader.uniforms.uMqFishAO = FISH_AO;
    shader.vertexShader = VERT_PARS + shader.vertexShader.replace('#include <begin_vertex>', VERT);
    shader.fragmentShader = FRAG_PARS + shader.fragmentShader.replace('#include <color_fragment>', FRAG);
  });
}
