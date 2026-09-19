import { createRng } from '@idle-screens/core';
import { describe, expect, it } from 'vitest';
import { buildFlora, FLORA_COLOR, FLORA_VERTEX, type FloraOptions } from './flora';

const anchors = [{ x: 0, y: 0, z: 0, color: '#2dffb0' }, { x: 80, y: 0, z: -40, color: '#4fe9ff' }];
const opts: FloraOptions = { density: 1, cap: 8, scale: 1, blocked: () => false };
const flat = (): number => 0;

describe('flora', () => {
  it('grows the asked number of plants across all three species, seeded', () => {
    const a = buildFlora(anchors, flat, createRng(3), opts);
    expect(a.plants).toBe(48);
    expect(a.bySpecies.kelp).toBeGreaterThan(8);
    expect(a.bySpecies.reed).toBeGreaterThan(5);
    expect(a.bySpecies.bulb).toBeGreaterThan(2);
    const b = buildFlora(anchors, flat, createRng(3), opts);
    expect(b.parts.length).toBe(a.parts.length);
    expect(Array.from(b.parts[7]!.getAttribute('position').array)).toEqual(Array.from(a.parts[7]!.getAttribute('position').array));
  });

  it('never roots inside something solid, and nothing grows with no light to feed on', () => {
    const blocked = (x: number, z: number): boolean => Math.hypot(x, z) < 30;
    const f = buildFlora(anchors, flat, createRng(3), { ...opts, blocked });
    for (const g of f.parts) {
      const sway = g.getAttribute('aSway');
      expect(sway.getX(0)).toBe(0); // rooted on the floor it was given
    }
    expect(buildFlora([], flat, createRng(3), opts).plants).toBe(0);
    expect(buildFlora(anchors, flat, createRng(3), { ...opts, density: 0 }).parts).toHaveLength(0);
  });

  it('every vertex carries its sway and glow; lights are split out as lamps', () => {
    const f = buildFlora(anchors, flat, createRng(5), opts);
    for (const g of [...f.parts, ...f.lamps]) {
      const n = g.getAttribute('position').count;
      expect(g.getAttribute('aSway').count).toBe(n);
      expect(g.getAttribute('aGlow').count).toBe(n);
    }
    expect(f.parts.every((g) => g.getAttribute('aGlow').getX(0) === 0)).toBe(true);
    expect(f.lamps.every((g) => g.getAttribute('aGlow').getX(0) === 1)).toBe(true);
    expect(f.lamps.length).toBeGreaterThan(f.plants * 0.8); // every plant carries a light
    expect(f.lamps.length).toBeLessThan(f.parts.length * 0.5);
  });

  it('motion is a pure function of the tank clock and zero at the root', () => {
    for (const src of [FLORA_VERTEX, FLORA_COLOR]) expect(src).toMatch(/uSwayTime/);
    expect(FLORA_VERTEX).toMatch(/h \* h/); // displacement scales with height² — the root never moves
    expect(FLORA_VERTEX).not.toMatch(/random|noise\(/);
  });
});
