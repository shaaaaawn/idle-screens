import { createRng } from '@idle-screens/core';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ROCK_BASE, boulder, buildRock, fissures, type Tri } from './rocks';

const spec = { x: 0, y: 0, z: 0, rx: 18, ry: 9, rz: 15, tint: '#4fe9ff', veins: 0.7 };

/** Distance from `p` to the nearest of the rock's facet planes. */
const offFacet = (planes: readonly { n: Vector3; d: number }[], p: Vector3): number =>
  Math.min(...planes.map((pl) => Math.abs(pl.n.dot(p) - pl.d)));
const facetPlanes = (tris: readonly Tri[]): { n: Vector3; d: number }[] => tris.map(([a, b, c]) => {
  const n = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
  return { n, d: n.dot(a) };
});

describe('fissured rocks', () => {
  it('a boulder is closed, flat-bottomed and seeded', () => {
    const a = boulder(createRng(3)), b = boulder(createRng(3));
    expect(a).toHaveLength(80);
    expect(a.map((t) => t.map((p) => p.toArray()))).toEqual(b.map((t) => t.map((p) => p.toArray())));
    expect(Math.min(...a.flat().map((p) => p.y))).toBeGreaterThanOrEqual(ROCK_BASE);
    // Closed: a watertight surface has every edge shared by exactly two
    // triangles. The soup is loose Vector3s, but a shared vertex is displaced
    // once (the bump is keyed by position), so equal coordinates mean the same
    // vertex and an edge can be keyed by its two endpoints.
    const key = (p: Vector3): string => p.toArray().map((v) => v.toFixed(5)).join(',');
    const edges = new Map<string, number>();
    for (const [p, q, r] of a) {
      for (const [u, v] of [[p, q], [q, r], [r, p]] as const) {
        const e = [key(u), key(v)].sort().join('|');
        edges.set(e, (edges.get(e) ?? 0) + 1);
      }
    }
    expect(edges.size).toBe(120); // an icosphere at detail 1: 80 faces, 42 vertices, 120 edges
    expect([...edges.values()].every((n) => n === 2)).toBe(true);
  });

  it('every fissure ribbon lies ON a facet of the rock it cracks; only the shards stand proud', () => {
    const tris = boulder(createRng(7));
    const cut = fissures(tris, createRng(8), '#4fe9ff', 1);
    expect(cut.positions.length).toBeGreaterThan(200);
    const planes = facetPlanes(tris);
    const p = new Vector3();
    // The channels come first, the breach's shards last: `3 + round(amount * 5)`
    // shards of three triangles each (rocks.ts). Split the soup there so the
    // ribbon bound is not loosened by the tips, which are MEANT to leave the
    // surface. The shard section is recognisable on its own: it carries no flow.
    const shardFloats = (3 + Math.round(1 * 5)) * 9 * 3;
    const ribbonEnd = cut.positions.length - shardFloats;
    expect(cut.flow.slice(ribbonEnd / 3).every((f) => f === 0)).toBe(true);
    let ribbon = 0, shard = 0;
    for (let i = 0; i < cut.positions.length; i += 3) {
      p.set(cut.positions[i]!, cut.positions[i + 1]!, cut.positions[i + 2]!);
      if (i < ribbonEnd) ribbon = Math.max(ribbon, offFacet(planes, p));
      else shard = Math.max(shard, offFacet(planes, p));
    }
    // A ribbon vertex is a point on a facet's edge, pushed sideways IN the
    // facet and lifted at most 0.02 along its normal: the white-hot core's lift.
    expect(ribbon).toBeLessThan(0.025);
    // Crystal tips stand proud of the crown; nothing floats free.
    expect(shard).toBeGreaterThan(0.025);
    expect(shard).toBeLessThan(0.45);
  });

  it('nothing glows underground, and veins 0 is plain stone', () => {
    const cut = fissures(boulder(createRng(2)), createRng(2), '#ff3f9e', 1);
    for (let i = 1; i < cut.positions.length; i += 3) expect(cut.positions[i]!).toBeGreaterThan(ROCK_BASE); // a segment may dip to the buried rim, never below the stone
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
