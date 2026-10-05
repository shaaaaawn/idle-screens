import { describe, expect, it } from 'vitest';
import { createRng } from '@idle-screens/core';
import { avoidFrame, avoidOffsets, crowding, HORIZON, TOUCH, type AvoidBody } from './avoid';
import { compileSwimPlan, distanceAt, swimPoseAtDistance, type TankBounds } from './plan';
import { fishVariation } from './swim';

const L = 18;
const body = (x: number, y: number, z: number, vx = 0, vy = 0, vz = 0, len = L, give = 1): AvoidBody =>
  ({ x, y, z, vx, vy, vz, len, give });
const buf = (): Float64Array => new Float64Array(24 * 3);
const touch = (a: number, b: number): number => (a + b) * TOUCH;

describe('avoidOffsets', () => {
  it('does nothing at amount 0, or alone', () => {
    const out = buf();
    avoidOffsets([body(0, 40, 0), body(1, 40, 0)], 0, out, buf());
    expect([...out.slice(0, 6)].every((v) => v === 0)).toBe(true);
    avoidOffsets([body(0, 40, 0)], 1, out, buf());
    expect([...out.slice(0, 3)]).toEqual([0, 0, 0]);
  });

  it('parts two fish that overlap, along the line between them', () => {
    const out = buf();
    avoidOffsets([body(0, 40, 0), body(3, 40, 0)], 1, out, buf());
    expect(out[0]).toBeLessThan(0);
    expect(out[3]).toBeGreaterThan(0);
    const d = Math.hypot(3 + out[3]! - out[0]!, out[4]! - out[1]!, out[5]! - out[2]!);
    expect(d).toBeGreaterThanOrEqual(touch(L, L));
  });

  it('a near head-on pair never meets: swept through the pass, they stay apart', () => {
    // Two fish nearly nose to nose at 10 u/s each, their lines a third of a
    // touching distance apart (dead centre fades: see the next test).
    const out = buf(), sc = buf();
    for (const [dy, dz] of [[2, 0], [0, 2], [1.5, -1.5]] as const) {
      let closest = Infinity;
      for (let t = 0; t <= 6; t += 0.02) {
        const a = body(-30 + 10 * t, 40, 0, 10, 0, 0), b = body(30 - 10 * t, 40 + dy, dz, -10, 0, 0);
        avoidOffsets([a, b], 1, out, sc);
        closest = Math.min(closest, Math.hypot(b.x + out[3]! - a.x - out[0]!, b.y + out[4]! - a.y - out[1]!, b.z + out[5]! - a.z - out[2]!));
      }
      expect(closest).toBeGreaterThanOrEqual(touch(L, L) * 0.99);
    }
  });

  it('dead centre has no side to part to: the dodge fades there rather than flicking', () => {
    // Exactly nose to nose: any choice of side would have to swing round as
    // the lines wander a hair either way. Nothing pushes, and nothing jumps.
    const out = buf(), sc = buf();
    let prev: number[] | null = null, worst = 0;
    for (let t = 2; t <= 4; t += 1 / 60) {
      const miss = 0.4 * Math.sin(t * 3); // the lines wander across each other
      avoidOffsets([body(-30 + 10 * t, 40, 0, 10, 0, 0), body(30 - 10 * t, 40, miss, -10, 0, 0)], 1, out, sc);
      const now = [...out.slice(0, 6)];
      if (prev) worst = Math.max(worst, ...now.map((v, i) => Math.abs(v - prev![i]!)));
      prev = now;
    }
    expect(worst).toBeLessThan(L * 0.1);
  });

  it('starts the dodge ahead of the pass, and lets go after', () => {
    const out = buf(), sc = buf();
    const at = (t: number): number => {
      avoidOffsets([body(-30 + 10 * t, 40, 0, 10, 0, 0), body(30 - 10 * t, 40, 0.5, -10, 0, 0)], 1, out, sc);
      return Math.hypot(out[0]!, out[1]!, out[2]!);
    };
    expect(at(0)).toBe(0); // 60 apart, closing at 20 u/s: 3 s out, past the horizon
    expect(at(3 - HORIZON * 0.5)).toBeGreaterThan(0); // under way before they meet
    expect(at(3)).toBeGreaterThan(at(3 - HORIZON * 0.5)); // firmest at the pass
    expect(at(6)).toBe(0); // gone their ways
  });

  it('is continuous in time: no frame-to-frame jump', () => {
    const out = buf(), sc = buf();
    let prev: number[] | null = null, worst = 0;
    for (let t = 0; t <= 6; t += 1 / 60) {
      avoidOffsets([
        body(-30 + 10 * t, 40, 0, 10, 0, 0), body(30 - 10 * t, 41, 0.3, -10, 0, 0),
        body(0, 40 + 12 * Math.sin(t), -20 + 7 * t, 0, 12 * Math.cos(t), 7, L * 0.5),
      ], 1, out, sc);
      const now = [...out.slice(0, 9)];
      if (prev) worst = Math.max(worst, ...now.map((v, i) => Math.abs(v - prev![i]!)));
      prev = now;
    }
    // At 60 fps a dodge moves a fish well under a tenth of its length per frame.
    expect(worst).toBeLessThan(L * 0.1);
  });

  it('the smaller fish gives more, and a fish that cannot give stays put', () => {
    const out = buf();
    avoidOffsets([body(0, 40, 0, 0, 0, 0, L * 2), body(12, 40, 0, 0, 0, 0, L * 0.5)], 1, out, buf());
    expect(Math.hypot(out[3]!, out[4]!, out[5]!)).toBeGreaterThan(Math.hypot(out[0]!, out[1]!, out[2]!) * 3);
    avoidOffsets([body(0, 40, 0, 0, 0, 0, L, 0), body(4, 40, 0)], 1, out, buf());
    expect([out[0], out[1], out[2]]).toEqual([0, 0, 0]);
    expect(out[3]).toBeGreaterThan(0);
    avoidOffsets([body(0, 40, 0, 0, 0, 0, L, 0), body(4, 40, 0, 0, 0, 0, L, 0)], 1, out, buf());
    expect([...out.slice(0, 6)].every((v) => v === 0)).toBe(true);
  });

  it('never shoves a fish more than its cap', () => {
    const out = buf();
    // A small fish in a ring of big ones.
    const ring = Array.from({ length: 6 }, (_, i) => body(Math.cos(i) * 6, 40 + Math.sin(i * 2), Math.sin(i) * 6, 0, 0, 0, L * 2.5, 0));
    avoidOffsets([body(0, 40, 0, 0, 0, 0, L * 0.4), ...ring], 1, out, buf());
    expect(Math.hypot(out[0]!, out[1]!, out[2]!)).toBeLessThanOrEqual(L * 0.4 * 0.9 + 1e-9);
  });

  it('never dodges a fish below its floor', () => {
    const out = buf();
    const low = body(0, 20, 0); low.floor = 18;
    avoidOffsets([low, body(3, 12, 0, 0, 0, 0, L, 0)], 1, out, buf());
    expect(low.y + out[1]!).toBeGreaterThanOrEqual(18 - 1e-9);
  });

  it('prefers over and under to round', () => {
    const out = buf();
    avoidOffsets([body(0, 40, 0), body(3, 43, 0)], 1, out, buf());
    expect(Math.abs(out[4]! - out[1]!)).toBeGreaterThan(3); // vertical gap opened more than the 3 it had
  });
});

