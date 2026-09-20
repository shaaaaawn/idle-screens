import { createRng } from '@idle-screens/core';
import { describe, expect, it } from 'vitest';
import type { Emitter } from './crystals';
import { buildSky, LANTERN_VERTEX, lanternAt, lanternEmitters, type SkyOptions } from './sky';

const opts: SkyOptions = { density: 1, cap: 12, scale: 1, palette: ['#2dffb0', '#ffd34f'] };
const arr = (g: { getAttribute(n: string): { array: ArrayLike<number> } }, n: string): number[] => Array.from(g.getAttribute(n).array);

describe('sky lanterns', () => {
  it('is empty at zero — no geometry, nothing drawn', () => {
    const s = buildSky(createRng(1), { ...opts, density: 0 });
    expect(s.geometry).toBeNull();
    expect(s.lanterns).toHaveLength(0);
  });

  it('floats a seeded flotilla overhead, in the scene colours, with a far few', () => {
    const a = buildSky(createRng(2), opts);
    expect(a.lanterns.length).toBe(10);
    expect(a.lanterns.filter(l => l.far).length).toBe(3);
    for (const l of a.lanterns) {
      expect(l.y).toBeGreaterThan(90);
      expect(opts.palette).toContain(l.color);
      if (l.far) expect(Math.hypot(l.x, l.z)).toBeGreaterThan(200);
    }
    const b = buildSky(createRng(2), opts);
    expect(arr(b.geometry!, 'position')).toEqual(arr(a.geometry!, 'position'));
    expect(arr(buildSky(createRng(3), opts).geometry!, 'position')).not.toEqual(arr(a.geometry!, 'position'));
  });

  it('is cubes, finite, every vertex tagged with its lantern, within budget', () => {
    const s = buildSky(createRng(4), opts);
    const n = s.geometry!.getAttribute('position').count;
    expect(n % 36).toBe(0);
    expect(n / 36).toBe(s.voxels);
    expect(n / 3).toBeLessThan(40000);
    for (const name of ['color', 'aHome', 'aJelly', 'aGlow']) expect(s.geometry!.getAttribute(name).count).toBe(n);
    expect(arr(s.geometry!, 'position').every(Number.isFinite)).toBe(true);
    expect(buildSky(createRng(4), { ...opts, cap: 4 }).lanterns.length).toBeLessThan(s.lanterns.length);
  });

  it('is a flotilla of species, and every bell voxel knows how high up the bell it is', () => {
    const s = buildSky(createRng(7), opts);
    expect(new Set(s.lanterns.map(l => l.species)).size).toBeGreaterThanOrEqual(2);
    const bell = arr(s.geometry!, 'aBell'), hang = arr(s.geometry!, 'aJelly').filter((_, i) => i % 3 === 1);
    expect(bell.every(b => b === -1 || (b >= 0 && b <= 1))).toBe(true);
    // whatever hangs is not bell, and the bell does not hang
    bell.forEach((b, i) => { if (b >= 0) expect(hang[i]).toBe(0); });
    expect(bell.some(b => b === 1)).toBe(true);
    expect(buildSky(createRng(7), { ...opts, height: 0.3 }).lanterns.filter(l => !l.far).every(l => l.y < 60)).toBe(true);
  });

  it('moves as a pure function of t, slowly, and the shader has no other clock', () => {
    const s = buildSky(createRng(5), opts);
    const p = { x: 0, y: 0, z: 0 }, q = { x: 0, y: 0, z: 0 };
    for (const l of s.lanterns) {
      lanternAt(l, 40, p); lanternAt(l, 40, q);
      expect(p).toEqual(q);
      lanternAt(l, 41, q);
      expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeLessThan(4 * l.size + 2);
    }
    expect(LANTERN_VERTEX.match(/u[A-Z]\w*Time/g)!.every(u => u === 'uSkyTime')).toBe(true);
  });

  it('only the near lanterns light the field, and the list is rewritten in place', () => {
    const s = buildSky(createRng(6), opts);
    const out: Emitter[] = [];
    lanternEmitters(s.lanterns, 10, out);
    expect(out).toHaveLength(7);
    const first = out[0];
    lanternEmitters(s.lanterns, 20, out);
    expect(out[0]).toBe(first);
    expect(out.every(e => e.reach > 30 && e.y > 60)).toBe(true);
  });
});
