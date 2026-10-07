import { createRng } from '@idle-screens/core';
import { describe, expect, it } from 'vitest';
import { chordHeading, chordPose, chordTurn, dodgeClimb, dodgeTurn, inFront, turnDial } from './heading';
import { compileSwimPlan, PATH_SHAPES, swimPoseAtDistance } from './plan';

const BOUNDS = { radius: 120, yMin: 15, yMax: 72 };
const wrap = (a: number): number => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;

describe('heading: a fish faces along its route without snapping', () => {
  it('turns no faster than the route\'s own tangent — far less on the hairpins of `wander`', () => {
    // A frame's travel is ~0.3 units. Count steps that swing the bearing over 0.1 rad.
    let tangent = 0, chord = 0, tangentMax = 0, chordMax = 0;
    for (const shape of PATH_SHAPES) for (let seed = 1; seed <= 6; seed++) {
      const plan = compileSwimPlan(createRng(seed).fork(3), BOUNDS, shape, { cameraAzimuthDeg: 30 });
      let pt = 0, pc = 0;
      for (let d = 0; d < plan.totalLength; d += 0.3) {
        const t = swimPoseAtDistance(plan, d), c = chordHeading(plan, d, 27);
        const yt = Math.atan2(t.fx, t.fz), yc = Math.atan2(c.fx, c.fz);
        if (d > 0) {
          const a = Math.abs(wrap(yt - pt)), b = Math.abs(wrap(yc - pc));
          tangentMax = Math.max(tangentMax, a); chordMax = Math.max(chordMax, b);
          if (a > 0.1) tangent++;
          if (b > 0.1) chord++;
        }
        pt = yt; pc = yc;
      }
    }
    expect(chord).toBeLessThan(tangent * 0.5);
    expect(chordMax).toBeLessThan(tangentMax);
  });

  it('is a unit direction, climbing under ~45°', () => {
    const plan = compileSwimPlan(createRng(7).fork(3), BOUNDS, 'wander');
    for (let d = 0; d < plan.totalLength; d += 3.1) {
      const h = chordHeading(plan, d, 27);
      expect(Math.hypot(h.fx, h.fy, h.fz)).toBeCloseTo(1, 6);
      expect(Math.abs(h.fy)).toBeLessThanOrEqual(0.7 + 1e-9);
    }
  });

  it('chordPose keeps the route\'s place, takes the chord\'s facing, and banks no more than 0.35', () => {
    const plan = compileSwimPlan(createRng(9).fork(3), BOUNDS, 'wander');
    for (let d = 0; d < plan.totalLength; d += 7.3) {
      const p = chordPose(plan, d, 18), r = swimPoseAtDistance(plan, d), h = chordHeading(plan, d, 27);
      expect([p.x, p.y, p.z]).toEqual([r.x, r.y, r.z]);
      expect([p.fx, p.fy, p.fz]).toEqual([h.fx, h.fy, h.fz]);
      expect(Math.abs(p.roll)).toBeLessThanOrEqual(0.35);
    }
  });

  it('chordTurn is the bearing\'s change over a body length, + to its left', () => {
    const plan = compileSwimPlan(createRng(4).fork(3), BOUNDS, 'orbit');
    for (let d = 50; d < 400; d += 17) {
      const a = chordHeading(plan, d, 27), b = chordHeading(plan, d - 18, 27);
      expect(chordTurn(plan, d, 18)).toBeCloseTo(wrap(Math.atan2(a.fx, a.fz) - Math.atan2(b.fx, b.fz)), 9);
    }
  });
});

describe('heading: the dodge', () => {
  it('turns by the dodge\'s sideways share — never flipping as it comes round to oppose the swim', () => {
    // A dodge rate of fixed size swept right round the swim's direction: the
    // turn is continuous (the old angle of swim + dodge flipped ±0.5 here).
    let prev = dodgeTurn(0, 8, 0, 3), worst = 0;
    for (let a = 0.01; a <= Math.PI * 2; a += 0.01) {
      const t = dodgeTurn(0, 8, 3 * Math.sin(a), 3 * Math.cos(a));
      worst = Math.max(worst, Math.abs(t - prev));
      prev = t;
    }
    expect(worst).toBeLessThan(0.02);
  });

  it('is held under its limit, eases in from nothing, and is less for a fish hardly moving', () => {
    expect(dodgeTurn(0, 8, 0, 0)).toBe(0);
    expect(dodgeTurn(0, 0, 5, 0)).toBe(0);
    expect(Math.abs(dodgeTurn(0, 8, 0.05, 0))).toBeLessThan(0.005);
    for (const r of [1, 5, 50]) expect(Math.abs(dodgeTurn(0, 8, r, 0))).toBeLessThanOrEqual(0.3);
    expect(Math.abs(dodgeTurn(0, 1, 2, 0))).toBeLessThan(Math.abs(dodgeTurn(0, 8, 16, 0)));
    // Its sign: a dodge to +x, the swim along +z — the heading angle atan2(x, z) grows.
    expect(dodgeTurn(0, 8, 3, 0)).toBeGreaterThan(0);
    expect(Math.abs(dodgeClimb(100, 8))).toBeLessThanOrEqual(0.25);
    expect(dodgeClimb(2, 8)).toBeGreaterThan(0);
  });
});

describe('heading: a rigged fish\'s turn and its viewer', () => {
  it('turnDial compresses: a gentle curve shows, a hairpin leans hard over without pinning', () => {
    expect(turnDial(0, 0.5)).toBe(0);
    expect(turnDial(0.3, 0.5)).toBeGreaterThan(0.14);
    expect(turnDial(1.7, 0.5)).toBeCloseTo(0.69, 2);
    expect(turnDial(6, 0.5)).toBeLessThan(1);
    expect(turnDial(-1.7, 0.5)).toBeCloseTo(-turnDial(1.7, 0.5), 12);
  });

  it('inFront: the viewer counts ahead, fades to the side, and is nothing behind — so the ±π wrap never shows', () => {
    expect(inFront(0)).toBe(1);
    expect(inFront(Math.PI / 3)).toBeCloseTo(1, 6);
    expect(inFront(1.6)).toBeGreaterThan(0);
    expect(inFront(1.6)).toBeLessThan(0.5);
    expect(inFront(Math.PI * 0.6)).toBe(0);
    expect(inFront(Math.PI)).toBe(0);
    expect(inFront(-Math.PI)).toBe(0);
  });
});
