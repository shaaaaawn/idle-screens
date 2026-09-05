import { describe, it, expect } from 'vitest';
import { createRng } from '@idle-screens/core';
import {
  compileSwimPlan,
  distanceAt,
  swimPoseAt,
  swimPoseAtDistance,
  type SwimPlan,
  type TankBounds,
  PATH_SHAPES,
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

describe('path shapes', () => {
  const BOUNDS = { radius: 120, yMin: 15, yMax: 72 };

  it('every shape compiles a closed, arc-parameterized, in-bounds loop', () => {
    for (const shape of PATH_SHAPES) {
      const plan = compileSwimPlan(createRng(11), BOUNDS, shape);
      expect(plan.totalLength).toBeGreaterThan(100);
      // Sample the whole loop: inside the cylinder, inside the water column.
      // The slack is Catmull-Rom overshoot between waypoints, nothing more:
      // 3% of radius and 3 world units of depth. A generator that actually
      // leaves the tank fails this.
      for (let d = 0; d <= plan.totalLength; d += plan.totalLength / 64) {
        const pose = swimPoseAtDistance(plan, d);
        expect(Math.hypot(pose.x, pose.z)).toBeLessThanOrEqual(BOUNDS.radius * 1.03);
        expect(pose.y).toBeGreaterThanOrEqual(BOUNDS.yMin - 3);
        expect(pose.y).toBeLessThanOrEqual(BOUNDS.yMax + 3);
      }
    }
  });

  it('shapes are genuinely different itineraries, not renamed wander', () => {
    const at = (shape: (typeof PATH_SHAPES)[number]) => {
      const plan = compileSwimPlan(createRng(11), BOUNDS, shape);
      const p = swimPoseAtDistance(plan, plan.totalLength * 0.37);
      return [p.x, p.y, p.z].map((v) => Math.round(v));
    };
    const seen = new Set(PATH_SHAPES.map((s2) => at(s2).join(',')));
    expect(seen.size).toBe(PATH_SHAPES.length);
  });

  it('helix tours the water column; canyon stays low; orbit holds its lane', () => {
    const span = (shape: (typeof PATH_SHAPES)[number]) => {
      const plan = compileSwimPlan(createRng(7), BOUNDS, shape);
      let lo = Infinity, hi = -Infinity;
      for (let d = 0; d <= plan.totalLength; d += plan.totalLength / 96) {
        const y = swimPoseAtDistance(plan, d).y;
        lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
      return hi - lo;
    };
    expect(span('helix')).toBeGreaterThan(35);   // most of the 57-unit column
    expect(span('canyon')).toBeLessThan(16);     // a low ribbon
    expect(span('orbit')).toBeLessThan(18);      // one lane, gentle breathing
  });

  it('default shape is wander and reproduces the pre-shape plan exactly', () => {
    const a = compileSwimPlan(createRng(5), BOUNDS);
    const b = compileSwimPlan(createRng(5), BOUNDS, 'wander');
    expect(a.totalLength).toBe(b.totalLength);
    expect(a.points).toEqual(b.points);
  });
});

describe('crossing (MQ35)', () => {
  const bounds = { radius: 120, yMin: 15, yMax: 72 };
  const rngFor = (seed: number) => createRng(seed);
  it('runs across the camera, not toward it', () => {
    for (const az of [0, 35, 90, 200]) {
      const plan = compileSwimPlan(rngFor(3), bounds, 'crossing', { cameraAzimuthDeg: az });
      const a = (az * Math.PI) / 180;
      const rx = Math.cos(a), rz = -Math.sin(a);   // screen-right
      const dx = Math.sin(a), dz = Math.cos(a);    // toward the camera
      let along = 0, toward = 0;
      for (const [x, , z] of plan.points) {
        along = Math.max(along, Math.abs(x * rx + z * rz));
        toward = Math.max(toward, Math.abs(x * dx + z * dz));
      }
      expect(along).toBeGreaterThan(bounds.radius * 0.8);
      expect(toward).toBeLessThan(along * 0.5);
      expect(toward).toBeGreaterThan(bounds.radius * 0.2); // the return leg is behind, not on top
    }
  });
  it('stays inside the tank and in the middle of the water column', () => {
    const plan = compileSwimPlan(rngFor(9), bounds, 'crossing', { cameraAzimuthDeg: 35 });
    for (const [x, y, z] of plan.points) {
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(bounds.radius);
      expect(y).toBeGreaterThan(bounds.yMin + 10);
      expect(y).toBeLessThan(bounds.yMax);
    }
  });
  it('is listed, and the other shapes ignore the camera', () => {
    expect(PATH_SHAPES).toContain('crossing');
    const a = compileSwimPlan(rngFor(4), bounds, 'orbit', { cameraAzimuthDeg: 0 });
    const b = compileSwimPlan(rngFor(4), bounds, 'orbit', { cameraAzimuthDeg: 180 });
    expect(a.points).toEqual(b.points);
  });
});
