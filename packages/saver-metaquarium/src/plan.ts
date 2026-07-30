import type { Rng } from '@idle-screens/core';

export interface TankBounds {
  radius: number;
  yMin: number;
  yMax: number;
}

/**
 * Catmull-Rom spline swim: a seeded closed loop of waypoints with arc-length
 * parameterization. Pose is a pure function of (plan, distance), so
 * `renderFrame(t, seed)` stays frame-addressable and scrubbing works.
 */

export interface SwimPlan {
  /** Closed-loop control points. */
  points: Array<[number, number, number]>;
  /** Arc-length lookup: cumulative length at N uniform spline params. */
  arc: Float32Array;
  totalLength: number;
  /** Cruise speed, units/sec, before the swimSpeed param scales it. */
  cruise: number;
  /** Speed-wobble harmonics (closed-form integral → distance). */
  wobble: Array<{ amp: number; w: number; phase: number }>;
}

export interface SwimPose {
  x: number;
  y: number;
  z: number;
  /** Unit forward tangent — the fish noses along this. */
  fx: number;
  fy: number;
  fz: number;
  /** Bank roll (radians): lean into horizontal turns. */
  roll: number;
  /** Distance travelled (drives the tail-beat clip phase). */
  dist: number;
}

const ARC_SAMPLES = 1024;

function catmullRom(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  u: number,
): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  );
}

/** Point on the closed loop at global param `g` ∈ [0, n). */
function splineAt(points: SwimPlan['points'], g: number): [number, number, number] {
  const n = points.length;
  const i = Math.floor(g) % n;
  const u = g - Math.floor(g);
  const p0 = points[(i - 1 + n) % n]!;
  const p1 = points[i]!;
  const p2 = points[(i + 1) % n]!;
  const p3 = points[(i + 2) % n]!;
  return [
    catmullRom(p0[0], p1[0], p2[0], p3[0], u),
    catmullRom(p0[1], p1[1], p2[1], p3[1], u),
    catmullRom(p0[2], p1[2], p2[2], p3[2], u),
  ];
}

/**
 * Compile a seeded itinerary through the tank volume. Waypoints alternate
 * around the ring (angle jitter, radius breathing, depth changes) so the
 * loop reads as purposeful wandering, never a circle.
 */
export function compileSwimPlan(rng: Rng, bounds: TankBounds): SwimPlan {
  const n = 16 + rng.int(0, 4);
  const points: SwimPlan['points'] = [];
  const ySpan = bounds.yMax - bounds.yMin;
  for (let i = 0; i < n; i++) {
    const baseAngle = (i / n) * Math.PI * 2;
    const angle = baseAngle + rng.range(-0.25, 0.25);
    const inner = i % 2 === 0;
    const radius = inner
      ? bounds.radius * rng.range(0.15, 0.45)
      : bounds.radius * rng.range(0.55, 0.85);
    const y = bounds.yMin + ySpan * rng.range(0.2, 0.8);
    points.push([Math.cos(angle) * radius, y, Math.sin(angle) * radius]);
  }

  // Arc-length table over the closed loop.
  const arc = new Float32Array(ARC_SAMPLES + 1);
  let prev = splineAt(points, 0);
  let total = 0;
  for (let s = 1; s <= ARC_SAMPLES; s++) {
    const g = (s / ARC_SAMPLES) * n;
    const p = splineAt(points, g);
    total += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    arc[s] = total;
    prev = p;
  }

  // Cruise + gentle speed wobble: sometimes dawdling, sometimes keen — the
  // integral of each harmonic is closed-form, so distance(t) never drifts.
  const cruise = 8 + rng.range(0, 4);
  const wobble = [
    { amp: cruise * 0.18, w: 0.11 + rng.range(0, 0.05), phase: rng.range(0, Math.PI * 2) },
    { amp: cruise * 0.1, w: 0.043 + rng.range(0, 0.02), phase: rng.range(0, Math.PI * 2) },
  ];

  return { points, arc, totalLength: total, cruise, wobble };
}

/** Distance travelled by time `tSec` at `speed` scale — pure closed form. */
export function distanceAt(plan: SwimPlan, tSec: number, speed: number): number {
  let d = plan.cruise * tSec;
  for (const h of plan.wobble) {
    // ∫ amp·sin(w·t + φ) dt = −(amp/w)·cos(w·t + φ); anchored so d(0) = 0.
    d += (h.amp / h.w) * (Math.cos(h.phase) - Math.cos(h.w * tSec + h.phase));
  }
  return d * speed;
}

/** Global spline param for a given arc distance (binary search + lerp). */
function paramForDistance(plan: SwimPlan, dist: number): number {
  const n = plan.points.length;
  const d = ((dist % plan.totalLength) + plan.totalLength) % plan.totalLength;
  const arc = plan.arc;
  let lo = 0;
  let hi = ARC_SAMPLES;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (arc[mid]! <= d) lo = mid;
    else hi = mid;
  }
  const seg = arc[hi]! - arc[lo]! || 1;
  const frac = (d - arc[lo]!) / seg;
  return ((lo + frac) / ARC_SAMPLES) * n;
}

/** Pose at `tSec` — position, unit forward tangent, bank roll, distance. */
export function swimPoseAt(plan: SwimPlan, tSec: number, speed = 1): SwimPose {
  return swimPoseAtDistance(plan, distanceAt(plan, tSec, speed));
}

/** Pose at an explicit arc distance — the seam for behavior-modulated speed
 *  (the tank integrates distance so speed changes glide instead of
 *  teleporting; scrubs reset to the closed-form distance). */
export function swimPoseAtDistance(plan: SwimPlan, dist: number): SwimPose {
  const g = paramForDistance(plan, dist);
  const [x, y, z] = splineAt(plan.points, g);

  const step = (plan.points.length / ARC_SAMPLES) * 8;
  const ahead = splineAt(plan.points, g + step);
  const behind = splineAt(plan.points, g - step + plan.points.length);
  let fx = ahead[0] - behind[0];
  let fy = ahead[1] - behind[1];
  let fz = ahead[2] - behind[2];
  const m = Math.hypot(fx, fy, fz) || 1;
  fx /= m;
  fy /= m;
  fz /= m;

  // Bank: signed change of horizontal heading over the step → lean into it.
  const h0 = Math.atan2(z - behind[2], x - behind[0]);
  const h1 = Math.atan2(ahead[2] - z, ahead[0] - x);
  let turn = h1 - h0;
  if (turn > Math.PI) turn -= Math.PI * 2;
  if (turn < -Math.PI) turn += Math.PI * 2;
  const roll = Math.max(-0.35, Math.min(0.35, turn * 3.5));

  return { x, y, z, fx, fy, fz, roll, dist };
}
