import { createRng } from '@idle-screens/core';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ROCK_BASE, boulder, breach, buildRock, fissures, type Tri } from './rocks';

const spec = { x: 0, y: 0, z: 0, rx: 18, ry: 9, rz: 15, tint: '#4fe9ff', veins: 0.7 };

/** Distance from `p` to the nearest of the rock's facet planes. */
const offFacet = (planes: readonly { n: Vector3; d: number }[], p: Vector3): number =>
  Math.min(...planes.map((pl) => Math.abs(pl.n.dot(p) - pl.d)));
const facetPlanes = (tris: readonly Tri[]): { n: Vector3; d: number }[] => tris.map(([a, b, c]) => {
  const n = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
  return { n, d: n.dot(a) };
});

describe('rocks the crystals burst out of', () => {
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

  it('every fracture lies ON a facet of the stone it splits, and stays short', () => {
    const br = breach(boulder(createRng(7)), createRng(9), 1);
    const cut = fissures(br.tris, createRng(8), '#4fe9ff', 1, 12, br.site.clone().setY(br.floor));
    expect(cut.positions.length).toBeGreaterThan(100);
    const planes = facetPlanes(br.tris);
    const p = new Vector3();
    let off = 0, far = 0;
    for (let i = 0; i < cut.positions.length; i += 3) {
      p.set(cut.positions[i]!, cut.positions[i + 1]!, cut.positions[i + 2]!);
      off = Math.max(off, offFacet(planes, p));
      far = Math.max(far, p.distanceTo(br.site));
    }
    // A point on a facet's edge, pushed sideways IN the facet, lifted ≤ 0.02.
    expect(off).toBeLessThan(0.025);
    // Short: the stone split, the light does not run down the whole flank
    // (the old rivulets reached 1.55 × 1.1 from the crown).
    expect(far).toBeLessThan(1.1);
    // The throat is dark away from the breach: nothing bright past half-way.
    const bright = (i: number): number => Math.max(cut.colors[i]!, cut.colors[i + 1]!, cut.colors[i + 2]!);
    for (let i = 0; i < cut.positions.length; i += 3) {
      p.set(cut.positions[i]!, cut.positions[i + 1]!, cut.positions[i + 2]!);
      if (cut.flow[i / 3]! > 0.62) expect(bright(i)).toBeLessThan(0.2);
    }
  });

  it('the breach sinks a pit into the crown, keeps the stone closed, and throws chips onto the rim', () => {
    const raw = boulder(createRng(3));
    const br = breach(raw, createRng(4), 0.7);
    const top = Math.max(...raw.flat().map((v) => v.y));
    expect(br.site.y).toBeCloseTo(top, 6);
    expect(br.floor).toBeLessThan(br.site.y - 0.15);
    // Still closed: the heave is a function of position, so shared vertices move together.
    const key = (p: Vector3): string => p.toArray().map((v) => v.toFixed(5)).join(',');
    const edges = new Map<string, number>();
    for (const [p, q, r] of br.tris) {
      for (const [u, v] of [[p, q], [q, r], [r, p]] as const) {
        const e = [key(u), key(v)].sort().join('|');
        edges.set(e, (edges.get(e) ?? 0) + 1);
      }
    }
    expect([...edges.values()].every((n) => n === 2)).toBe(true);
    // The base does not move.
    expect(Math.min(...br.tris.flat().map((v) => v.y))).toBeCloseTo(Math.min(...raw.flat().map((v) => v.y)), 6);
    // Chips: whole octahedra near the rim, none floating above the crown.
    expect(br.chips.length % 8).toBe(0);
    expect(br.chips.length / 8).toBeGreaterThanOrEqual(3);
    for (const v of br.chips.flat()) expect(v.y).toBeLessThan(top + 0.2);
    // The colony leans with the crown but stands mostly upright.
    expect(br.normal.y).toBeGreaterThan(0.7);
  });

  it('a rock colony roots INSIDE the stone, below the pit floor; a host rock grows none', () => {
    const built = buildRock(spec, createRng(5));
    expect(built.crystal).not.toBeNull();
    const c = built.crystal!;
    // Below the breach (the seep sits on the pit floor), well above the base.
    expect(c.y).toBeLessThan(built.seep!.y);
    expect(c.y).toBeGreaterThan(spec.y + spec.ry * 0.3);
    expect(c.normal.length()).toBeCloseTo(1, 6);
    expect(c.size).toBeGreaterThan(spec.ry);
    const host = buildRock({ ...spec, host: true }, createRng(5));
    expect(host.crystal).toBeNull();
    expect(host.glow).not.toBeNull(); // it still split round its guest
    // The host's breach is dug on its centre line, where the guest stands.
    expect(Math.hypot(host.seep!.x - spec.x, host.seep!.z - spec.z)).toBeLessThan(spec.rx * 0.2);
  });

  it('nothing glows underground, and veins 0 is plain stone', () => {
    const br = breach(boulder(createRng(2)), createRng(3), 1);
    const cut = fissures(br.tris, createRng(2), '#ff3f9e', 1, 12, br.site.clone().setY(br.floor));
    for (let i = 1; i < cut.positions.length; i += 3) expect(cut.positions[i]!).toBeGreaterThan(ROCK_BASE); // a segment may dip to the buried rim, never below the stone
    const plain = buildRock({ ...spec, veins: 0 }, createRng(4));
    expect(plain.glow).toBeNull();
    expect(plain.seep).toBeNull();
    expect(plain.crystal).toBeNull();
    expect(plain.triangles).toBe(180); // a detail-2 boulder (rx 18 > 16: 20·3² faces), no chips
  });

  it('more veins, more fracture; the seep sits in the breach', () => {
    const lo = buildRock({ ...spec, veins: 0.2 }, createRng(5));
    const hi = buildRock({ ...spec, veins: 1 }, createRng(5));
    expect(hi.triangles).toBeGreaterThan(lo.triangles);
    expect(hi.seep!.y).toBeGreaterThan(spec.y + spec.ry * 0.3);
    expect(hi.triangles).toBeLessThan(1500);
  });
});
