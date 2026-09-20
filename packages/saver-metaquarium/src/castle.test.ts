import { createRng } from '@idle-screens/core';
import { describe, expect, it } from 'vitest';
import { buildCastle, type CastleSpec } from './castle';

const spec: CastleSpec = { x: 10, y: 2, z: -150, facing: 0, scale: 1, palette: ['#49cfff', '#ff67bc'] };
const arr = (g: { getAttribute(n: string): { array: ArrayLike<number> } }, n: string): number[] => Array.from(g.getAttribute(n).array);

describe('castle', () => {
  it('is seeded: same seed, same stones, same spires, same lights', () => {
    const a = buildCastle(spec, createRng(1)), b = buildCastle(spec, createRng(1));
    // Every rng-driven output: masonry picks its shades from the shared stream,
    // spires take spin/lean/shoulder from a fork, and the emitters sit on both.
    for (const attr of ['position', 'color'] as const) {
      expect(arr(a.masonry, attr)).toEqual(arr(b.masonry, attr));
      expect(arr(a.crystal, attr)).toEqual(arr(b.crystal, attr));
    }
    expect(a.emitters).toEqual(b.emitters);
    expect(a.marks).toEqual(b.marks);
    // …and a different seed is a different castle.
    const c = buildCastle(spec, createRng(2));
    expect(arr(a.masonry, 'color')).not.toEqual(arr(c.masonry, 'color'));
    expect(arr(a.crystal, 'position')).not.toEqual(arr(c.crystal, 'position'));
  });

  it('is voxel masonry under faceted spires, finite, inside a landmark budget', () => {
    const c = buildCastle(spec, createRng(2));
    expect(c.counts.towers).toBe(6);
    expect(arr(c.masonry, 'position').length % (36 * 3)).toBe(0);
    expect(c.counts.triangles).toBeLessThan(30000);
    for (const g of [c.masonry, c.crystal]) {
      expect(arr(g, 'position').every(Number.isFinite)).toBe(true);
      expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
    }
    // Spires stand on the towers: every crystal vertex is above the wall walk.
    const y = arr(c.crystal, 'position').filter((_, i) => i % 3 === 1);
    expect(y.reduce((m, v) => Math.min(m, v), Infinity)).toBeGreaterThan(spec.y + 40);
  });

  it('the two-storey citadel raises an upper ward: more towers, a keep on the terrace, still in budget', () => {
    const one = buildCastle(spec, createRng(2)), two = buildCastle({ ...spec, tiers: 2 }, createRng(2));
    expect(two.counts.towers).toBe(10);
    expect(two.keep.y).toBeGreaterThan(one.keep.y + 15);
    expect(two.counts.triangles).toBeLessThan(60000);
    const top = (c: typeof one): number => arr(c.crystal, 'position').filter((_, i) => i % 3 === 1).reduce((m, v) => Math.max(m, v), 0);
    expect(top(two)).toBeGreaterThan(top(one) + 20);
  });

  it('lights the field from its spires and gate, and names places to go', () => {
    const c = buildCastle(spec, createRng(3));
    expect(c.emitters.length).toBeGreaterThanOrEqual(7);
    expect(c.emitters.every(e => e.reach > 10 && Number.isFinite(e.x + e.y + e.z))).toBe(true);
    expect(Object.keys(c.marks).sort()).toEqual(['courtyard', 'gate', 'plaza']);
    // The gate faces +z at facing 0; the road runs out to the plaza.
    expect(c.marks.gate!.z).toBeGreaterThan(spec.z + 80);
    expect(c.marks.plaza!.z).toBeGreaterThan(c.marks.gate!.z);
    expect(c.obstacles[0]!.r).toBeGreaterThan(80);
  });
});
