import { createRng } from '@idle-screens/core';
import { describe, expect, it } from 'vitest';
import { buildFlora, FLORA_COLOR, FLORA_SPECIES, FLORA_SWAY, FLORA_VERTEX, SPORE_VERTEX, type FloraOptions } from './flora';

const anchors = [{ x: 0, y: 0, z: 0, color: '#2dffb0' }, { x: 80, y: 0, z: -40, color: '#4fe9ff' }];
const opts: FloraOptions = { density: 1, cap: 8, scale: 1, blocked: () => false };
const flat = (): number => 0;
const arr = (g: { getAttribute(n: string): { array: ArrayLike<number> } }, n: string): number[] => Array.from(g.getAttribute(n).array);

describe('flora', () => {
  it('plants a garden of all five species, seeded, in two draws', () => {
    const a = buildFlora(anchors, flat, createRng(3), opts);
    expect(a.plants).toBe(72);
    for (const sp of FLORA_SPECIES) expect(a.bySpecies[sp], sp).toBeGreaterThan(2);
    expect(a.bySpecies.grass).toBeGreaterThan(a.bySpecies.tube); // ground cover outnumbers the features
    expect(a.parts).toHaveLength(1);
    expect(a.lamps).toHaveLength(1);
    const b = buildFlora(anchors, flat, createRng(3), opts);
    expect(arr(b.parts[0]!, 'position')).toEqual(arr(a.parts[0]!, 'position'));
    expect(arr(buildFlora(anchors, flat, createRng(4), opts).parts[0]!, 'position')).not.toEqual(arr(a.parts[0]!, 'position'));
  });

  it('is made of cubes on a grid: axis-aligned faces, six to a voxel, finite, budgeted', () => {
    const f = buildFlora(anchors, flat, createRng(5), opts);
    for (const g of [...f.parts, ...f.lamps]) {
      const n = g.getAttribute('position').count;
      expect(n % 36).toBe(0);
      for (const name of ['normal', 'color', 'aSway', 'aGlow']) expect(g.getAttribute(name).count).toBe(n);
      expect(arr(g, 'position').every(Number.isFinite)).toBe(true);
      const nor = arr(g, 'normal');
      for (let i = 0; i < nor.length; i += 3) expect(Math.abs(nor[i]!) + Math.abs(nor[i + 1]!) + Math.abs(nor[i + 2]!)).toBe(1);
    }
    expect(f.voxels * 12).toBeLessThan(60_000);
  });

  it('never roots inside something solid, and nothing grows with no light to feed on', () => {
    const blocked = (x: number, z: number): boolean => Math.hypot(x, z) < 60;
    const f = buildFlora([anchors[0]!], flat, createRng(3), { ...opts, blocked });
    expect(f.plants).toBe(0); // every habitat is inside the blocked disc
    expect(buildFlora([], flat, createRng(3), opts).plants).toBe(0);
    expect(buildFlora(anchors, flat, createRng(3), { ...opts, density: 0 }).parts).toHaveLength(0);
  });

  it('stems never glow; lights always do', () => {
    const f = buildFlora(anchors, flat, createRng(5), opts);
    expect(arr(f.parts[0]!, 'aGlow').every((v) => v === 0)).toBe(true);
    expect(arr(f.lamps[0]!, 'aGlow').every((v) => v === 1)).toBe(true);
  });

  it('reports a light for every plant that carries one, at the lamp itself', () => {
    const f = buildFlora(anchors, flat, createRng(3), opts);
    expect(f.lights.length).toBe(f.plants - f.bySpecies.grass);
    expect(f.lights.every(l => l.y > l.root && Number.isFinite(l.x + l.z))).toBe(true);
  });

  it('motion is gentle, pure in the tank clock, and zero at the root', () => {
    for (const src of [FLORA_VERTEX, FLORA_COLOR]) expect(src).toMatch(/uSwayTime/);
    expect(FLORA_SWAY).toMatch(/h \* h/); // grows with height² — a root never moves
    expect(FLORA_SWAY).toMatch(/min\(/); //   and is capped — water, not wind
    expect(FLORA_SWAY).toMatch(/- h \* 0\.16/); // a wave CLIMBS the stalk: an S-curve, not a lean
    for (const src of [FLORA_SWAY, FLORA_VERTEX, FLORA_COLOR, SPORE_VERTEX]) expect(src).not.toMatch(/random|noise\(/);
    expect(SPORE_VERTEX).toMatch(/mqFloraSway/); // spores leave from where the tip IS
  });
});
