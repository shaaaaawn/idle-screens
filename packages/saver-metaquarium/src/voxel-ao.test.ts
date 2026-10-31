import { BufferAttribute, BufferGeometry, Color, Group } from 'three';
import { describe, expect, it } from 'vitest';
import { batch, CubeWriter } from './scenery-paint';
import { bakeVoxelOcclusion, BoxField, voxelOcclusion } from './voxel-ao';

/** Unit cubes at integer cells: their quads (CubeWriter's winding) and their boxes. */
function cubes(cells: Array<[number, number, number]>): { pos: number[]; boxes: number[] } {
  const w = new CubeWriter(), boxes: number[] = [];
  for (const [x, y, z] of cells) { w.cube(x, y, z, 1, 1, 1, new Color(1, 1, 1)); boxes.push(x, y, z, 0.5, 0.5, 0.5); }
  return { pos: w.pos, boxes };
}

/** Occlusion of the vertices that sit at `at` on a face whose outward normal is along `axis` with sign `sign`. */
function occAt(pos: number[], occ: Float32Array, at: [number, number, number], axis: number, sign: number): number[] {
  const out: number[] = [];
  const P = (v: number, a: number): number => pos[v * 3 + a]!;
  for (let f = 0; f < pos.length / 18; f += 1) {
    const v0 = f * 6;
    // Outward from the winding of the quad's first triangle.
    const e1 = [0, 1, 2].map((a) => P(v0 + 1, a) - P(v0, a)), e2 = [0, 1, 2].map((a) => P(v0 + 2, a) - P(v0, a));
    const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
    if (Math.sign(n[axis]!) !== sign || [0, 1, 2].some((a) => a !== axis && Math.abs(n[a]!) > 1e-9)) continue;
    for (let v = v0; v < v0 + 6; v += 1) if ([0, 1, 2].every((a) => Math.abs(P(v, a) - at[a]!) < 1e-6)) out.push(occ[v]!);
  }
  return out;
}

describe('voxel occlusion', () => {
  it('leaves a lone cube open', () => {
    const { pos, boxes } = cubes([[0, 0, 0]]);
    const occ = voxelOcclusion(pos, new BoxField(boxes));
    expect(occ.length).toBe(36);
    expect(Math.max(...occ)).toBe(0);
  });

  it('leaves the sides of a straight stalk open', () => {
    const { pos, boxes } = cubes([[0, 0, 0], [0, 1, 0], [0, 2, 0]]);
    const occ = voxelOcclusion(pos, new BoxField(boxes));
    // The +x side of the middle cube, both its corners on the shared edge with the cube above.
    const side = occAt(pos, occ, [0.5, 1.5, 0.5], 0, 1);
    expect(side.length).toBeGreaterThan(0);
    expect(Math.max(...side)).toBe(0);
  });

  it('darkens the floor where a cube stands on it, and the cube\'s foot', () => {
    // A 3×3 slab at y 0 and one cube on its middle.
    const slab: Array<[number, number, number]> = [];
    for (let x = -1; x <= 1; x += 1) for (let z = -1; z <= 1; z += 1) slab.push([x, 0, z]);
    const { pos, boxes } = cubes([...slab, [0, 1, 0]]);
    const occ = voxelOcclusion(pos, new BoxField(boxes));
    // The slab's top at the standing cube's foot corner: one edge neighbour (the cube) — a step, not open.
    // (The slab's top under the cube is hidden and carries nothing; the three visible tops around the foot do.)
    const foot = occAt(pos, occ, [0.5, 0.5, 0.5], 1, 1);
    expect(foot.filter((o) => o > 0).length).toBeGreaterThanOrEqual(3);
    // The slab's far corner stays open.
    expect(Math.max(...occAt(pos, occ, [1.5, 0.5, 1.5], 1, 1))).toBe(0);
    // The standing cube's +x side at its bottom edge meets the slab's top.
    expect(Math.max(...occAt(pos, occ, [0.5, 0.5, 0.5], 0, 1))).toBeGreaterThan(0);
  });

  it('gives an inside corner the darkest level', () => {
    // A floor cube with walls on +x and +z: its top vertex in that corner has both edges blocked.
    const { pos, boxes } = cubes([[0, 0, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1]]);
    const occ = voxelOcclusion(pos, new BoxField(boxes));
    expect(Math.max(...occAt(pos, occ, [0.5, 0.5, 0.5], 1, 1))).toBe(1);
  });

  it('darkens the bottom of a plant toward the ground, not its top', () => {
    const { pos, boxes } = cubes([[0, 0.5, 0]]); // a cube standing on y = 0
    const occ = voxelOcclusion(pos, new BoxField(boxes), { ground: () => 0, groundReach: 2 });
    expect(Math.min(...occAt(pos, occ, [0.5, 0, 0.5], 0, 1))).toBeGreaterThan(0.5);
    expect(Math.max(...occAt(pos, occ, [0.5, 1, 0.5], 1, 1))).toBe(0);
  });

  it('bakes once through a batch, reading each part\'s boxes', () => {
    const part = (cells: Array<[number, number, number]>): BufferGeometry => {
      const { pos, boxes } = cubes(cells), g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      g.userData.mqBoxes = new Float32Array(boxes);
      return g;
    };
    const merged = batch(new Group(), [part([[0, 0, 0]]), part([[0, 1, 0], [1, 1, 0]])], 'test')!.geometry;
    expect(bakeVoxelOcclusion(merged)).toBe(true);
    const occ = merged.getAttribute('aMqOcc').array as Float32Array;
    expect(occ.length).toBe(merged.getAttribute('position').count);
    // The first part's cube sits under the second part's pair: its +x side meets the overhang.
    expect(Math.max(...occ)).toBeGreaterThan(0);
    expect(bakeVoxelOcclusion(merged)).toBe(false);
  });
});
