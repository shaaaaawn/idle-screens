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

  it('every vertex carries its sway and glow; only tips and lanterns glow', () => {
    const f = buildFlora(anchors, flat, createRng(5), opts);
    let glowing = 0;
    for (const g of f.parts) {
      const n = g.getAttribute('position').count;
      expect(g.getAttribute('aSway').count).toBe(n);
      expect(g.getAttribute('aGlow').count).toBe(n);
      if (g.getAttribute('aGlow').getX(0) === 1) glowing += 1;
    }
    expect(glowing).toBeGreaterThan(f.plants * 0.8);
    expect(glowing).toBeLessThan(f.parts.length * 0.4);
  });

  it('motion is a pure function of the tank clock and zero at the root', () => {
    for (const src of [FLORA_VERTEX, FLORA_COLOR]) expect(src).toMatch(/uSwayTime/);
    expect(FLORA_VERTEX).toMatch(/h \* h/); // displacement scales with height² — the root never moves
    expect(FLORA_VERTEX).not.toMatch(/random|noise\(/);
  });
});
