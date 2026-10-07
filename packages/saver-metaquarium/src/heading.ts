/**
 * Which way a fish faces, drawn so it never snaps.
 *
 * Measured live (2026-10-07, every breed): a fish's drawn heading jumped up to
 * 2 rad in a single frame, from two causes, both closed forms of time:
 *
 *  - its route's tangent: `swimPoseAtDistance` takes a short chord, and a
 *    route that hairpins swings right round within a few frames;
 *  - its dodge: the turn was the angle of (route velocity + dodge velocity),
 *    so a dodge pushing against the swim swung that sum through zero and the
 *    turn flipped from +0.5 to -0.5 rad; and a hard gate switched it on and
 *    off whole.
 *
 * Both stay pure in time here (no smoothing state, so every display draws the
 * same frames): the heading is a chord along the route — its bearing over
 * three body lengths, its climb over one — and the dodge turns it by the
 * dodge's SIDEWAYS share only, eased in from nothing and compressed.
 */
import { swimPoseAtDistance, type SwimPlan, type SwimPose } from './plan';

/**
 * The route's direction at `d`, unit (fx fy fz). Its compass bearing (yaw)
 * from the HORIZONTAL chord across `half` either side; its climb from the
 * chord across a third of that, held under ~45°. Separately because a route
 * that climbs near vertical has no bearing at all on its short chord — it
 * flipped 180° there in a frame (measured) — while the wide chord still runs
 * from where the climb began to where it ends.
 */
export function chordHeading(plan: SwimPlan, d: number, half: number): { fx: number; fy: number; fz: number } {
  const a = swimPoseAtDistance(plan, d - half), b = swimPoseAtDistance(plan, d + half);
  let hx = b.x - a.x, hz = b.z - a.z;
  const hm = Math.hypot(hx, hz);
  // A route that loops back within the window (a tight circle, a vertical
  // loop) leaves the wide chord short and turning fast: hand over to the
  // bearing of a chord a third as wide, smoothly by how short the wide one
  // is (a hard switch toggled frame to frame — measured).
  const near = smooth(1 - hm / (half * 0.6));
  const m = swimPoseAtDistance(plan, d - half / 3), n = swimPoseAtDistance(plan, d + half / 3);
  const sx = n.x - m.x, sz = n.z - m.z, sm = Math.hypot(sx, sz) || 1;
  hx = (hm > 1e-9 ? hx / hm : 0) * (1 - near) + (sx / sm) * near;
  hz = (hm > 1e-9 ? hz / hm : 0) * (1 - near) + (sz / sm) * near;
  const hl = Math.hypot(hx, hz) || 1;
  hx /= hl; hz /= hl;
  const run = Math.hypot(n.x - m.x, n.z - m.z), rise = n.y - m.y;
  const fy = Math.max(-0.7, Math.min(0.7, rise / (Math.hypot(run, rise) || 1)));
  const k = Math.sqrt(1 - fy * fy);
  return { fx: hx * k, fy, fz: hz * k };
}

/** The pose at `d`, facing along `chordHeading` (bearing over three body lengths). */
export function chordPose(plan: SwimPlan, d: number, length: number): SwimPose {
  const p = swimPoseAtDistance(plan, d);
  const h = chordHeading(plan, d, length * 1.5);
  // Its bank into the turn, from the same chords across a body length (the
  // route's own roll comes off a short chord and flipped ±0.35 on a hairpin).
  const a = chordHeading(plan, d - length * 0.5, length * 1.5), b = chordHeading(plan, d + length * 0.5, length * 1.5);
  let turn = Math.atan2(b.fx, b.fz) - Math.atan2(a.fx, a.fz);
  turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
  return { ...p, fx: h.fx, fy: h.fy, fz: h.fz, roll: 0.35 * Math.tanh(turn * 1.2) };
}

/** How far a dodge's climb tips the nose (added to the heading's y), compressed like its turn. */
export function dodgeClimb(ry: number, hl: number, limit = 0.25): number {
  return limit * Math.tanh((ry / Math.max(hl, 4)) * 0.6 / limit);
}

/** Its heading's change over one body length behind it (radians, + to its left), from the chords. */
export function chordTurn(plan: SwimPlan, d: number, length: number): number {
  const a = chordHeading(plan, d, length * 1.5), b = chordHeading(plan, d - length, length * 1.5);
  let turn = Math.atan2(a.fx, a.fz) - Math.atan2(b.fx, b.fz);
  turn -= Math.round(turn / (Math.PI * 2)) * Math.PI * 2;
  return turn;
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * How far a dodge turns the nose (radians, + to its left): from the dodge
 * velocity's component across the swim (rx, rz) against the swim's own
 * (vx, vz). The forward share never flips it; a dodge too small to read
 * eases in from nothing; held to `limit` either way and less for a fish
 * hardly moving (a sideways shuffle is not a heading).
 */
export function dodgeTurn(vx: number, vz: number, rx: number, rz: number, limit = 0.3): number {
  const hl = Math.hypot(vx, vz);
  if (hl < 1e-6) return 0;
  const ux = vx / hl, uz = vz / hl;
  // Across the swim, signed as the heading angle atan2(x, z) turns (+ to its left).
  const side = rx * uz - rz * ux;
  const ahead = rx * ux + rz * uz;
  const turn = Math.atan2(side, Math.max(hl + ahead, hl * 0.5));
  const r = Math.hypot(rx, rz);
  // Compressed, never clipped: a dodge's rate reverses as the pair passes,
  // and a nose held hard over until then swung the whole way in a few frames.
  return limit * Math.tanh((turn * 0.6) / limit) * Math.min(1, hl / 4) * smooth(r / 0.5);
}

/**
 * A rigged fish's turn as a dial setting, -1..1: compressed, so a hairpin
 * leans hard over without pinning it there, and a gentle curve still shows.
 * `gain` is per breed (its dial's reach against the routes' turns).
 */
export function turnDial(turn: number, gain: number): number {
  return Math.tanh(turn * gain);
}

/**
 * 0..1: how far the viewer is in front of a fish, from their yaw off its
 * nose (radians). Full within ~60°, nothing past ~100° — a fish does not
 * crane round to look behind itself, and its yaw there wraps through ±π
 * (measured live: a head snapping from hard left to hard right).
 */
export function inFront(yaw: number): number {
  return smooth((Math.cos(yaw) + 0.15) / 0.65);
}
