/**
 * Voxel occlusion (`voxelAO`): the corners where cubes meet go dark.
 *
 * The flora is drawn in cubes, each face at a fixed value for its direction
 * (top brightest, underside darkest). Nothing darkens where one cube meets
 * another, so a coral reads as flat cut-outs: the branch that steps out of a
 * stem, the inside of a fan's fork, the ring where a stalk meets the sand all
 * carry the same light as the open tip. Every voxel renderer worth looking at
 * darkens those corners (Minecraft's smooth lighting, MagicaVoxel), and it is
 * most of why their cubes read as solid.
 *
 * Per vertex, the three spots just in front of the face at that corner — one
 * past each edge, one past the corner — are tested against the cubes actually
 * drawn: two edges blocked is a full corner, else the count (0fps's voxel AO).
 * The flora's cubes are not on one grid (a sea fan grows across a rotated
 * plane, lamps and leaves come in their own sizes), so the test is against the
 * boxes, not a grid lookup. Vertices low on the plant also darken toward the
 * ground they stand in, which no box knows about.
 *
 * Worked out once per geometry, the first frame `voxelAO` is on (a reef is
 * hundreds of thousands of vertices; at 0 it costs nothing). Applied as a
 * multiply on the vertex colour, so it holds on every tier: the basic tier
 * gets none of the screen-space passes, and this is the one that still reads
 * there.
 */

import { BufferAttribute, type BufferGeometry, type Material } from 'three';
import { stackPatch } from './hooks';

const TAG = 'mq-voxel-ao-v1';

/** 0..1 — `voxelAO`. Written by the tank each frame. */
export const VOXEL_AO = { value: 0 };

/** How dark each level of occlusion is (0 open .. 3 a full inside corner), at voxelAO 1. */
export const AO_LEVELS = [0, 0.3, 0.5, 0.66] as const;

/**
 * Boxes as a flat list, cx cy cz hx hy hz per box (centre, half-extents), and a
 * point query on them: a uniform hash, each box filed in every bucket it overlaps.
 */
export class BoxField {
  private readonly buckets = new Map<number, number[]>();
  private readonly q: number;

  constructor(readonly boxes: ArrayLike<number>, cell?: number) {
    const n = Math.floor(boxes.length / 6);
    let q = cell ?? 0;
    if (!(q > 0)) {
      // The median box's longest side: most boxes land in one to eight buckets.
      const sides: number[] = [];
      for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 512))) sides.push(2 * Math.max(boxes[i * 6 + 3]!, boxes[i * 6 + 4]!, boxes[i * 6 + 5]!));
      sides.sort((a, b) => a - b);
      q = sides[sides.length >> 1] ?? 1;
    }
    this.q = q > 0 ? q : 1;
    for (let i = 0; i < n; i += 1) {
      const o = i * 6;
      const x0 = this.cell(boxes[o]! - boxes[o + 3]!), x1 = this.cell(boxes[o]! + boxes[o + 3]!);
      const y0 = this.cell(boxes[o + 1]! - boxes[o + 4]!), y1 = this.cell(boxes[o + 1]! + boxes[o + 4]!);
      const z0 = this.cell(boxes[o + 2]! - boxes[o + 5]!), z1 = this.cell(boxes[o + 2]! + boxes[o + 5]!);
      // A box far bigger than the grid would flood it; it is filed whole in at most 64 buckets and missed beyond that.
      if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 64) continue;
      for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) for (let z = z0; z <= z1; z += 1) {
        const k = key(x, y, z), list = this.buckets.get(k);
        if (list) list.push(i); else this.buckets.set(k, [i]);
      }
    }
  }

  private cell(v: number): number { return Math.floor(v / this.q); }

  /** Is (x, y, z) inside any box (strictly: a point on a face is outside)? */
  has(x: number, y: number, z: number): boolean {
    const list = this.buckets.get(key(this.cell(x), this.cell(y), this.cell(z)));
    if (!list) return false;
    const b = this.boxes;
    for (const i of list) {
      const o = i * 6;
      if (Math.abs(x - b[o]!) < b[o + 3]! && Math.abs(y - b[o + 1]!) < b[o + 4]! && Math.abs(z - b[o + 2]!) < b[o + 5]!) return true;
    }
    return false;
  }
}

/** Buckets keyed by three signed cell indices packed into one number (±2^16 each way). */
function key(x: number, y: number, z: number): number {
  return ((x + 32768) * 65536 + (y + 32768)) * 65536 + (z + 32768);
}

export interface OcclusionOptions {
  /** The ground's height under (x, z): vertices within `groundReach` of it darken toward it. */
  ground?: (x: number, z: number) => number;
  /** How far above the ground its occlusion reaches, in world units (default: three median voxels). */
  groundReach?: number;
}

/**
 * Per-vertex occlusion, 0 (open) .. 1 (the darkest level, `AO_LEVELS[3]`
 * relative), for non-indexed geometry whose every six vertices are one
 * axis-aligned quad (two triangles, wound outward) — what the voxel writers
 * emit. A group of six that is not such a quad is left at 0.
 */
