import { createRng } from '@idle-screens/core';
import { describe, expect, it } from 'vitest';
import { buildFlora, FLORA_BY_ENVIRONMENT, FLORA_COLOR, FLORA_SPECIES, FLORA_SWAY, FLORA_VERTEX, parseFloraMix, SPORE_VERTEX, type FloraOptions } from './flora';

const anchors = [{ x: 0, y: 0, z: 0, color: '#2dffb0' }, { x: 80, y: 0, z: -40, color: '#4fe9ff' }];
const opts: FloraOptions = { density: 1, cap: 8, scale: 1, blocked: () => false };
const flat = (): number => 0;
const arr = (g: { getAttribute(n: string): { array: ArrayLike<number> } }, n: string): number[] => Array.from(g.getAttribute(n).array);

describe('flora', () => {
  it('plants a mixed garden, seeded, in two draws', () => {
    const a = buildFlora(anchors, flat, createRng(3), opts);
    expect(a.plants).toBe(72);
    expect(FLORA_SPECIES.filter(sp => a.bySpecies[sp] > 0).length).toBeGreaterThanOrEqual(11);
    expect(a.bySpecies.grass).toBeGreaterThan(a.bySpecies.tube); // ground cover outnumbers the features
    expect(a.bySpecies.clam).toBeLessThanOrEqual(2)
    expect(a.parts).toHaveLength(1);
    expect(a.lamps).toHaveLength(1);
    const b = buildFlora(anchors, flat, createRng(3), opts);
    expect(arr(b.parts[0]!, 'position')).toEqual(arr(a.parts[0]!, 'position'));
    expect(arr(buildFlora(anchors, flat, createRng(4), opts).parts[0]!, 'position')).not.toEqual(arr(a.parts[0]!, 'position'));
  });

  it('is made of cubes on a grid: axis-aligned quads, finite, budgeted', () => {
    const f = buildFlora(anchors, flat, createRng(5), opts);
    for (const g of [...f.parts, ...f.lamps]) {
      const n = g.getAttribute('position').count;
      expect(n % 6).toBe(0); // whole quads (a solid draws only the faces that touch water)
      for (const name of ['normal', 'color', 'aSway', 'aGlow']) expect(g.getAttribute(name).count).toBe(n);
      expect(arr(g, 'position').every(Number.isFinite)).toBe(true);
      const nor = arr(g, 'normal');
      for (let i = 0; i < nor.length; i += 3) expect(Math.abs(nor[i]!) + Math.abs(nor[i + 1]!) + Math.abs(nor[i + 2]!)).toBe(1);
    }
    expect(f.voxels * 12).toBeLessThan(60_000);
  });

  it('stays in budget in every room, at the top tier', () => {
    for (const environment of ['void', ...Object.keys(FLORA_BY_ENVIRONMENT)]) {
      const f = buildFlora(anchors, flat, createRng(7), { ...opts, cap: 12, environment });
      const tris = [...f.parts, ...f.lamps].reduce((a, g) => a + g.getAttribute('position').count / 3, 0);
      expect(tris, environment).toBeLessThan(64_000);
      expect(f.plants).toBe(108);
    }
  });

  it('floraMix chooses what grows, by relative weight', () => {
    for (const sp of FLORA_SPECIES) {
      const f = buildFlora(anchors, flat, createRng(3), { ...opts, mix: { [sp]: 1 } });
      expect(f.bySpecies[sp], sp).toBe(f.plants);
      expect(f.plants, sp).toBeGreaterThan(0);
      expect(f.parts.length + f.lamps.length, sp).toBeGreaterThan(0);
    }
    const f = buildFlora(anchors, flat, createRng(3), { ...opts, mix: { kelp: 3, anemone: 1 } });
    expect(f.bySpecies.kelp + f.bySpecies.anemone).toBe(f.plants);
    expect(f.bySpecies.kelp).toBeGreaterThan(f.bySpecies.anemone * 1.5);
  });

  it('a giant clam is a specimen: two to a garden, however it is asked for', () => {
    const f = buildFlora(anchors, flat, createRng(3), { ...opts, cap: 12, mix: { clam: 1 } });
    expect(f.bySpecies.clam).toBe(2);
    expect(f.lights).toHaveLength(2); // the mantle glows
  });

  it('each room grows its own garden when floraMix is empty', () => {
    const grow = (environment: string) => buildFlora(anchors, flat, createRng(3), { ...opts, environment }).bySpecies;
    const reef = grow('reef'), kelp = grow('kelp'), vent = grow('vent');
    expect(reef.staghorn + reef.brain + reef.fan).toBeGreaterThan(reef.kelp + reef.grass);
    expect(kelp.staghorn).toBe(0);
    expect(Math.max(...FLORA_SPECIES.map(sp => kelp[sp]))).toBe(kelp.kelp);
    expect(vent.tube).toBeGreaterThan(vent.kelp);
    // A mix always wins over the room.
    expect(buildFlora(anchors, flat, createRng(3), { ...opts, environment: 'reef', mix: { whip: 1 } }).bySpecies.whip).toBe(72);
    // An unknown room is the default garden.
    expect(grow('nowhere')).toEqual(grow('void'));
  });

  it('solids draw only their skin', () => {
    const f = buildFlora(anchors, flat, createRng(3), { ...opts, mix: { brain: 1 } });
    const tris = f.parts[0]!.getAttribute('position').count / 3;
    expect(tris).toBeLessThan(f.voxels * 12 * 0.5);
  });

  it('parses floraMix', () => {
    expect(parseFloraMix('kelp:3, anemone, clam:0.5, kelp')).toEqual({ mix: { kelp: 4, anemone: 1, clam: 0.5 }, problems: [] });
    expect(parseFloraMix('').mix).toEqual({});
    const bad = parseFloraMix('kelp, rose:2, whip:x');
    expect(bad.mix).toEqual({ kelp: 1 });
    expect(bad.problems).toHaveLength(2);
    expect(bad.problems[0]).toMatch(/rose/);
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

  it('reports a light for every plant that carries one, and a crown for every plant', () => {
    const f = buildFlora(anchors, flat, createRng(3), opts);
    const unlit = f.bySpecies.grass + f.bySpecies.brain;
    expect(f.lights.length).toBeLessThanOrEqual(f.plants - unlit);
    expect(f.lights.length).toBeGreaterThan((f.plants - unlit) * 0.8); // a staghorn may light no tip
    expect(f.lights.every(l => l.y > l.root && Number.isFinite(l.x + l.z))).toBe(true);
    // The shoal keeps above every plant, lit or not.
    expect(f.tips).toHaveLength(f.plants);
    expect(f.tips.every(t => t.y > t.root)).toBe(true);
    const whips = buildFlora(anchors, flat, createRng(3), { ...opts, mix: { whip: 1 } });
    expect(Math.max(...whips.tips.map(t => t.y - t.root))).toBeGreaterThan(20);
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
