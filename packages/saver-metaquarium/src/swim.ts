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
  | 'loop' | 'school' | 'drift' | 'hover' | 'patrol' | 'bottom' | 'surface';

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
  /** How much of its own loop a fish actually traverses. Below 1 the fish
   *  works a patch of water instead of touring the tank — what makes hovering
   *  read as hovering without any new path maths. */
  travel: number;
}

/**
 * The catalogue. `loop` is exactly the pre-style behaviour, so the default
 * changes nothing and every published scene renders as before.
 *
 * Deliberately small. Each entry is a silhouette of movement a viewer can
 * name — patrol, hover, drift — because a set you can name is a set you can
 * choose from; twelve variations on "swim" would just be noise.
 */
export const SWIM_STYLES: readonly SwimStyleSpec[] = [
  { name: 'loop', label: 'Loop', speedMul: 1, band: 'free', bobAmp: 0, bobHz: 0, formation: false, travel: 1 },
  { name: 'school', label: 'School', speedMul: 1, band: 'free', bobAmp: 1.5, bobHz: 0.5, formation: true, travel: 1 },
  { name: 'drift', label: 'Drift', speedMul: 0.35, band: 'mid', bobAmp: 5, bobHz: 0.13, formation: false, travel: 0.6 },
  { name: 'hover', label: 'Hover', speedMul: 0.2, band: 'free', bobAmp: 7, bobHz: 0.3, formation: false, travel: 0.12 },
  { name: 'patrol', label: 'Patrol', speedMul: 0.55, band: 'mid', bobAmp: 1, bobHz: 0.09, formation: false, travel: 1 },
  { name: 'bottom', label: 'Bottom-hugger', speedMul: 0.7, band: 'floor', bobAmp: 2, bobHz: 0.4, formation: false, travel: 1 },
  { name: 'surface', label: 'Surface-skimmer', speedMul: 0.9, band: 'ceiling', bobAmp: 3, bobHz: 0.55, formation: false, travel: 1 },
];

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
 * Per-fish spread. `variance` 0 means a uniform shoal (and is the default, so
 * existing scenes are untouched); 1 means every fish is visibly its own
 * animal. This is the "expandable uniqueness" dial: one number an author
 * turns up, rather than per-fish values nobody wants to write.
 */
export function fishVariation(index: number, variance: number): {
  speedMul: number; scaleMul: number; phase: number;
} {
  const v = Math.max(0, Math.min(1, variance));
  return {
    // ±40% speed and ±25% size at full variance — enough to read as a mixed
    // population, not so much that one fish looks broken.
    speedMul: 1 + (fishHash(index, 1) - 0.5) * 0.8 * v,
    scaleMul: 1 + (fishHash(index, 2) - 0.5) * 0.5 * v,
    phase: fishHash(index, 3) * Math.PI * 2,
  };
}

/**
 * Formation slot for the carrier school, in the carrier's local frame.
 *
 * A jittered lattice, NOT rejection sampling: the spike's sampler could
 * exhaust its candidate box and fail to place a fish, which is a crash
 * wearing a costume. A lattice always terminates, and the jitter keeps it
 * from looking like a parade ground.
 */
export function formationSlot(index: number, count: number, variance: number): {
  side: number; up: number; back: number;
} {
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))));
  const col = index % cols;
  const row = Math.floor(index / cols);
  const j = 0.35 + 0.65 * Math.max(0, Math.min(1, variance));
  return {
    side: (col - (cols - 1) / 2) * 26 + (fishHash(index, 4) - 0.5) * 16 * j,
    up: (fishHash(index, 5) - 0.5) * 20 * j,
    back: row * 22 + fishHash(index, 6) * 12 * j,
  };
}

/** Depth band as a fraction of the tank's vertical extent — the tank owns the
 *  actual bounds, this owns the intent. */
export function bandRange(band: DepthBand): { lo: number; hi: number } | null {
  switch (band) {
    case 'floor': return { lo: 0, hi: 0.3 };
    case 'ceiling': return { lo: 0.7, hi: 1 };
    case 'mid': return { lo: 0.3, hi: 0.7 };
    default: return null;
  }
}
