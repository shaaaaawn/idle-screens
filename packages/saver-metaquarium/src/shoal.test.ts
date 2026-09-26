import { createRng } from '@idle-screens/core';
import { describe, expect, it } from 'vitest';
import { excursionAt, excursionsOut, relaxSeats, seatSpacing, Shoal, shoalFishGeometry, SHOAL_KINDS, type Carrier, type FishPose } from './shoal';

const circle = (t: number, along = 0): Carrier => {
  const a = t * 0.08 + along / 60;
  return { x: Math.cos(a) * 60, y: 40, z: Math.sin(a) * 60, fx: -Math.sin(a), fz: Math.cos(a) };
};
const flat = (): number => 0;
const pose = (): FishPose => ({ x: 0, y: 0, z: 0, hx: 0, hy: 0, hz: 1, phase: 0, amp: 0, along: 0 });

describe('shoal seats', () => {
  it('are seeded and relaxed to the spacing', () => {
    for (const n of [12, 30, 60]) {
      const a = relaxSeats(n, createRng(3)), b = relaxSeats(n, createRng(3));
      expect(a).toEqual(b);
      expect(seatSpacing(a)).toBeGreaterThan(0.85);
      // centred
      expect(Math.abs(a.reduce((s, p) => s + p.along, 0) / n)).toBeLessThan(1e-9);
    }
    expect(relaxSeats(30, createRng(4))).not.toEqual(relaxSeats(30, createRng(3)));
  });
  it('the school is longer than it is deep', () => {
    const s = relaxSeats(40, createRng(9));
    const ext = (k: 'along' | 'up' | 'side') => Math.max(...s.map((p) => p[k])) - Math.min(...s.map((p) => p[k]));
    expect(ext('along')).toBeGreaterThan(ext('side'));
    expect(ext('side')).toBeGreaterThan(ext('up'));
  });
});

describe('shoal excursions', () => {
  it('never has more than three fish out, and they come back', () => {
    let seen = 0;
    for (let t = 0; t < 600; t += 0.37) {
      const n = excursionsOut(40, t, 12.5);
      expect(n).toBeLessThanOrEqual(3);
      if (n) seen++;
    }
    expect(seen).toBeGreaterThan(200);
    // An excursion's envelope closes: sample every fish long after — offsets bounded, finite.
    const e = { side: 0, up: 0, along: 0 };
    for (let i = 0; i < 40; i++) {
      excursionAt(i, 40, 1234.5, 12.5, e);
      expect(Math.hypot(e.side, e.up, e.along)).toBeLessThan(6);
    }
  });
});

describe('Shoal', () => {
  const shoal = new Shoal(createRng(1), { count: 30, kind: 'neon', lit: true, length: 6 });
  it('is a pure function of t: same answer whatever was asked before', () => {
    const a = shoal.poseAt(7, 88.8, circle, flat, pose());
    shoal.poseAt(7, 3, circle, flat, pose());
    shoal.update(500, circle, flat);
    const b = shoal.poseAt(7, 88.8, circle, flat, pose());
    expect(b).toEqual(a);
  });
  it('stays together, polarised, finite and off the floor', () => {
    let worst = Infinity;
    for (let t = 0; t < 300; t += 2.3) {
      const s = shoal.stats(t, circle, flat);
      expect(s.polarisation).toBeGreaterThan(0.8);
      worst = Math.min(worst, s.nearest);
      for (let i = 0; i < 30; i++) {
        const p = shoal.poseAt(i, t, circle, () => 38, pose());
        expect(Number.isFinite(p.x + p.y + p.z + p.phase + p.amp)).toBe(true);
        expect(p.y).toBeGreaterThanOrEqual(38 + 0.8 * 6 - 1e-9);
        expect(Math.hypot(p.x - circle(t).x, p.z - circle(t).z)).toBeLessThan(6 * 12);
      }
    }
    // Two fish may brush past on an excursion, never sit inside each other.
    expect(worst).toBeGreaterThan(0.3);
  });
  it('writes one instance per fish, and every kind builds a finite fish', () => {
    shoal.update(12, circle, flat);
    expect(shoal.mesh.count).toBe(30);
    const e = shoal.mesh.instanceMatrix.array;
    expect(Array.from(e).every(Number.isFinite)).toBe(true);
    for (const k of SHOAL_KINDS) {
      const g = shoalFishGeometry(k);
      expect(Array.from(g.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      expect(g.userData.mqOwned).toBe(true);
    }
  });
});
