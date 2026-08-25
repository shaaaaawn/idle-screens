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
 * The shape a fish's loop is drawn on. Every shape emits WAYPOINTS and feeds
 * the same Catmull-Rom + arc-length machinery, so `distanceAt`, anchors,
 * effort, and every downstream consumer work unchanged — a shape is a
 * different itinerary, not a different engine.
 *
 * - `wander` — the original: alternating inner/outer ring, purposeful roaming
 * - `orbit`  — steady carousel laps at a seeded radius and depth
 * - `eight`  — a lissajous figure-eight crossing the tank's middle
 * - `helix`  — climbing-then-diving spiral column, the water-column tour
 * - `canyon` — long low sweeps hugging one axis, back and forth near the floor
 */
export type PathShape = 'wander' | 'orbit' | 'eight' | 'helix' | 'canyon';
export const PATH_SHAPES: readonly PathShape[] = ['wander', 'orbit', 'eight', 'helix', 'canyon'];

function shapeWaypoints(shape: PathShape, rng: Rng, bounds: TankBounds): SwimPlan['points'] {
  const points: SwimPlan['points'] = [];
  const ySpan = bounds.yMax - bounds.yMin;
  if (shape === 'orbit') {
    // A near-circle with gentle radius/height breathing — reads as a patrol
    // lap, not a mechanical ring.
    const n = 14 + rng.int(0, 4);
    const r0 = bounds.radius * rng.range(0.45, 0.8);
    const y0 = bounds.yMin + ySpan * rng.range(0.25, 0.75);
    const dir = rng.next() < 0.5 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const a = dir * (i / n) * Math.PI * 2;
      const r = r0 * (1 + rng.range(-0.08, 0.08));
      points.push([Math.cos(a) * r, y0 + ySpan * rng.range(-0.08, 0.08), Math.sin(a) * r]);
    }
    return points;
  }
  if (shape === 'eight') {
    // Lissajous 1:2 — one crossing at the centre, the whole tank traversed.
    const n = 20 + rng.int(0, 4);
    const rx = bounds.radius * rng.range(0.6, 0.85);
    const rz = bounds.radius * rng.range(0.35, 0.55);
    const y0 = bounds.yMin + ySpan * rng.range(0.3, 0.7);
    const phase = rng.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const u = (i / n) * Math.PI * 2;
      points.push([
        Math.sin(u + phase) * rx,
        y0 + Math.sin(u * 2 + phase) * ySpan * 0.12,
        Math.sin(u * 2 + phase * 2) * rz,
      ]);
    }
    return points;
  }
  if (shape === 'helix') {
    // Two turns climbing, two diving — the closed loop tours the whole
    // water column and comes home.
    const n = 24;
    const r0 = bounds.radius * rng.range(0.35, 0.6);
    const phase = rng.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const a = phase + u * Math.PI * 4;
      // Triangle wave 0→1→0 over the loop keeps it closed.
      const climb = 1 - Math.abs(1 - 2 * u);
      points.push([
        Math.cos(a) * r0,
        bounds.yMin + ySpan * (0.1 + climb * 0.8),
        Math.sin(a) * r0,
      ]);
    }
    return points;
  }
  if (shape === 'canyon') {
    // Long low sweeps along one seeded axis: far end, turn, come back a
    // little offset — a flat ribbon near the floor.
    const n = 16;
    const axis = rng.range(0, Math.PI);
    const ax = Math.cos(axis), az = Math.sin(axis);
    const y0 = bounds.yMin + ySpan * rng.range(0.08, 0.28);
    const len = bounds.radius * 0.85;
    // ONE seeded ribbon width — per-point redraws made the edges jagged
    // instead of a clean sweep; the y jitter below stays per-point, that one
    // IS the organic part.
    const width = bounds.radius * rng.range(0.12, 0.3);
    for (let i = 0; i < n; i++) {
      const u = (i / n) * Math.PI * 2;
      const along = Math.sin(u) * len;
      const across = Math.cos(u) * width;
      points.push([
        ax * along - az * across,
        y0 + ySpan * rng.range(0, 0.08),
        az * along + ax * across,
      ]);
    }
    return points;
  }
  // wander — the original body, verbatim.
  const n = 16 + rng.int(0, 4);
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
  return points;
}

/**
 * Compile a seeded itinerary through the tank volume. The default `wander`
 * waypoints alternate around the ring (angle jitter, radius breathing, depth
 * changes) so the loop reads as purposeful wandering, never a circle; other
 * shapes swap the waypoints and keep everything else.
 */
export function compileSwimPlan(rng: Rng, bounds: TankBounds, shape: PathShape = 'wander'): SwimPlan {
  const points = shapeWaypoints(shape, rng, bounds);
  const n = points.length;

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

/** Pose at an explicit arc distance — the seam for behavior-modulated speed.
 *  When the track steers swimSpeed, the tank feeds this the closed-form
 *  integral of the speed curve (core's `integrateParam`) so speed changes
 *  glide instead of teleporting, while staying a pure function of (t, track)
 *  — scrubbing and renderFrame(t) keep working. */
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