export function voxelOcclusion(pos: ArrayLike<number>, field: BoxField, opts: OcclusionOptions = {}): Float32Array {
  const count = Math.floor(pos.length / 3);
  const out = new Float32Array(count);
  const p = (v: number, a: number): number => pos[v * 3 + a]!;
  const reach = opts.groundReach ?? medianReach(field.boxes);
  for (let f = 0; f + 6 <= count; f += 6) {
    // The quad's box: one axis flat (the normal's), two spanning it.
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = f; v < f + 6; v += 1) for (let a = 0; a < 3; a += 1) { lo[a] = Math.min(lo[a]!, p(v, a)); hi[a] = Math.max(hi[a]!, p(v, a)); }
    const ext = [hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!];
    const flatAxis = ext.indexOf(Math.min(...ext));
    const [ua, ub] = [0, 1, 2].filter((a) => a !== flatAxis) as [number, number];
    if (ext[flatAxis]! > 1e-4 * Math.max(ext[ua]!, ext[ub]!) || !(ext[ua]! > 0) || !(ext[ub]! > 0)) continue;
    // Outward: the first triangle's winding.
    const e1 = [p(f + 1, 0) - p(f, 0), p(f + 1, 1) - p(f, 1), p(f + 1, 2) - p(f, 2)];
    const e2 = [p(f + 2, 0) - p(f, 0), p(f + 2, 1) - p(f, 1), p(f + 2, 2) - p(f, 2)];
    const cross = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    const ns = Math.sign(cross[flatAxis]!);
    if (!ns) continue;
    const d = 0.5 * Math.min(ext[ua]!, ext[ub]!);
    const mid = [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2];
    for (let v = f; v < f + 6; v += 1) {
      const sa = Math.sign(p(v, ua) - mid[ua]!) || 1, sb = Math.sign(p(v, ub) - mid[ub]!) || 1;
      const at = (da: number, db: number): boolean => {
        const q = [p(v, 0), p(v, 1), p(v, 2)];
        q[flatAxis] = q[flatAxis]! + ns * d; q[ua] = q[ua]! + da * d; q[ub] = q[ub]! + db * d;
        return field.has(q[0]!, q[1]!, q[2]!);
      };
      const s1 = at(sa, -sb), s2 = at(-sa, sb);
      const level = s1 && s2 ? 3 : (s1 ? 1 : 0) + (s2 ? 1 : 0) + (at(sa, sb) ? 1 : 0);
      let occ = AO_LEVELS[level]! / AO_LEVELS[3];
      if (opts.ground && reach > 0) {
        // The sand under a plant is not a box: darken the first `reach` above it, side faces most, a top face not at all.
        const h = p(v, 1) - opts.ground(p(v, 0), p(v, 2));
        const g = h <= 0 ? 1 : Math.max(0, 1 - h / reach);
        const facing = flatAxis === 1 ? (ns < 0 ? 1 : 0) : 0.8;
        occ = Math.max(occ, g * g * facing);
      }
      out[v] = occ;
    }
  }
  return out;
}

function medianReach(boxes: ArrayLike<number>): number {
  const n = Math.floor(boxes.length / 6);
  if (!n) return 0;
  const hs: number[] = [];
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 512))) hs.push(boxes[i * 6 + 4]!);
  hs.sort((a, b) => a - b);
  return 6 * hs[hs.length >> 1]!;
}

/**
 * Give a geometry its occlusion (`aMqOcc`) from the boxes kept on it at build
 * time (`userData.mqBoxes`; scenery-paint's `batch` carries them through a
 * merge), once. False when it has none or already has it.
 */
export function bakeVoxelOcclusion(geometry: BufferGeometry, opts: OcclusionOptions = {}): boolean {
  const boxes = geometry.userData.mqBoxes as ArrayLike<number> | undefined;
  const pos = geometry.getAttribute('position');
  if (!boxes || !pos || geometry.userData.mqOccBaked) return false;
  geometry.setAttribute('aMqOcc', new BufferAttribute(voxelOcclusion(pos.array, new BoxField(boxes), opts), 1));
  geometry.userData.mqOccBaked = true;
  delete geometry.userData.mqBoxes;
  return true;
}

const VERT_PARS = /* glsl */ `
  attribute float aMqOcc;
  uniform float uMqVoxelAO;
`;
const VERT = /* glsl */ `#include <color_vertex>
  // A geometry without the bake reads 0 here: no occlusion.
  vColor.rgb *= 1.0 - ${AO_LEVELS[3].toFixed(2)} * uMqVoxelAO * aMqOcc;`;

/** Patch a vertex-coloured material to take the occlusion (true when it took the patch now). */
export function patchVoxelAO(material: Material): boolean {
  return stackPatch(material, TAG, (shader) => {
    if (!shader.vertexShader.includes('#include <color_vertex>')) return;
    shader.uniforms.uMqVoxelAO = VOXEL_AO;
    shader.vertexShader = VERT_PARS + shader.vertexShader.replace('#include <color_vertex>', VERT);
  });
}
