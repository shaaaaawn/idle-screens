/**
 * Swim styles — a few places a fish can be, not a pile of motion knobs.
 *
 * Same shape as environments, for the same reason: a curated set is how you
 * ship taste, and an agent picks a BEHAVIOUR rather than tuning six numbers
 * until it looks accidental. The uniqueness lives in two dials
 * (`swimVariance`, `bodyWiggle`) that spread a school out without anyone
 * having to author per-fish values.
 *
 * Everything here is pure and closed-form in distance/time, so
 * `renderFrame(t, seed)` stays frame-addressable — a style that needed
 * accumulated state would not be shippable at all.
 *
 * Zero-dep: the server validates through `./manifest` without three.js.
 */

export type SwimStyle =
  | 'loop' | 'school' | 'drift' | 'hover' | 'patrol' | 'bottom' | 'surface'
  | 'follow' | 'pair' | 'chase';

/** How a fish relates to another fish. `none` is every pre-relationship
 *  style. A bonded fish rides the plan of the nearest preceding unbonded fish
 *  in slot order (its LEADER) — closed-form, because the leader's own pose is. */
export type Bond = 'none' | 'follow' | 'pair' | 'chase';

/** Where in the water column a style lives. */
export type DepthBand = 'free' | 'floor' | 'ceiling' | 'mid';

export interface SwimStyleSpec {
  name: SwimStyle;
  label: string;
  /** Tempo baked into the style — a patrolling shark is not a darting shoal.
   *  Multiplies the author's swimSpeed rather than replacing it. */
  speedMul: number;
  band: DepthBand;
  /** Vertical bob, the thing that separates "alive but holding station" from
   *  "parked". Amplitude in world units, rate in Hz. */
  bobAmp: number;
  bobHz: number;
  /** Ride one shared route in formation (the carrier school) instead of each
   *  fish owning a loop. */
  formation: boolean;
  /** How FAST a fish works its own loop, relative to how hard it is swimming.
   *  Below 1 it stays in a patch of water instead of touring the tank — what
   *  makes hovering read as hovering without any new path maths.
   *
   *  Not a leash: a hover fish still gets all the way round eventually (about
   *  80 minutes). At any timescale anyone is watching it reads as staying
   *  put, which is the effect being bought — but the loop is not fenced. */
  travel: number;
  /** Relationship to other fish (MQ31). Absent = `none`. */
  bond?: Bond;
}

/**
 * The catalogue. `loop` is exactly the pre-style behaviour, so the default
 * changes nothing and every published scene renders as before. That holds for
 * every param in this file's orbit, `bodyWiggle` included: each one defaults
 * to the old look and has to be asked for.
 *
 * Deliberately small. Each entry is a silhouette of movement a viewer can
 * name — patrol, hover, drift — because a set you can name is a set you can
 * choose from; twelve variations on "swim" would just be noise.
 */
export const SWIM_STYLES: readonly SwimStyleSpec[] = [
  { name: 'loop', label: 'Loop', speedMul: 1, band: 'free', bobAmp: 0, bobHz: 0, formation: false, travel: 1 },
  { name: 'school', label: 'School', speedMul: 1, band: 'free', bobAmp: 1.5, bobHz: 0.5, formation: true, travel: 1 },
  { name: 'drift', label: 'Drift', speedMul: 0.35, band: 'mid', bobAmp: 5, bobHz: 0.13, formation: false, travel: 0.6 },
  // speedMul 0.55, not 0.2: QA measured hover at swimSpeed 0.5 pinned to a
  // fixed screen x for 8+ seconds — frozen, not station-keeping. The two
  // multiplied slowdowns (speedMul x travel) were the freeze.
  { name: 'hover', label: 'Hover', speedMul: 0.55, band: 'free', bobAmp: 7, bobHz: 0.3, formation: false, travel: 0.12 },
  { name: 'patrol', label: 'Patrol', speedMul: 0.55, band: 'mid', bobAmp: 1, bobHz: 0.09, formation: false, travel: 1 },
  { name: 'bottom', label: 'Bottom-hugger', speedMul: 0.7, band: 'floor', bobAmp: 2, bobHz: 0.4, formation: false, travel: 1 },
  { name: 'surface', label: 'Surface-skimmer', speedMul: 0.9, band: 'ceiling', bobAmp: 3, bobHz: 0.55, formation: false, travel: 1 },
  // Relationships (MQ31). A bonded fish has no route of its own: it rides
  // its leader's plan at a lag, so a `@follow` trio behind a turtle is a
  // file, a `@pair` couple orbits a shared point, and a `@chase` closes on
  // its leader and falls back. All three stay pure in t because the leader
  // is — the follower samples the SAME closed form at `d - lag`.
  { name: 'follow', label: 'Follower', speedMul: 1, band: 'free', bobAmp: 1.2, bobHz: 0.5, formation: false, travel: 1, bond: 'follow' },
  { name: 'pair', label: 'Pair', speedMul: 0.8, band: 'free', bobAmp: 2.5, bobHz: 0.35, formation: false, travel: 1, bond: 'pair' },
  { name: 'chase', label: 'Chaser', speedMul: 1, band: 'free', bobAmp: 1, bobHz: 0.6, formation: false, travel: 1, bond: 'chase' },
];

