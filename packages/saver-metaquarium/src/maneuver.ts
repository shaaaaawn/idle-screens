import { fishHash } from './swim';

/**
 * MANEUVERS — the catwalk lesson brought underwater.
 *
 * What made the cat feel alive was never its walk cycle; it was the compiled
 * performance — named events a viewer recognizes, seeded so every display
 * agrees, closed-form so any frame is addressable. Fish get the same: each
 * fish carries a seeded schedule of EVENTS layered over its swim style.
 *
 * The physics stays frame-addressable by working in DISPLACEMENT, never in
 * rate: an event advances a fish along its own path by a smooth S-curve
 * (surge then coast), and kicks it sideways with a bump that closes back to
 * zero. Position remains a pure function of (t, seed) — a speed multiplier
 * would have required integrating, which is the one thing this saver never
 * does.
 *
 * The schedule is periodic-with-jitter: event k of fish i fires at
 * `(k + hash(i, k)) * interval`, so only the neighbouring events can be live
 * at any instant — O(1) per fish per frame, and a display that mounts late
 * computes the same pulses as one that watched from the start.
 *
 * The vocabulary:
 * - `dart`    — a forward surge that coasts off; the startled sprint
 * - `startle` — a hard sideways scatter kick, then regroup on the old line
 * - `graze`   — the opposite: drop back and nose down, as if feeding, move on
 * - `curious` — a slow sideways excursion, something caught its eye
 * - `zoomies` — three surges packed nose to tail; the tail-chasing hour
 */
export type Maneuver = 'none' | 'dart' | 'startle' | 'graze' | 'curious' | 'zoomies';
export const MANEUVERS: readonly Maneuver[] = ['none', 'dart', 'startle', 'graze', 'curious', 'zoomies'];

export interface ManeuverSpec {
  name: Maneuver;
  /** Seconds one event lasts at intensity 1. */
  dur: number;
  /** Mean seconds between events at rate 1 (stretched as rate falls). */
  interval: number;
  /** Net advance along the fish's own path over the event, body lengths.
   *  Negative = dropping back (a pause, seen from the shoal). */
  advance: number;
  /** Peak lateral kick, body lengths. Returns to zero by the event's end. */
  kick: number;
  /** Vertical share of the kick, -1..1 (graze noses down). */
  lift: number;
  /** Extra body-wiggle at the surge's peak (the tail works harder). */
  flurry: number;
  /** Sub-surges inside one event (zoomies packs three). */
  bursts: number;
}

const SPECS: Record<Exclude<Maneuver, 'none'>, ManeuverSpec> = {
  dart:    { name: 'dart',    dur: 2.4, interval: 14, advance: 4.5,  kick: 0.5, lift: 0,    flurry: 1.1, bursts: 1 },
  startle: { name: 'startle', dur: 1.8, interval: 18, advance: 1.2,  kick: 2.8, lift: 0.4,  flurry: 1.3, bursts: 1 },
  graze:   { name: 'graze',   dur: 5.5, interval: 16, advance: -3.2, kick: 0.6, lift: -0.7, flurry: 0.3, bursts: 1 },
  curious: { name: 'curious', dur: 4.0, interval: 15, advance: 0.8,  kick: 2.0, lift: 0.2,  flurry: 0.5, bursts: 1 },
  zoomies: { name: 'zoomies', dur: 3.2, interval: 20, advance: 7.5,  kick: 0.9, lift: 0.15, flurry: 1.5, bursts: 3 },
};

export function maneuverSpecOf(name: string): ManeuverSpec | null {
  // Own-properties only: `in` walks the prototype chain, so 'toString' would
  // come back as a "spec" of undefineds and NaN every position after it.
  return Object.hasOwn(SPECS, name) ? SPECS[name as Exclude<Maneuver, 'none'>] : null;
}

/** Smoothstep: the cumulative shape of one surge — slow off the mark, flat
 *  at the coast. C1 at both ends, so entering and leaving an event never
 *  snaps. */
const smooth = (u: number): number => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** Bump that rises and CLOSES: the lateral kick's shape, zero at both ends
 *  with zero slope, peak 1 mid-event. */
const bump = (u: number): number => {
  if (u <= 0 || u >= 1) return 0;
  const b = 4 * u * (1 - u);
  return b * b;
};

/** Cumulative surge over `bursts` sub-events: 0 → 1 as u runs 0 → 1, each
 *  burst its own S-curve. */
function surges(u: number, bursts: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const x = u * bursts;
  return (Math.floor(x) + smooth(x - Math.floor(x))) / bursts;
}

export interface ManeuverState {
  /** Advance along the fish's own path, body lengths (may be negative).
   *  Accumulates permanently — for FREE fish, whose loop absorbs it. */
  along: number;
  /** The CLOSING version: surges to the event's advance and settles back to
   *  zero. For fish holding a formation seat — a dart ahead of your slot you
   *  return from, because a permanent advance would walk you out of the
   *  school forever. */
  alongBump: number;
  /** Signed lateral offset, body lengths, along the fish's right-hand normal. */
  side: number;
  /** Vertical offset, body lengths. */
  up: number;
  /** Extra body-wiggle 0..~1.5 — feeds the same dial as `bodyWiggle`. */
  flurry: number;
}

const IDLE: ManeuverState = { along: 0, alongBump: 0, side: 0, up: 0, flurry: 0 };

/**
 * Fish `i`'s maneuver displacement at second `tSec` — pure in every argument,
 * O(1): only the events adjacent to `tSec / interval` can be inside their
 * window.
 *
 * `along` accumulates PERMANENTLY: each completed event leaves the fish
 * `advance` body lengths further along (or back along) its loop than the
 * schedule-less fish — that is what makes a dart a real dart and not a
 * rubber-band. Computed closed-form as (events completed) × advance +
 * (live event's surge), never by integrating.
 */
export function maneuverAt(
  spec: ManeuverSpec | null, index: number, tSec: number, rate: number, intensity: number,
): ManeuverState {
  if (!spec || rate <= 0 || intensity <= 0 || tSec < 0) return IDLE;
  const interval = spec.interval * (3 - 2 * Math.min(1, rate));
  const k0 = Math.floor(tSec / interval);
  let along = 0;
  let side = 0;
  let up = 0;
  let flurry = 0;
  // Events before the neighbourhood are all complete: count them in closed
  // form. Event k starts at (k + hash)·interval and lasts dur ≤ interval, so
  // every k ≤ k0 - 2 has finished.
  let alongBump = 0;
  const done = Math.max(0, k0 - 1);
  // Intensity scales HISTORY too — the same rule every steerable here obeys
  // (swimSpeed rescales the whole trajectory): the closed-form world has one
  // timeline, and the dials describe it, they don't splice it.
  along += done * spec.advance * intensity;
  for (const k of [k0 - 1, k0, k0 + 1]) {
    if (k < 0) continue;
    const start = (k + fishHash(index, 11 + k)) * interval;
    const u = (tSec - start) / spec.dur;
    if (u <= 0) continue;
    if (u >= 1) {
      if (k >= done) along += spec.advance * intensity; // completed inside the window
      continue;
    }
    const sign = fishHash(index, 23 + k) < 0.5 ? -1 : 1;
    const env = bump(u) * intensity;
    along += spec.advance * surges(u, spec.bursts) * intensity;
    alongBump += spec.advance * bump(u) * intensity;
    side += sign * spec.kick * env;
    up += spec.lift * spec.kick * env;
    flurry += spec.flurry * env;
  }
  return { along, alongBump, side, up, flurry };
}
