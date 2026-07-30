import { describe, it, expect } from 'vitest';
import { createRng } from '@idle-screens/core';
import {
  compileSwimPlan,
  distanceAt,
  swimPoseAt,
  swimPoseAtDistance,
  type SwimPlan,
  type TankBounds,
} from './plan';

const BOUNDS: TankBounds = { radius: 46, yMin: 26, yMax: 54 };

describe('swim plan', () => {
  it('same seed compiles the same itinerary; different seeds differ', () => {
    const a = compileSwimPlan(createRng(7).fork(0xf1), BOUNDS);
    const b = compileSwimPlan(createRng(7).fork(0xf1), BOUNDS);
    const c = compileSwimPlan(createRng(8).fork(0xf1), BOUNDS);
    expect(a.points).toEqual(b.points);
    expect(a.totalLength).toBe(b.totalLength);
    expect(a.points).not.toEqual(c.points);
  });

  it('waypoints stay inside the tank volume', () => {
    for (let seed = 1; seed < 20; seed++) {
      const plan = compileSwimPlan(createRng(seed).fork(0xf1), BOUNDS);
      for (const [x, y, z] of plan.points) {
        expect(Math.hypot(x, z)).toBeLessThanOrEqual(BOUNDS.radius + 1e-6);
        expect(y).toBeGreaterThanOrEqual(BOUNDS.yMin);
        expect(y).toBeLessThanOrEqual(BOUNDS.yMax);
      }
    }
  });

  it('pose is a pure function of t — same inputs, same pose', () => {
    const plan = compileSwimPlan(createRng(7).fork(0xf1), BOUNDS);
    const a = swimPoseAt(plan, 12.34, 1.2);
    const b = swimPoseAt(plan, 12.34, 1.2);
    expect(a).toEqual(b);
  });

  it('distance is monotonic and anchored at 0', () => {
    const plan = compileSwimPlan(createRng(3).fork(0xf1), BOUNDS);
    expect(distanceAt(plan, 0, 1)).toBeCloseTo(0);
    let prev = 0;
    for (let t = 0.25; t < 60; t += 0.25) {
      const d = distanceAt(plan, t, 1);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
  });

  it('forward tangent is unit-ish and the fish noses along the path', () => {
    const plan = compileSwimPlan(createRng(5).fork(0xf1), BOUNDS);
    for (let t = 0; t < 30; t += 0.5) {
      const p = swimPoseAt(plan, t, 1);
      expect(Math.hypot(p.fx, p.fy, p.fz)).toBeCloseTo(1, 3);
      const q = swimPoseAt(plan, t + 0.05, 1);
      const dot = (q.x - p.x) * p.fx + (q.y - p.y) * p.fy + (q.z - p.z) * p.fz;
      expect(dot).toBeGreaterThan(0);
    }
  });

  it('pose-by-distance agrees with pose-by-time', () => {
    const plan = compileSwimPlan(createRng(7).fork(0xf1), BOUNDS);
    const byTime = swimPoseAt(plan, 12.5, 1.3);
    const byDist = swimPoseAtDistance(plan, distanceAt(plan, 12.5, 1.3));
    expect(byDist.x).toBeCloseTo(byTime.x);
    expect(byDist.fz).toBeCloseTo(byTime.fz);
  });

  it('bank roll stays within the clamp', () => {
    const plan = compileSwimPlan(createRng(11).fork(0xf1), BOUNDS);
    for (let t = 0; t < 40; t += 0.2) {
      const { roll } = swimPoseAt(plan, t, 1.5);
      expect(Math.abs(roll)).toBeLessThanOrEqual(0.35 + 1e-6);
    }
  });

  it('degenerate plan (coincident points) returns a finite pose', () => {
    const pts: Array<[number, number, number]> = Array.from({ length: 8 }, () => [0, 40, 0]);
    const arc = new Float32Array(1025);
    const plan: SwimPlan = {
      points: pts,
      arc,
      totalLength: 1,
      cruise: 1,
      wobble: [],
    };
    const pose = swimPoseAtDistance(plan, 0.5);
    expect(Number.isFinite(pose.x)).toBe(true);
    expect(Number.isFinite(pose.fx)).toBe(true);
  });
});