describe('avoidFrame', () => {
  it('reports how fast the dodge moves, and leaves the bodies where they were', () => {
    const a = body(-12, 40, 0, 10, 0, 0), b = body(12, 40, 1, -10, 0, 0);
    const out = buf(), rate = buf();
    avoidFrame([a, b], 1, out, rate, buf(), buf());
    expect(a.x).toBe(-12);
    expect(b.x).toBe(12);
    // Closing: the dodge is growing, so the rate points the way it is pushing.
    expect(Math.sign(rate[2]!)).toBe(Math.sign(out[2]!));
    avoidFrame([a, b], 0, out, rate, buf(), buf());
    expect([...rate.slice(0, 6)].every((v) => v === 0)).toBe(true);
  });
});

describe('crowding', () => {
  it('counts touching pairs, deepest first, skipping empty slots', () => {
    const at = new Float64Array(5 * 4).fill(NaN);
    const put = (s: number, x: number): void => { at[s * 4] = x; at[s * 4 + 1] = 40; at[s * 4 + 2] = 0; at[s * 4 + 3] = L; };
    put(0, 0); put(2, 2); put(4, 8); // 0–2 deep, 2–4 shallow, 0–4 apart (8 < 9.9)
    const c = crowding(at, 5);
    expect(c.touching).toBe(3);
    expect(c.pairs[0]!.slice(0, 2)).toEqual([0, 2]);
    expect(c.deepest).toBeCloseTo(1 - 2 / touch(L, L), 2);
    expect(crowding(new Float64Array(8).fill(NaN), 2)).toEqual({ touching: 0, deepest: 0, pairs: [] });
  });
});