/**
 * `swimStyle: 'auto'` — species-aware defaults from the cast (MQ33). The
 * scene names no behaviour; each untagged token swims the way its breed
 * does. A `@style` on the token still wins. Breeds this table does not know
 * (a custom catalog) loop, the pre-style behaviour.
 */
export const AUTO_STYLE_BY_BREED: Readonly<Record<string, SwimStyle>> = {
  angelfish: 'school',
  betafish: 'drift',
  seahorse: 'hover',
  seaturtle: 'surface',
  // The unminted NPC set.
  blowfish: 'hover',
  hackerfish: 'loop',
  glowfish: 'drift',
  babyfish: 'school',
  shark: 'patrol',
  crab: 'bottom',
  jellyfish: 'drift',
  dori: 'school',
};

export function autoStyleFor(breed: string | undefined): SwimStyleSpec {
  const name = breed ? AUTO_STYLE_BY_BREED[breed.toLowerCase()] : undefined;
  return swimStyleOf(name ?? 'loop');
}

/**
 * Formation breathing (MQ34): the lattice relaxes outward and draws back in
 * on a slow cycle. The factor never drops below 1, so the no-pair-inside-a-
 * body-length law the seating charts are tested against still holds at every
 * instant — a school breathes OUT from its guaranteed spacing, never into it.
 * `amount` 0 (the default) is exactly 1: no change to any published scene.
 */
export function formationBreathe(tSec: number, amount: number): number {
  const a = Math.max(0, Math.min(1, amount));
  if (a <= 0) return 1;
  return 1 + a * 0.22 * (0.5 + 0.5 * Math.sin(tSec * 0.42));
}

/**
 * Idle micro-motion (MQ36): a fish that works a patch of water (`travel` < 1)
 * turns in place while it holds station, instead of pointing rigidly down a
 * loop it is barely moving along — "a stationary fish is a statue with a
 * tail". Yaw in radians, zero for every touring style, so `loop` and the
 * formations are untouched. Amplitude grows as travel shrinks: hover sways
 * ~25°, drift ~11°.
 */
export function idleSway(style: SwimStyleSpec, tSec: number, phase: number): number {
  if (style.travel >= 1 || style.formation) return 0;
  return (1 - style.travel) * 0.5 * Math.sin(tSec * 0.45 + phase);
}

export const SWIM_STYLE_NAMES: readonly SwimStyle[] = SWIM_STYLES.map((s) => s.name);

export function swimStyleOf(name: string): SwimStyleSpec {
  return SWIM_STYLES.find((s) => s.name === name) ?? SWIM_STYLES[0]!;
}

// ---------------------------------------------------------------------------
// Per-fish uniqueness
// ---------------------------------------------------------------------------

/** Deterministic 0..1 hash of a fish index and a salt. Not an rng: a fish's
 *  variation must be recoverable from its index alone, so nothing depends on
 *  spawn order or on how many times the tank has been rebuilt. */
