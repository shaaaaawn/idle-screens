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
  /** Peak nose pitch during the event, radians (negative = nose-down).
   *  Graze is the one maneuver whose NAME claims a posture — QA measured its
   *  vertical cue at 7.6u against hover's 7u idle bob: invisible. Pitch is
   *  the shape nobody confuses with a dart. */
  pitch: number;
  /** Contagious events propagate through a formation as a WAVE: every fish
   *  shares event k's start time, offset by its seat distance from a
   *  per-event epicentre. A startle no neighbour answers is not a startle. */
  contagious: boolean;
}

const SPECS: Record<Exclude<Maneuver, 'none'>, ManeuverSpec> = {
  dart:    { name: 'dart',    dur: 2.4, interval: 14, advance: 4.5,  kick: 0.5, lift: 0,    flurry: 1.1, bursts: 1, pitch: 0,     contagious: false },
  startle: { name: 'startle', dur: 1.8, interval: 18, advance: 1.2,  kick: 2.8, lift: 0.4,  flurry: 1.3, bursts: 1, pitch: 0.18,  contagious: true },
  // Graze sinks for real now: lift beyond ±1 is deliberate — QA measured the
  // old -0.7 × 0.6 at 7.6u of drop, indistinguishable from hover's idle bob.
  graze:   { name: 'graze',   dur: 5.5, interval: 16, advance: -3.2, kick: 0.6, lift: -2.1, flurry: 0.3, bursts: 1, pitch: -0.55, contagious: false },
  curious: { name: 'curious', dur: 4.0, interval: 15, advance: 0.8,  kick: 2.0, lift: 0.2,  flurry: 0.5, bursts: 1, pitch: 0.12,  contagious: false },
  zoomies: { name: 'zoomies', dur: 3.2, interval: 20, advance: 7.5,  kick: 0.9, lift: 0.15, flurry: 1.5, bursts: 3, pitch: 0,     contagious: false },
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
  // Each burst SURGES through the front 55% of its slice and HOLDS the rest —
  // QA found the old seams were zero-width velocity minima, so three chained
  // sprints sampled identically to one long dart. The dwell is the beat a
  // viewer can catch.
  const frac = x - Math.floor(x);
  return (Math.floor(x) + smooth(frac / 0.55)) / bursts;
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
  /** Nose pitch, radians. Applied AFTER the band level-lock — the level rule
   *  zeroes exactly the styles (bottom, drift) where grazing belongs. */
  pitch: number;
}

const IDLE: ManeuverState = { along: 0, alongBump: 0, side: 0, up: 0, flurry: 0, pitch: 0 };

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
  seatDelay: number | null = null,
): ManeuverState {
  if (!spec || rate <= 0 || intensity <= 0 || tSec < 0) return IDLE;
  // Below 1 the dial stretches the interval (up to 3x); ABOVE 1 it shortens
  // it. The old cap floored the schedule at 14-20s per fish — QA computed
  // that at dart's 17% duty and a cast of 9, barely 1.5 fish were ever
  // mid-event, a legibility ceiling baked into the spec.
  const interval = rate <= 1
    ? spec.interval * (3 - 2 * rate)
    : Math.max(spec.dur * 1.15, spec.interval / rate);
  const k0 = Math.floor(tSec / interval);
  let along = 0;
  let side = 0;
  let up = 0;
  let flurry = 0;
  let pitch = 0;
  // Events before the neighbourhood are all complete: count them in closed
  // form. Event k starts at (k + hash)·interval and lasts dur ≤ interval, so
  // every k ≤ k0 - 2 has finished.
  let alongBump = 0;
  const done = Math.max(0, k0 - 1);
  // Intensity scales HISTORY too — the same rule every steerable here obeys
  // (swimSpeed rescales the whole trajectory): the closed-form world has one
  // timeline, and the dials describe it, they don't splice it.
  //
  // The permanent advance is scaled PER FISH: identical accumulation was a
  // uniform conveyor (QA pass 3 D2) — every fish k events in, all advanced by
  // exactly k·advance, so permanence desynchronised nothing. The per-fish
  // factor makes histories genuinely diverge while staying closed-form.
  const perm = 0.6 + 0.8 * fishHash(index, 37);
  along += done * spec.advance * intensity * perm;
  for (const k of [k0 - 1, k0, k0 + 1]) {
    if (k < 0) continue;
    // Contagious events share one start per k (hash of the EVENT, not the
    // fish) and add the seat-distance delay the tank computed — the wave.
    // The wave exists only where seats do: a null seatDelay means a FREE
    // fish, whose schedule stays its own — otherwise every free startler in
    // the tank would flinch in unison, which is a chorus line, not a fright.
    const wave = spec.contagious && seatDelay !== null;
    const jitter = wave ? fishHash(1013, 11 + k) : fishHash(index, 11 + k);
    const start = (k + jitter) * interval + (wave ? seatDelay : 0);
    const u = (tSec - start) / spec.dur;
    if (u <= 0) continue;
    if (u >= 1) {
      if (k >= done) along += spec.advance * intensity * perm; // completed inside the window
      continue;
    }
    const sign = fishHash(index, 23 + k) < 0.5 ? -1 : 1;
    const env = bump(u) * intensity;
    along += spec.advance * surges(u, spec.bursts) * intensity * perm;
    alongBump += spec.advance * bump(u) * intensity;
    side += sign * spec.kick * env;
    up += spec.lift * spec.kick * env;
    flurry += spec.flurry * env;
    pitch += spec.pitch * env;
  }
  return { along, alongBump, side, up, flurry, pitch };
}
