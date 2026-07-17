import type { Rng } from '@idle-screens/core';

/**
 * Analytic swim: every fish follows a closed Lissajous-style wander through the
 * tank volume, so position AND heading are pure functions of `t`. This is what
 * makes `renderFrame(t, seed)` frame-addressable — no per-frame accumulation,
 * no wall clock (the two determinism sins of the original Metaquarium swim).
 */
export interface FishPath {
  /** Horizontal wander radii (world units). */
  rx: number;
  rz: number;
  /** Resting depth and vertical bob amplitude. */
  y0: number;
  ay: number;
  /** Angular frequencies (rad/s) — incommensurate so paths never visibly repeat. */
  wx: number;
  wz: number;
  wy: number;
  /** Phase offsets. */
  px: number;
  pz: number;
  py: number;
  /** Swim-clip time offset so a school never beats in sync. */
  clipOffset: number;
  /** Uniform scale jitter per fish. */
  scale: number;
}

export interface TankBounds {
  /** Half-extent of the wander volume in x/z. */
  radius: number;
  yMin: number;
  yMax: number;
}

export interface FishPose {
  x: number;
  y: number;
  z: number;
  /** Unit-ish heading (path tangent); callers lookAt(position + heading). */
  hx: number;
  hy: number;
  hz: number;
}

/** Draw a fish's path constants from a forked rng stream. Deterministic per (seed, fish index). */
export function makeFishPath(rng: Rng, bounds: TankBounds): FishPath {
  const span = bounds.yMax - bounds.yMin;
  return {
    rx: bounds.radius * (0.45 + rng.next() * 0.5),
    rz: bounds.radius * (0.45 + rng.next() * 0.5),
    y0: bounds.yMin + span * (0.25 + rng.next() * 0.5),
    ay: span * (0.05 + rng.next() * 0.12),
    wx: 0.05 + rng.next() * 0.08,
    wz: 0.06 + rng.next() * 0.09,
    wy: 0.18 + rng.next() * 0.22,
    px: rng.next() * Math.PI * 2,
    pz: rng.next() * Math.PI * 2,
    py: rng.next() * Math.PI * 2,
    clipOffset: rng.next() * 10,
    scale: 0.8 + rng.next() * 0.5,
  };
}

/** Pose at time `tSec` (seconds), speed-scaled. Pure: same inputs, same pose. */
export function fishPose(p: FishPath, tSec: number, speed = 1): FishPose {
  const t = tSec * speed;
  const ax = p.wx * t + p.px;
  const az = p.wz * t + p.pz;
  const ayp = p.wy * t + p.py;
  const x = p.rx * Math.sin(ax);
  const z = p.rz * Math.sin(az);
  const y = p.y0 + p.ay * Math.sin(ayp);
  // Analytic tangent (d/dt), normalized enough for lookAt.
  const hx = p.rx * p.wx * Math.cos(ax);
  const hz = p.rz * p.wz * Math.cos(az);
  const hy = p.ay * p.wy * Math.cos(ayp) * 0.35; // damp pitch so fish stay level-ish
  const m = Math.hypot(hx, hy, hz) || 1;
  return { x, y, z, hx: hx / m, hy: hy / m, hz: hz / m };
}
