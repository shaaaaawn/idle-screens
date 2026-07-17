import { describe, it, expect } from 'vitest';
import { createRng } from '@idle-screens/core';
import { makeFishPath, fishPose, type TankBounds } from './swim';

const BOUNDS: TankBounds = { radius: 100, yMin: 10, yMax: 90 };

describe('metaquarium swim', () => {
  it('same seed yields identical paths and poses (determinism)', () => {
    const a = makeFishPath(createRng(7).fork(3), BOUNDS);
    const b = makeFishPath(createRng(7).fork(3), BOUNDS);
    expect(a).toEqual(b);
    expect(fishPose(a, 123.456)).toEqual(fishPose(b, 123.456));
  });

  it('different fork salts yield different paths', () => {
    const rng = createRng(7);
    const a = makeFishPath(rng.fork(1), BOUNDS);
    const b = makeFishPath(rng.fork(2), BOUNDS);
    expect(a).not.toEqual(b);
  });

  it('pose is pure in t — no accumulation, seekable in any order', () => {
    const p = makeFishPath(createRng(1).fork(0), BOUNDS);
    const late = fishPose(p, 500);
    fishPose(p, 0.1);
    fishPose(p, 9999);
    expect(fishPose(p, 500)).toEqual(late);
  });

  it('stays inside the tank volume', () => {
    const rng = createRng(42);
    for (let i = 0; i < 20; i++) {
      const p = makeFishPath(rng.fork(i), BOUNDS);
      for (let t = 0; t < 600; t += 7.3) {
        const pose = fishPose(p, t);
        expect(Math.abs(pose.x)).toBeLessThanOrEqual(BOUNDS.radius);
        expect(Math.abs(pose.z)).toBeLessThanOrEqual(BOUNDS.radius);
        expect(pose.y).toBeGreaterThanOrEqual(BOUNDS.yMin);
        expect(pose.y).toBeLessThanOrEqual(BOUNDS.yMax);
      }
    }
  });

  it('heading is normalized (usable for lookAt)', () => {
    const p = makeFishPath(createRng(5).fork(0), BOUNDS);
    const pose = fishPose(p, 42);
    expect(Math.hypot(pose.hx, pose.hy, pose.hz)).toBeCloseTo(1, 5);
  });
});
