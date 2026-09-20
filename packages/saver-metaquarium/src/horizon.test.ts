import { createRng } from '@idle-screens/core';
import { describe, expect, it } from 'vitest';
import { buildHorizon, HORIZON_FRAGMENT, HORIZON_RINGS } from './horizon';

const arr = (g: { getAttribute(n: string): { array: ArrayLike<number> } }, n: string): number[] => Array.from(g.getAttribute(n).array);

describe('horizon', () => {
  it('is nothing at zero', () => {
    expect(buildHorizon(createRng(1), { amount: 0, palette: [] }).geometry).toBeNull();
  });

  it('stands spires, castle crystals and one grand geode past the fog line, seeded, cheaply', () => {
    const a = buildHorizon(createRng(2), { amount: 1, palette: ['#ff67bc'] });
    expect(a.counts.spires).toBeGreaterThan(5);
    expect(a.counts.crystals).toBeGreaterThan(3);
    expect(a.counts.geodes).toBe(1);
    expect(a.triangles).toBeLessThan(6000);
    const pos = arr(a.geometry!, 'position');
    expect(pos.every(Number.isFinite)).toBe(true);
    // Nothing inside the swim space, nothing past the camera's far plane.
    for (let i = 0; i < pos.length; i += 3) {
      const r = Math.hypot(pos[i]!, pos[i + 2]!);
      expect(r).toBeGreaterThan(330);
      expect(r).toBeLessThan(1000);
      expect(pos[i + 1]!).toBeGreaterThanOrEqual(0);
    }
    expect(arr(buildHorizon(createRng(2), { amount: 1, palette: ['#ff67bc'] }).geometry!, 'position')).toEqual(pos);
    expect(buildHorizon(createRng(2), { amount: 0.3, palette: [] }).counts.geodes).toBe(0);
  });

  it('fades ring by ring, and is drawn as light added to the water, never darker than it', () => {
    expect(HORIZON_RINGS.map(r => r.haze)).toEqual([...HORIZON_RINGS.map(r => r.haze)].sort((x, y) => y - x));
    expect(HORIZON_FRAGMENT).toContain('uHorizonFog + diffuseColor.rgb * vHorizon');
    const h = arr(buildHorizon(createRng(3), { amount: 1, palette: [] }).geometry!, 'aHaze');
    for (let i = 0; i < h.length; i += 2) { expect(h[i]!).toBeGreaterThan(0); expect(h[i]!).toBeLessThanOrEqual(1); }
  });
});