export function fishHash(index: number, salt: number): number {
  const x = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Per-fish spread. `variance` 0 means a uniform shoal in the things an author
 * is asking about — size and pace; 1 means every fish is visibly its own
 * animal. This is the "expandable uniqueness" dial: one number an author
 * turns up, rather than per-fish values nobody wants to write.
 *
 * Two fields deliberately IGNORE `variance` — `phase` and `anchor`. Both are
 * desynchronisation, not flavour: a shoal that bobs and beats its tail in
 * perfect unison reads as one animation played N times, and a station-keeping
 * style with a shared anchor knots every fish into the same corner. Turning
 * variance to 0 should give you a uniform population, not a chorus line.
 */
export function fishVariation(index: number, variance: number): {
  speedMul: number; scaleMul: number; phase: number; anchor: number;
} {
  const v = Math.max(0, Math.min(1, variance));
  return {
    // ±40% speed and ±25% size at full variance — enough to read as a mixed
    // population, not so much that one fish looks broken.
    speedMul: 1 + (fishHash(index, 1) - 0.5) * 0.8 * v,
    scaleMul: 1 + (fishHash(index, 2) - 0.5) * 0.5 * v,
    // Independent of `variance` — see the note above; synchronised bobbing is
    // a machine, not a shoal.
    phase: fishHash(index, 3) * Math.PI * 2,
    // Where along its own route a fish holds station, 0..1. Styles that only
    // work a patch of water (hover, drift) start every fish at distance 0
    // without this, so the whole shoal knots up in one corner — which is
    // exactly what it did the first time I looked at `hover` on screen.
    // Independent of `variance`: spreading is correctness, not flavour.
    anchor: fishHash(index, 7),
  };
}

/**
 * Where a fish starts on its own route, as a fraction of the route's length.
 *
 * The rule lives here rather than inline in the tank because it is the whole
 * of a bug that shipped once already: the offset used to apply only when
 * `travel < 1`, so every full-travel style (patrol, bottom, surface) mounted
 * as one knot dead-centre — every compiled spline's `points[0]` sits near
 * azimuth 0, so an unspread cast starts stacked. It took minutes of screen
 * time to disperse, and was watched happening three times in a row on a live
 * channel before anyone read the condition.
 *
 * `loop` is the one exception, and not for looks: it promises to be exactly
 * the pre-style behaviour frame for frame, so it may not touch frame 0.
 *
 * Formation styles pass through here too even though the carrier's rigid
 * transform ignores the result — cheaper to keep one rule than to encode
 * "except when a branch downstream discards it", which is the kind of caveat
 * that stops being true and nobody notices.
 */
export function anchorFraction(style: SwimStyleSpec, index: number, variance: number): number {
  if (style.name === 'loop') return 0;
  return fishVariation(index, variance).anchor;
}

/** Nose-to-tail length of a fish at scale 1, in tank units. Formation spacing
 *  is quoted in these so the lattice cannot silently start interpenetrating
 *  when the fish change size — a review measured 36% of fish-frames with a
 *  neighbour inside one body length when the pitch was a bare number. */
export const FISH_LENGTH = 18;

/** Half-width the formation lattice is allowed to occupy, in tank units. The
 *  tank still clamps the final position — this keeps the shape sane, the
 *  clamp keeps it legal. */
const FORMATION_HALF_WIDTH = 62;

/**
 * Formation slot for the carrier school, in the carrier's local frame.
 *
 * A jittered lattice, NOT rejection sampling: the spike's sampler could
 * exhaust its candidate box and fail to place a fish, which is a crash
 * wearing a costume. A lattice always terminates, and the jitter keeps it
 * from looking like a parade ground.
 */
/**
 * How a school holds together. Every shape is a slot function in the
 * carrier's local frame (side, up, back) under one law: no two slots inside
 * one body length — enforced by test across every shape, count, and
 * variance. The carrier and the rigid-body transform don't change; a shape
 * is a different seating chart, not a different engine.
 *
 * - `phalanx` — the jittered lattice (default; the original school)
 * - `line`    — single file, nose to tail, gentle seeded weave
 * - `ring`    — a carousel around the carrier, the ring swimming as one
 * - `wedge`   — the migratory V, ranks widening behind the point
 * - `ball`    — a bait-ball: Fibonacci-shell seats on a sphere
 */
export type FormationShape = 'phalanx' | 'line' | 'ring' | 'wedge' | 'ball';
export const FORMATION_SHAPES: readonly FormationShape[] = ['phalanx', 'line', 'ring', 'wedge', 'ball'];

export function formationSlot(
  index: number, count: number, variance: number, halfWidth = FORMATION_HALF_WIDTH,
  shape: FormationShape = 'phalanx',
): { side: number; up: number; back: number } {
  const j = 0.35 + 0.65 * Math.max(0, Math.min(1, variance));
  if (shape === 'line') {
    // Nose to tail with a seeded weave bounded well under half a body
    // length, so the file cannot fold onto itself. A file caps at six —
    // geometry, not taste: 24 fish at 1.7 body lengths would be a 700-unit
    // procession in a 120-radius tank. Extra fish open parallel files a
    // clear lane apart, and each file is CENTRED so the extent walk keeps
    // the whole school inside the glass.
    const FILE = 6;
    const files = Math.ceil(Math.max(1, count) / FILE);
    const col = Math.floor(index / FILE);
    const within = index % FILE;
    const fileLen = Math.min(FILE, count - col * FILE);
    return {
      side: (col - (files - 1) / 2) * FISH_LENGTH * 1.6
        + (fishHash(index, 4) - 0.5) * FISH_LENGTH * 0.4 * j,
      up: (fishHash(index, 5) - 0.5) * FISH_LENGTH * 0.5 * j,
      back: (within - (fileLen - 1) / 2) * FISH_LENGTH * 1.7,
    };
  }
  if (shape === 'ring') {
    // Evenly seated carousel; radius grows with the cast so seats keep a
    // body length of arc between them.
    const r = Math.max(FISH_LENGTH * 1.6, (count * FISH_LENGTH * 1.35) / (Math.PI * 2));
    const a = (index / Math.max(1, count)) * Math.PI * 2;
    // The carousel TILTS: seats rise and fall around the ring so it reads
    // as a wheel from a side camera. A flat ring was verified invisible from
    // every side view — a line of fish, not a circle (MQ34). Horizontal
    // spacing is unchanged so the arc-length law holds; the vertical reach
    // is capped so the carrier's y-clamp keeps the top seat under the lid.
    return {
      side: Math.cos(a) * r,
      up: Math.sin(a) * Math.min(r * 0.55, 24) + (fishHash(index, 5) - 0.5) * FISH_LENGTH * 0.3 * j,
      back: Math.sin(a) * r,
    };
  }
  if (shape === 'wedge') {
    // The migratory V: rank 0 is the point, each rank seats two, wings
    // sweep back and out. One V holds nine; bigger casts stack Vs
    // vertically a clear layer apart (the water column is the axis with
    // room), each V centred fore-aft so the extent stays honest.
    const VSIZE = 9;
    const layers = Math.ceil(Math.max(1, count) / VSIZE);
    const layer = Math.floor(index / VSIZE);
    const within = index % VSIZE;
    const rank = (within + 1) >> 1;
    const wing = within === 0 ? 0 : within % 2 === 1 ? -1 : 1;
    // Wings droop behind the point at EVERY layer count — a QA pass showed
    // stacked Vs reading as two unrelated flat rows without it. The droop is
    // CENTRED on the mean rank so it never grows the vertical extent: the
    // point rides high, the wings low, the average unmoved. Same offset at
    // the same rank in every layer, so inter-layer spacing is untouched.
    const droop = (rank - 2) * FISH_LENGTH * (layers === 1 ? 0.24 : 0.12);
    // Multi-layer pitch drops to 1.2 body lengths (same-rank vertical gap
    // 21.6 minus worst-case jitter closure still clears one body length) so
    // three stacked Vs plus droop fit the water column.
    const pitch = layers === 1 ? 1.5 : 1.2;
    const jit = layers === 1 ? 0.2 : 0.15;
    return {
      side: wing * rank * FISH_LENGTH * 1.25 + (fishHash(index, 4) - 0.5) * FISH_LENGTH * 0.3 * j,
      up: (layer - (layers - 1) / 2) * FISH_LENGTH * pitch
        + (fishHash(index, 5) - 0.5) * FISH_LENGTH * jit * j - droop,
      back: (rank - 2) * FISH_LENGTH * 1.35,
    };
  }
  if (shape === 'ball') {
    // Fibonacci-sphere seats: the classic even shell. Radius grows with the
    // cast so nearest seats stay a body length apart.
    const r = FISH_LENGTH * (1.1 + 0.34 * Math.sqrt(count));
    const g = (1 + Math.sqrt(5)) / 2;
    const u = count <= 1 ? 0 : index / (count - 1);
    const incl = Math.acos(1 - 2 * u);
    const az = (2 * Math.PI * index) / (g * g);
    return {
      side: r * Math.sin(incl) * Math.cos(az),
      // Vertically squashed, hard-capped at 28: the water column is 57 units
      // and the carrier's y-clamp needs the shell's top inside it whatever
      // the cast size makes of the radius.
      up: Math.cos(incl) * Math.min(r * 0.62, 28),
      back: r * Math.sin(incl) * Math.sin(az),
    };
  }
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))));
  const col = index % cols;
  const row = Math.floor(index / cols);
  // Spacing shrinks as the cast grows so the formation's own width stays
  // inside `halfWidth`. At 24 fish a fixed 26-unit column pitch spread the
  // shoal wider than the tank, and the outer ranks swam through the glass.
  const span = Math.max(1, cols - 1);
  // Spacing is quoted in body lengths, and the jitter is a FRACTION of the
  // pitch rather than a fixed number of units. Both matter: a bare 26/22 was
  // narrower than a fish is long once jitter ate into it, so the shoal
  // interpenetrated at every variance including 0.
  const pitch = Math.min(FISH_LENGTH * 1.9, (halfWidth * 2) / span);
  // Jitter is bounded so the CLOSEST possible pair still clears a body
  // length: adjacent columns are `pitch` apart and jitter can close at most
  // `jit`, so pitch - jit must stay above FISH_LENGTH. That is the whole
  // reason the spacing is quoted in body lengths at all.
  const jit = pitch * 0.35;
  const rows = Math.ceil(Math.max(1, count) / cols);
  return {
    side: (col - (cols - 1) / 2) * pitch + (fishHash(index, 4) - 0.5) * jit * j,
    up: (fishHash(index, 5) - 0.5) * FISH_LENGTH * j,
    // Centred fore-aft like every other shape — a 24-fish lattice trailing
    // its whole depth behind the carrier pushed the extent past what the
    // centre-clamp could absorb.
    back: (row - (rows - 1) / 2) * FISH_LENGTH * 1.6 + fishHash(index, 6) * FISH_LENGTH * 0.4 * j,
  };
}

