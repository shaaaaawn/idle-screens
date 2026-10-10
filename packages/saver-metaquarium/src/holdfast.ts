/**
 * A seahorse holds on.
 *
 * A real seahorse spends most of its day with its tail wrapped round a stem
 * (seagrass, a sea whip, a mangrove root), and a courting pair link tails.
 * This is the schedule of that: every so often a minted seahorse stops on its
 * route, swims to a stalk of kelp or a sea whip (or, one of a pair, to its
 * partner), wraps its tail round it, hangs there swaying with it — feeding,
 * looking about — and lets go.
 *
 * The rig's `grip` dial wraps the tail's last three bones into a loop and its
 * `aim` dial swings the loop to either side (breeds/rig/seahorse.py); the
 * `grasp` node sits at the loop's centre. The tank pins `grasp` to the stalk
 * (flora.ts `stemAt`, the plant's own sway), so the seahorse rides the plant.
 *
 * All of it is closed form in (index, t): the bout, how far through it the
 * seahorse is, how long its route has been paused (`seahorseHeld`, which the
 * tank takes off its distance, as it does for a dori's headstand).
 */
import { fishHash } from './swim';
import { seahorsePersonality, type SeahorseTemper } from './seahorse';
import type { FloraStem } from './flora';

/** Seconds to swim to the stem, and to let go and swim back to the route. */
export const HOLD_APPROACH = 4.5;
export const HOLD_RELEASE = 3.5;
/** The route eases to a stop and back over this, at each end of a bout. */
const PAUSE_RAMP = 1;

/** How long each temperament holds on, and how long it swims between holds (seconds). */
const HOLD_TIMES: Record<SeahorseTemper, { hold: number; swim: number }> = {
  // A hunter waits in ambush, as real ones feed; a shy one clings; a dancer and a curious one roam more.
  hunter: { hold: 24, swim: 16 },
  shy: { hold: 26, swim: 14 },
  dancer: { hold: 15, swim: 22 },
  curious: { hold: 13, swim: 24 },
};

export interface HoldCycle {
  /** Seconds from one bout's start to the next. */
  period: number;
  /** The first bout (k = 0) starts here; k = -1 is under way at t = 0 for some. */
  offset: number;
  /** Seconds wrapped on, between arriving and letting go. */
  hold: number;
  /** The bout's whole length: approach, hold, release. */
  length: number;
}

export function holdCycle(index: number): HoldCycle {
  const p = seahorsePersonality(index);
  const base = HOLD_TIMES[p.temper];
  const hold = base.hold * (0.8 + 0.4 * fishHash(index, 1201));
  const swim = base.swim * (0.75 + 0.5 * fishHash(index, 1203));
  const length = HOLD_APPROACH + hold + HOLD_RELEASE;
  const period = length + swim;
  return { period, offset: fishHash(index, 1205) * period, hold, length };
}

export type HoldPhase = 'none' | 'approach' | 'hold' | 'release';

export interface HoldState {
  /** Which bout (its key: a choice made for a bout is kept for all of it). */
  k: number;
  phase: HoldPhase;
  /** Seconds into the bout. */
  into: number;
  /** 0 on its route .. 1 at the stem: how far it has gone over. */
  reach: number;
  /** 0 .. 1: the tail's wrap (the grip dial) — closing as it arrives, opening before it leaves. */
  grip: number;
}

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Where seahorse `index` is in its holding at `t`. Pure. */
export function seahorseHoldAt(index: number, t: number): HoldState {
  const c = holdCycle(index);
  const k = Math.floor((t - c.offset) / c.period);
  const into = t - (k * c.period + c.offset);
  if (into >= c.length) return { k, phase: 'none', into, reach: 0, grip: 0 };
  const A = HOLD_APPROACH, H = c.hold, R = HOLD_RELEASE;
  if (into < A) {
    return { k, phase: 'approach', into, reach: smooth(into / A), grip: smooth((into - 0.55 * A) / (0.45 * A)) };
  }
  if (into < A + H) return { k, phase: 'hold', into, reach: 1, grip: 1 };
  const out = into - A - H;
  return { k, phase: 'release', into, reach: 1 - smooth(out / R), grip: 1 - smooth(out / (0.45 * R)) };
}

/** ∫ smoothstep over 0..x (x in 0..1). */
const rampArea = (x: number): number => x * x * x - (x * x * x * x) / 2;

/** Seconds of route paused within one bout, `span` seconds into it. */
function pausedIn(span: number, length: number): number {
  const r = PAUSE_RAMP, s = Math.max(0, Math.min(span, length));
  let a = r * rampArea(Math.min(s, r) / r) + Math.max(0, Math.min(s, length - r) - r);
  if (s > length - r) a += r * (0.5 - rampArea((length - s) / r));
  return a;
}

/** Everything paused up to `t`, counting the bout under way at t = 0 (k = -1). */
function pausedTo(index: number, t: number): number {
  const c = holdCycle(index);
  const k = Math.floor((t - c.offset) / c.period);
  return (k + 1) * (c.length - PAUSE_RAMP) + pausedIn(t - (k * c.period + c.offset), c.length);
}

/**
 * Seconds of its route a seahorse has spent stopped since t = 0: the tank
 * takes this (× its pace) off the distance it has swum, so the route waits
 * at the place it left and it picks up from there — no dash to catch up.
 */
export function seahorseHeld(index: number, t: number): number {
  return pausedTo(index, t) - pausedTo(index, 0);
}

/** How far (world units) a seahorse will go to a stem; past it, it rests where it is. */
export const STEM_REACH = 46;

/**
 * The stem to hold: the stalk cell nearest where it stopped, a little below
 * it (the tail hangs below the body), skipping stalk too near the root
 * (it would sit in the sand), stalk grown up through a rock (it is inside
 * it), and plants another seahorse holds. -1: none near enough.
 */
export function pickStem(stems: readonly FloraStem[], x: number, y: number, z: number, len: number, taken: ReadonlySet<number>,
  /** The top of anything solid there (a rock, a home): a stalk inside one is hidden. */
  solid: (x: number, z: number) => number = () => -Infinity): number {
  let best = -1, cost = STEM_REACH;
  const want = y - 0.45 * len;
  for (let i = 0; i < stems.length; i++) {
    const s = stems[i]!;
    if (s.y - s.root < 0.35 * len || taken.has(s.plant)) continue;
    const c0 = Math.hypot(s.x - x, s.z - z) + 0.6 * Math.abs(s.y - want);
    if (c0 >= cost || s.y < solid(s.x, s.z) + 0.3 * len) continue;
    const c = Math.hypot(s.x - x, s.z - z) + 0.6 * Math.abs(s.y - want);
    if (c < cost) { cost = c; best = i; }
  }
  return best;
}