describe('a real tank', () => {
  // Free fish on their own seeded routes, spread round them the way the tank
  // spreads its cast, velocities as the tank measures them (the chord half a
  // second on): how often does a fish sit inside another, with and without
  // the dodge — and does the dodge ever jump?
  const BOUNDS: TankBounds = { radius: 120, yMin: 15, yMax: 72 };
  const run = (n: number, seed: number, amount: number): { touching: number; step: number } => {
    const rng = createRng(seed).fork(0xabc);
    const plans = Array.from({ length: n }, (_, i) => compileSwimPlan(rng.fork(i), BOUNDS));
    const sizes = Array.from({ length: n }, (_, i) => [0.5, 1, 1, 1.4, 2.2][i % 5]!);
    const anchors = plans.map((p, i) => fishVariation(i, 0).anchor * p.totalLength);
    const out = buf(), rate = buf(), sc = buf(), ah = buf();
    const at = new Float64Array(n * 4);
    let hit = 0, frames = 0, step = 0, prev: Float64Array | null = null;
    for (let t = 0; t < 60; t += 1 / 30) {
      const bodies = plans.map((plan, i) => {
        const d = anchors[i]! + distanceAt(plan, t, 1);
        const p = swimPoseAtDistance(plan, d), q = swimPoseAtDistance(plan, d + plan.cruise * 0.5);
        return body(p.x, p.y, p.z, (q.x - p.x) * 2, (q.y - p.y) * 2, (q.z - p.z) * 2, L * sizes[i]!);
      });
      avoidFrame(bodies, amount, out, rate, sc, ah);
      if (prev) for (let k = 0; k < n * 3; k += 3) step = Math.max(step, Math.hypot(out[k]! - prev[k]!, out[k + 1]! - prev[k + 1]!, out[k + 2]! - prev[k + 2]!));
      prev = out.slice();
      bodies.forEach((b, i) => { at[i * 4] = b.x + out[i * 3]!; at[i * 4 + 1] = b.y + out[i * 3 + 1]!; at[i * 4 + 2] = b.z + out[i * 3 + 2]!; at[i * 4 + 3] = b.len; });
      if (crowding(at, n).touching > 0) hit++;
      frames++;
    }
    return { touching: hit / frames, step };
  };

  it('all but ends fish swimming through fish, without a jump', () => {
    for (const [seed, n] of [[3, 8], [42, 17]] as const) {
      {
        const before = run(n, seed, 0), after = run(n, seed, 1);
        // The bug, measured — else this test proves nothing. Then nearly gone.
        expect(before.touching).toBeGreaterThan(0.15);
        expect(after.touching).toBeLessThan(Math.max(0.02, before.touching * 0.05));
        // At 30 fps no dodge moves a fish a fifth of a body length in a frame
        // (measured: under 4 units in a crowd of 24, under 3 in one of 8).
        expect(after.step).toBeLessThan(L * 0.2);
      }
    }
  });
});