/**
 * How far the formation reaches from its own centre, per axis. The tank uses
 * it to pull the WHOLE shoal inside the glass by moving its centre, instead of
 * squashing individual fish toward the middle — squashing is what turned a
 * legal lattice back into a pile.
 */
export function formationExtent(
  count: number, variance: number, shape: FormationShape = 'phalanx',
): { side: number; up: number; back: number; reach: number } {
  let side = 0, up = 0, back = 0, reach = 0;
  for (let i = 0; i < count; i += 1) {
    const s = formationSlot(i, count, variance, undefined, shape);
    side = Math.max(side, Math.abs(s.side));
    up = Math.max(up, Math.abs(s.up));
    back = Math.max(back, Math.abs(s.back));
    // True planar reach per SEAT — hypot of the axis maxima overstates a
    // ring by √2 (its side and back maxima never co-occur), and that
    // overstatement pinned big rings to the tank centre.
    reach = Math.max(reach, Math.hypot(s.side, s.back));
  }
  return { side, up, back, reach };
}

/** Depth band as a fraction of the tank's vertical extent — the tank owns the
 *  actual bounds, this owns the intent. */
export function bandRange(band: DepthBand): { lo: number; hi: number } | null {
  switch (band) {
    // Tight, because 0..0.3 of a 57-unit volume is nearly two body lengths of
    // headroom — measured on screen it read as hovering in the lower third
    // rather than hugging anything.
    case 'floor': return { lo: 0, hi: 0.14 };
    case 'ceiling': return { lo: 0.7, hi: 1 };
    case 'mid': return { lo: 0.3, hi: 0.7 };
    default: return null;
  }
}
