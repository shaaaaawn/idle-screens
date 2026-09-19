import { createRng } from '@idle-screens/core';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { boulder, buildRock, fissures, type Tri } from './rocks';

const spec = { x: 0, y: 0, z: 0, rx: 18, ry: 9, rz: 15, tint: '#4fe9ff', veins: 0.7 };

describe('fissured rocks', () => {
  it('a boulder is closed, flat-bottomed and seeded', () => {
    const a = boulder(createRng(3)), b = boulder(createRng(3));
    expect(a).toHaveLength(80);
    expect(a.map((t) => t.map((p) => p.toArray()))).toEqual(b.map((t) => t.map((p) => p.toArray())));
    expect(Math.min(...a.flat().map((p) => p.y))).toBeGreaterThanOrEqual(-0.42);
  });

  it('every fissure segment lies ON a facet of the rock it cracks', () => {
    const tris = boulder(createRng(7));
    const cut = fissures(tris, createRng(8), '#4fe9ff', 1);
    expect(cut.positions.length).toBeGreaterThan(200);
    // Each emitted vertex is within a ribbon-width + lift of some triangle's plane.
    const planes = tris.map(([a, b, c]: Tri) => {
      const n = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
      return { n, d: n.dot(a) };
    });
    const p = new Vector3();
    let worst = 0;
    for (let i = 0; i < cut.positions.length; i += 3) {
      p.set(cut.positions[i]!, cut.positions[i + 1]!, cut.positions[i + 2]!);
      worst = Math.max(worst, Math.min(...planes.map((pl) => Math.abs(pl.n.dot(p) - pl.d))));
    }
    expect(worst).toBeLessThan(0.45); // crystal tips stand proud; nothing floats free
  });

  it('nothing glows underground, and veins 0 is plain stone', () => {
    const cut = fissures(boulder(createRng(2)), createRng(2), '#ff3f9e', 1);
    for (let i = 1; i < cut.positions.length; i += 3) expect(cut.positions[i]!).toBeGreaterThan(-0.3);
    const plain = buildRock({ ...spec, veins: 0 }, createRng(4));
    expect(plain.glow).toBeNull();
    expect(plain.seep).toBeNull();
  });

  it('more veins, more fracture; the seep sits on the crown', () => {
    const lo = buildRock({ ...spec, veins: 0.2 }, createRng(5));
    const hi = buildRock({ ...spec, veins: 1 }, createRng(5));
    expect(hi.triangles).toBeGreaterThan(lo.triangles);
    expect(hi.seep!.y).toBeGreaterThan(spec.y + spec.ry * 0.4);
    expect(hi.triangles).toBeLessThan(1500);
  });
});
