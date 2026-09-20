import { createRng } from '@idle-screens/core';
import { describe, expect, it } from 'vitest';
import { buildPaths, MAX_PATH_SEGMENTS, PATH_FRAGMENT, pathClearance, type PathNode, type PathOptions } from './paths';

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
  });

  it('goes round things, not through them', () => {
    const rock = { x: -48, z: 5, r: 16 };
    const net = buildPaths([{ x: -96, z: -20, kind: 'home' }, { x: 0, z: 30, kind: 'landmark' }], createRng(5), { ...opts, obstacles: [rock] });
    for (const g of net.segments.slice(1, -1)) expect(Math.hypot(g.x0 - rock.x, g.z0 - rock.z)).toBeGreaterThanOrEqual(rock.r);
  });

  it('is mostly algae on auto, one thing when told, and the shader knows all three', () => {
    const mats = Array.from({ length: 40 }, (_, i) => buildPaths(village, createRng(100 + i), opts).segments.map((g) => g.material)).flat();
    const share = mats.filter((m) => m === 'algae').length / mats.length;
    expect(share).toBeGreaterThan(0.5);
    expect(share).toBeLessThan(0.95);
    expect(new Set(buildPaths(village, createRng(6), { ...opts, material: 'sand' }).segments.map((g) => g.material))).toEqual(new Set(['sand']));
    for (const word of ['Algae', 'Pebbles', 'Sand']) expect(PATH_FRAGMENT).toContain(word);
  });
});
