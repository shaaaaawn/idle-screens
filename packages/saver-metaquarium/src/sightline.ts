/**
 * The follow camera's sightline: keep the followed fish in view when
 * something stands between it and the camera.
 *
 * The chase camera stands a fixed distance from its fish, so in a village it
 * ends up behind a house, a castle wall, a lamp or a kelp stand, and the shot
 * is a wall. A game camera's spring arm shortens toward its target instead;
 * this is that arm, made of two moves:
 *
 *   boom   a small rise, capped (`BOOM_MAX`), for low clutter — a fence, a
 *          mailbox, a lamp — that the camera can simply look over;
 *   pull   for anything taller (a home, a wall), the arm shortens to just in
 *          front of it, never closer than `minBack` (the follow camera's
 *          point-of-view threshold: a wall must not flip the shot into the
 *          fish's own eye).
 *
 * Pure and continuous: the heights come from a smooth field (canopy.ts — the
 * ground, the scenery's domes and the plants' sway, dilated and blurred), the
 * line is sampled at fixed fractions, and each sample's demand is a smoothstep
 * of its deficit — so the max and min over them are continuous too (they may
 * kink, never jump): as the fish walks past a house the camera eases in and
 * out instead of snapping, and a frame is still a function of t.
 * Moving fish are not obstacles: a camera that reacted to every passer-by
 * would never hold still.
 */

export interface Vec3 { x: number; y: number; z: number }

export interface SightlineInput {
  /** What the camera must see: the followed fish (its body's middle, not its feet). */
  target: Vec3;
  /** Where the chase camera would stand with nothing in the way. */
  camera: Vec3;
  /** How tall things stand at (x, z): ground, scenery and plants. */
  height: (x: number, z: number) => number;
  /** The closest the camera may come to the target along the arm. */
  minBack: number;
  /** How hard to apply it, 0..1 (`followAvoid`): 0 returns `camera` unchanged. */
  amount: number;
  /** The water's surface, or null: the boom never lifts the camera through it. */
  ceiling: number | null;
}

/** The highest the camera rises to look over clutter before it pulls in instead. */
export const BOOM_MAX = 16;
/** How far above whatever stands in the way the line must pass. */
export const MARGIN = 3;
/** Where along the arm (target → camera) the line is tested. The first stretch is the fish's own body. */
const FRACTIONS: readonly number[] = Array.from({ length: 28 }, (_, i) => 0.12 + (0.88 * (i + 1)) / 28);
/** How much deficit (world units) it takes for a sample to pull the arm in fully: the softness of the pull. */
const SOFT = 30;
/** Where the boom stops tracking the rise exactly and eases into its cap. */
const KNEE = 0.75;
/** The boom answers only obstacles past this fraction of the arm. */
const BOOM_FROM = 0.4;
/** And the pull only those past this one. */
const PULL_FROM = 0.3;

const smooth = (e0: number, e1: number, x: number): number => {
  const u = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return u * u * (3 - 2 * u);
};
/** How far below the clear line each sample of the arm sits (positive: blocked). */
function deficits(t: Vec3, c: Vec3, height: (x: number, z: number) => number): number[] {
  return FRACTIONS.map((f) => {
    const x = t.x + (c.x - t.x) * f, y = t.y + (c.y - t.y) * f, z = t.z + (c.z - t.z) * f;
    return height(x, z) + MARGIN - y;
  });
}

/** Where the chase camera stands so the fish stays in view. */
export function clearSightline(i: SightlineInput): Vec3 {
  const { target: t, camera: c0, height, amount } = i;
  if (!(amount > 0)) return c0;
  // 1 · The boom: raising the camera by r lifts the line at fraction f by f·r,
  // so the rise that clears a sample is its deficit over f. The max over the
  // arm, eased into BOOM_MAX (and the ceiling); anything taller is left to the pull.
  const d0 = deficits(t, c0, height);
  // Only the far part of the arm: lifting the camera barely moves the line near the fish (f is small), so a
  // near obstacle would ask for a huge, steep boom — that one is the pull's.
  const rises = d0.map((d, k) => (FRACTIONS[k]! < BOOM_FROM ? 0 : d / FRACTIONS[k]!));
  let boom = Math.max(0, ...rises);
  // Exact up to the knee, then eased into the cap with the same slope (no kink in how it rises).
  const knee = BOOM_MAX * KNEE, rest = BOOM_MAX - knee;
  if (boom > knee) boom = knee + rest * (1 - Math.exp(-(boom - knee) / rest));
  if (i.ceiling !== null) boom = Math.max(0, Math.min(boom, i.ceiling - 6 - c0.y));
  const c1 = { x: c0.x, y: c0.y + boom, z: c0.z };
  // 2 · The pull: each sample still blocked (softly) wants the arm no longer
  // than its own fraction, less a little; the arm is the min of them all.
  const d1 = deficits(t, c1, height);
  const len = Math.hypot(c1.x - t.x, c1.y - t.y, c1.z - t.z) || 1;
  const floorFrac = Math.min(1, i.minBack / len);
  const wants = d1.map((d, k) => {
    // Something round the fish itself (it stands in a kelp clump): pulling in only drives the camera into it.
    if (FRACTIONS[k]! < PULL_FROM) return 1;
    const b = smooth(0, SOFT, d);
    return 1 + (Math.max(floorFrac, FRACTIONS[k]! - 0.06) - 1) * b;
  });
  const frac = Math.max(floorFrac, Math.min(1, ...wants));
  const c2 = { x: t.x + (c1.x - t.x) * frac, y: t.y + (c1.y - t.y) * frac, z: t.z + (c1.z - t.z) * frac };
  // 3 · `amount` blends from the plain chase camera to the cleared one.
  return { x: c0.x + (c2.x - c0.x) * amount, y: c0.y + (c2.y - c0.y) * amount, z: c0.z + (c2.z - c0.z) * amount };
}
