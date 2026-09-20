import { createRng } from '@idle-screens/core';
import { describe, expect, it } from 'vitest';
import { buildPaths, MAX_PATH_SEGMENTS, PATH_FRAGMENT, PATH_TILE, pathClearance, type PathNode, type PathOptions } from './paths';

const village: PathNode[] = [
  { x: -96, z: -34, kind: 'home' }, { x: 92, z: -46, kind: 'home' }, { x: -66, z: 44, kind: 'home' },
  { x: 0, z: 40, kind: 'landmark' },
  { x: 120, z: 60, kind: 'crystal' }, { x: -130, z: 90, kind: 'crystal' }, { x: 40, z: 130, kind: 'crystal' },
];
const opts: PathOptions = { amount: 1, material: 'auto', scale: 1, obstacles: [] };

describe('paths', () => {
  it('is nothing at zero, and nothing without somewhere to go', () => {
    expect(buildPaths(village, createRng(1), { ...opts, amount: 0 }).segments).toEqual([]);
    expect(buildPaths([], createRng(1), opts).segments).toEqual([]);
  });

  it('joins every door and the landmark to one hub, seeded, inside the shader budget', () => {
    const a = buildPaths(village, createRng(2), opts);
    expect(a.hub).not.toBeNull();
    expect(a.edges).toBeGreaterThanOrEqual(4); // three doors + the road
    expect(a.segments.length).toBeLessThanOrEqual(MAX_PATH_SEGMENTS);
    // every home and the landmark is the end of a walk, and every walk reaches the hub
    for (const n of village.filter((v) => v.kind !== 'crystal')) expect(pathClearance(a.segments, n.x, n.z)).toBeLessThan(0.01);
    expect(pathClearance(a.segments, a.hub!.x, a.hub!.z)).toBeLessThan(0);
    expect(buildPaths(village, createRng(2), opts).segments).toEqual(a.segments);
    expect(buildPaths(village, createRng(3), opts).segments).not.toEqual(a.segments);
  });

  it('trails to the crystals only above half, the nearest first', () => {
    const low = buildPaths(village, createRng(4), { ...opts, amount: 0.5 }), high = buildPaths(village, createRng(4), opts);
    expect(high.edges).toBeGreaterThan(low.edges);
    expect(pathClearance(low.segments, 120, 60)).toBeGreaterThan(5);
    expect(pathClearance(high.segments, 40, 130)).toBeLessThan(0.01);
    // At 0.7 the budget is ONE trail (round((0.7 − 0.5) · 2 · 3) = 1), and it
    // goes to whichever crystal stands nearest the hub — the other two stay wild.
    const one = buildPaths(village, createRng(4), { ...opts, amount: 0.7 });
    expect(one.edges).toBe(low.edges + 1);
    const byDistance = village.filter((v) => v.kind === 'crystal')
      .sort((p, q) => Math.hypot(p.x - one.hub!.x, p.z - one.hub!.z) - Math.hypot(q.x - one.hub!.x, q.z - one.hub!.z));
    expect(pathClearance(one.segments, byDistance[0]!.x, byDistance[0]!.z)).toBeLessThan(0.01);
    for (const far of byDistance.slice(1)) expect(pathClearance(one.segments, far.x, far.z)).toBeGreaterThan(5);
  });

  it('goes round things, not through them — every chord, every seed', () => {
    const rock = { x: -48, z: 5, r: 16 };
    const doors = [{ x: -96, z: -20, kind: 'home' as const }, { x: 0, z: 30, kind: 'landmark' as const }];
    // Not the sample points — the SEGMENTS: the closest approach of every
    // centreline to the rock's centre clears the stone. The samples alone are
    // pushed out to r + 1.5·width, but the chord between two pushed samples
    // used to sag back through the rock (seed 9 laid one 8.95 units from the
    // centre); walk() now splits any offending chord at its nearest point.
    // Sweeping seeds is what makes this a guard and not a fixture.
    for (let seed = 1; seed <= 24; seed++) {
      const net = buildPaths(doors, createRng(seed), { ...opts, obstacles: [rock] });
      expect(net.segments.length).toBeGreaterThan(2);
      expect(net.segments.length).toBeLessThanOrEqual(MAX_PATH_SEGMENTS);
      for (const g of net.segments) {
        const bx = g.x1 - g.x0, bz = g.z1 - g.z0;
        const t = Math.min(1, Math.max(0, ((rock.x - g.x0) * bx + (rock.z - g.z0) * bz) / (bx * bx + bz * bz)));
        expect(Math.hypot(rock.x - g.x0 - bx * t, rock.z - g.z0 - bz * t), `seed ${seed}`).toBeGreaterThanOrEqual(rock.r);
      }
    }
  });

  it('with a paved road for a spine, every door joins it on its own side — nobody crosses the street', () => {
    const spine = { x0: 0, z0: -60, x1: 0, z1: 40, width: 12 };
    const net = buildPaths(village, createRng(7), { ...opts, amount: 0.5, spine });
    expect(net.edges).toBe(3);
    for (const home of village.filter((v) => v.kind === 'home')) {
      // the walk that starts at this door ends on the door's side of the road, at its edge
      const first = net.segments.findIndex((g) => Math.hypot(g.x0 - home.x, g.z0 - home.z) < 0.01);
      let last = first;
      while (last + 1 < net.segments.length && Math.hypot(net.segments[last + 1]!.x0 - net.segments[last]!.x1, net.segments[last + 1]!.z0 - net.segments[last]!.z1) < 0.01) last++;
      const end = net.segments[last]!;
      expect(Math.sign(end.x1)).toBe(Math.sign(home.x));
      expect(Math.abs(end.x1)).toBeCloseTo(spine.width * 0.8, 5);
      expect(end.z1).toBeGreaterThanOrEqual(spine.z0);
      expect(end.z1).toBeLessThanOrEqual(spine.z1);
    }
    expect(net.hub).toEqual({ x: 0, z: 40 });
  });

  it('is laid as tiles: coverage is decided per tile, not per pixel', () => {
    expect(PATH_FRAGMENT).toMatch(/floor\(g\)/);
    expect(PATH_FRAGMENT).toMatch(/pa = pc - a/); // distance from the TILE's centre
    expect(PATH_TILE).toBeCloseTo(5.1, 5); //         the castle paving's pitch
  });

  it('is mostly algae on auto, one thing when told, and the shader knows all three', () => {
    const mats = Array.from({ length: 40 }, (_, i) => buildPaths(village, createRng(100 + i), opts).segments.map((g) => g.material)).flat();
    const share = mats.filter((m) => m === 'algae').length / mats.length;
    expect(share).toBeGreaterThan(0.5);
    expect(share).toBeLessThan(0.95);
    expect(new Set(buildPaths(village, createRng(6), { ...opts, material: 'sand' }).segments.map((g) => g.material))).toEqual(new Set(['sand']));
    for (const word of ['Algae', 'Cobbles', 'Sandstone']) expect(PATH_FRAGMENT).toContain(word);
  });
});
