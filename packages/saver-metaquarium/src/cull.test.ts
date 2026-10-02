import { Document } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { cullHidden, jointsOf, trianglesOf } from '../breeds/cull.mjs';

const V = 2; // voxel pitch

type Cell = [number, number, number];

/** A face of the cell at `cell`, facing `sign` along `axis`: two triangles, wound outward. */
function face(cell: Cell, axis: number, sign: number): number[][] {
  const [ua, va] = [0, 1, 2].filter((i) => i !== axis) as [number, number];
  const at = (u: number, v: number): number[] => {
    const q = cell.map((c) => c * V);
    q[axis] = (q[axis] ?? 0) + (sign * V) / 2;
    q[ua] = (q[ua] ?? 0) + u * (V / 2);
    q[va] = (q[va] ?? 0) + v * (V / 2);
    return q;
  };
  const [p0, p1, p2, p3] = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)] as [number[], number[], number[], number[]];
  const e1 = [0, 1, 2].map((i) => (p1[i] ?? 0) - (p0[i] ?? 0)), e2 = [0, 1, 2].map((i) => (p2[i] ?? 0) - (p0[i] ?? 0));
  const n = [(e1[1] ?? 0) * (e2[2] ?? 0) - (e1[2] ?? 0) * (e2[1] ?? 0), (e1[2] ?? 0) * (e2[0] ?? 0) - (e1[0] ?? 0) * (e2[2] ?? 0), (e1[0] ?? 0) * (e2[1] ?? 0) - (e1[1] ?? 0) * (e2[0] ?? 0)];
  const out = Math.sign(n[axis] ?? 0) === sign;
  return out ? [...p0, ...p1, ...p2, ...p0, ...p2, ...p3].reduce<number[][]>((a, x, i) => { if (i % 3 === 0) a.push([]); a[a.length - 1]?.push(x); return a; }, [])
    : [p0, p2, p1, p0, p3, p2];
}

const SIDES: [number, number][] = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];

/** A skinned-or-not unindexed mesh from `parts`: each a list of [cell, faces] on one joint. */
function build(parts: { joint?: number; faces: { cell: Cell; side: [number, number] }[] }[]): { doc: Document; tris: () => number } {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const mesh = doc.createMesh();
  for (const part of parts) {
    const tris = part.faces.flatMap(({ cell, side }) => face(cell, side[0], side[1]));
    const prim = doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(new Float32Array(tris.flat())));
    if (part.joint !== undefined) {
      const n = tris.length;
      prim.setAttribute('JOINTS_0', doc.createAccessor().setType('VEC4').setBuffer(buffer).setArray(new Uint16Array(Array.from({ length: n }, () => [part.joint ?? 0, 0, 0, 0]).flat())));
      prim.setAttribute('WEIGHTS_0', doc.createAccessor().setType('VEC4').setBuffer(buffer).setArray(new Float32Array(Array.from({ length: n }, () => [1, 0, 0, 0]).flat())));
    }
    mesh.addPrimitive(prim);
  }
  doc.createNode().setMesh(mesh);
  return { doc, tris: () => mesh.listPrimitives().reduce((a, p) => a + trianglesOf(p).length, 0) };
}

const cube = (cell: Cell): { cell: Cell; side: [number, number] }[] => SIDES.map((side) => ({ cell, side }));

describe('cullHidden', () => {
  it('leaves a lone cube alone', () => {
    const { doc, tris } = build([{ faces: cube([0, 0, 0]) }]);
    expect(cullHidden(doc, V)).toBe(0);
    expect(tris()).toBe(12);
  });

  it('drops the two faces where whole cubes touch, and nothing else', () => {
    const { doc, tris } = build([{ faces: [...cube([0, 0, 0]), ...cube([1, 0, 0])] }]);
    expect(cullHidden(doc, V)).toBe(4); // 2 faces × 2 triangles
    expect(tris()).toBe(20);
  });

  it('keeps a visible face beside a lone plate: only a whole cube buries a face', () => {
    const { doc, tris } = build([{ faces: [...cube([0, 0, 0]), { cell: [1, 0, 0], side: [0, 1] }] }]);
    expect(cullHidden(doc, V)).toBe(0);
    expect(tris()).toBe(14);
  });

  it('keeps the seam between two parts on different joints', () => {
    const { doc, tris } = build([{ joint: 0, faces: cube([0, 0, 0]) }, { joint: 1, faces: cube([1, 0, 0]) }]);
    expect(cullHidden(doc, V)).toBe(0);
    expect(tris()).toBe(24);
  });

  it('still culls inside one joint of a rig', () => {
    const { doc, tris } = build([{ joint: 3, faces: [...cube([0, 0, 0]), ...cube([0, 1, 0])] }]);
    expect(cullHidden(doc, V)).toBe(4);
    expect(tris()).toBe(20);
  });
});

describe('jointsOf', () => {
  it('reads one joint per triangle of a rigid part', () => {
    const { doc } = build([{ joint: 2, faces: [{ cell: [0, 0, 0], side: [0, 1] }] }]);
    const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    expect(jointsOf(prim)).toEqual([2, 2]);
  });

  it('marks a triangle whose weight is shared as blending (-1), not rigid', () => {
    const { doc } = build([{ joint: 2, faces: [{ cell: [0, 0, 0], side: [0, 1] }] }]);
    const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    prim.getAttribute('WEIGHTS_0')!.setElement(0, [0.5, 0.5, 0, 0]);
    expect(jointsOf(prim)).toEqual([-1, 2]);
  });

  it('a secondary influence on slots 1–3 is a blend even when slot 0 is 1', () => {
    const { doc } = build([{ joint: 2, faces: [{ cell: [0, 0, 0], side: [0, 1] }] }]);
    const prim = doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!;
    prim.getAttribute('WEIGHTS_0')!.setElement(0, [1, 0, 0.2, 0]);
    expect(jointsOf(prim)).toEqual([-1, 2]);
  });
});
