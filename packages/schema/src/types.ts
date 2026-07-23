/**
 * Declarative, agent-authorable saver format. A `SaverSpec` describes a saver as DATA
 * (no code), which `compileSaver` turns into a seeded, deterministic, flash-safe
 * SaverPlugin. It models the "drifting sprite field" family that covers most classic
 * savers (fish, toasters, DVD, rain, messages): a static background plus one or more
 * layers of entities that move.
 *
 * SAFETY INVARIANT: there is deliberately NO full-field strobe/flash primitive — the
 * background is static and entities are bounded sprites — so a compiled spec cannot
 * produce photosensitive flashing by construction (proven by sampling a compiled spec
 * through @idle-screens/validator).
 */
export const SCHEMA_VERSION = 1 as const;

export interface SaverSpec {
  schemaVersion: 1;
  id: string;
  label: string;
  /** Deterministic seed; falls back to the host's SaverContext.seed. */
  seed?: number;
  background?: BackgroundSpec;
  layers: LayerSpec[];
  motionIntensity?: 'calm' | 'moderate' | 'energetic';
  /**
   * Frame persistence (0..1, capped at LIMITS.maxGhosting). Instead of fully clearing,
   * each frame the background is painted at reduced alpha so moving entities leave
   * decaying after-images (Mystify smears, long-exposure light). Inherently
   * flash-safe: ghosting can only smooth luminance changes, never sharpen them.
   * `renderFrame(t)` stays deterministic for seeks via a fixed-step warm-up replay.
   */
  ghosting?: number;
  /** Dimensional unit system. 'viewport' (default) = all sizes/speeds/distances are fractions of min(w,h). */
  units?: 'viewport' | 'px';
  /**
   * Resolution at which this spec was designed. Density scaling kicks in above this
   * threshold: entity counts scale by min(w,h) / referenceViewport. Default: 1080.
   * Set to your design resolution so a spec authored at 4K doesn't over-densify.
   */
  referenceViewport?: number;
}

export type BackgroundSpec =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; stops: GradientStop[]; band?: BandSpec; drift?: BackgroundDrift };

/** A vertical gradient stop (`at` 0 = top, 1 = bottom). */
export interface GradientStop {
  at: number;
  color: string;
}

/** An optional solid band at the bottom (e.g. an aquarium seafloor). */
export interface BandSpec {
  color: string;
  /** Band height — px or a viewport fraction, per the spec's `units`. */
  height: number;
}

/** Slow oscillation of gradient stop positions — makes the background feel alive. */
export interface BackgroundDrift {
  /** Full cycle period in ms. Floor: LIMITS.minDriftPeriod (10 s). */
  period: number;
  /** How far stops shift (fraction of the 0..1 range). Default 0.15, max 0.3. */
  amount?: number;
}

export interface LayerSpec {
  count: number;
  sprite: SpriteSpec;
  /** Sprite size range in px (font size for emoji/text; ignored for circle). */
  size?: [number, number];
  motion: MotionSpec;
  /** Wrap around the opposite edge when leaving the viewport. Default true. */
  wrap?: boolean;
  /** Flip the sprite horizontally to face its heading. Default false. */
  flip?: boolean;
  /** Per-entity opacity range, both 0..1. Default [1,1]. */
  alpha?: [number, number];
  /**
   * Compositing for this layer. 'lighter' = additive (glow stacking); 'screen' =
   * gentler additive for pale backgrounds; 'multiply' = darkening (shadows,
   * silhouettes). Default source-over. None of these can strobe.
   */
  blend?: 'lighter' | 'screen' | 'multiply';
  /**
   * Fractional spawn window (0 = left/top, 1 = right/bottom). Constrains where
   * entities are PLACED, not where they may travel. Default full viewport.
   */
  region?: { x?: [number, number]; y?: [number, number] };
  /**
   * Sinusoidal opacity breathing. SAFETY: amp is capped (LIMITS.maxPulseAmp),
   * period has a floor (LIMITS.minPulsePeriod — max 2 Hz), and every entity gets
   * its own seeded phase, so a layer can never strobe in unison. Effective alpha
   * is clamped to 0..1.
   *
   * `wave` derives each entity's phase from its spawn position instead of a seeded
   * draw, turning independent breathing into a traveling wave across the field
   * (ripples, wind through grass). `wavelength` is dimensional (px or viewport
   * units); `angle` is the propagation direction in degrees (0 = rightward,
   * default 0). Still flash-safe: neighbors are out of phase by construction.
   */
  pulse?: { amp: number; period: number; wave?: { wavelength: number; angle?: number } };
  /**
   * Per-entity rotation speed in degrees/sec (positive = clockwise).
   * Each entity gets a seeded starting angle. Composes with any motion type.
   */
  spin?: number;
  /**
   * Sinusoidal size breathing, parallel to `pulse` for opacity. `amp` is a
   * fraction of base size (0.3 = ±30 %). `period` in ms with the same
   * flash-safety floor as pulse. Per-entity seeded phase.
   */
  grow?: { amp: number; period: number };
  /**
   * Addressable name for this layer. Enables `setParam` to use `key.field` paths
   * instead of `layers.N.field` indices. Also makes specs self-documenting.
   */
  key?: string;
  /**
   * Exact fractional position {x, y} for a single entity (0 = left/top, 1 = right/bottom).
   * Only valid when `count` is 1. Overrides `region` scatter placement.
   */
  position?: { x: number; y: number };
  /**
   * Inter-entity links. `mode` picks the wiring:
   * - 'nearest' (default): each entity's k nearest neighbors within maxDist.
   * - 'chain': entities connected in order (0-1-2-…) — Mystify polygons, string
   *   art. Ignores k/maxDist; `closed` joins the last entity back to the first.
   * - 'random': a fixed golden-ratio-stride wiring (k partners per entity,
   *   deterministic, no RNG draws) — breaks the crystalline k-nearest look.
   * `falloff` fades link alpha with distance/maxDist, killing pop-in at the cutoff.
   * Capped at LIMITS.maxLinksK. Layer count must be <= LIMITS.maxLinkLayerCount when set.
   */
  links?: {
    k: number;
    maxDist: number;
    color?: string;
    alpha?: number;
    width?: number;
    mode?: 'nearest' | 'chain' | 'random';
    falloff?: boolean;
    closed?: boolean;
  };
  /**
   * Afterglow trail behind moving entities. Samples past positions analytically
   * (no state, fully deterministic). `length` in ms, `fade` 0..1 (default 1 = full fade).
   */
  trail?: { length: number; fade?: number };
  /**
   * Grid placement instead of random scatter: entities fill cells row-major within
   * `region`. `columns` defaults to an aspect-fit square-ish grid; `jitter` (0..1,
   * scalar or per-axis) offsets each entity within its cell by a seeded fraction of
   * the cell size — `{ y: 1 }` keeps columns crisp while scattering vertically
   * (Matrix rain). Unlocks column effects, LED walls, mosaics, uniform dot fields.
   */
  layout?: { type: 'grid'; columns?: number; jitter?: number | { x?: number; y?: number } };
  /**
   * Layer lifecycle for act structure — a pure function of t, no state. Alpha is 0
   * before `enter` (ms), ramps up over `fade` ms (default 1000), holds at 1, then
   * ramps down starting at `exit`. Entities are skipped entirely while at alpha 0.
   */
  life?: { enter?: number; exit?: number; fade?: number };
}

export type SpriteSpec =
  | { kind: 'emoji'; glyphs: string[]; cycle?: CycleSpec }
  | {
      kind: 'text';
      strings: string[];
      color?: string;
      font?: string;
      align?: 'left' | 'center' | 'right';
      baseline?: 'top' | 'middle' | 'bottom';
      maxWidth?: number;
      cycle?: CycleSpec;
    }
  /** `soft` renders a radial falloff (glow orb) instead of a hard disc.
   *  `colorWeights` (same length as `colors`) biases the seeded per-entity pick —
   *  "mostly cool tones, occasional ember" without duplicating entries. */
  | { kind: 'circle'; radius: [number, number]; color: string; soft?: boolean; colors?: string[]; colorWeights?: number[] }
  /** Unfilled circle (bubbles, portals, sonar pings). `width` = stroke width. */
  | { kind: 'ring'; radius: [number, number]; color: string; width?: number; colors?: string[]; colorWeights?: number[] }
  /**
   * A line segment oriented along the entity's instantaneous heading (derived
   * analytically from its motion) with a faded tail — rain that reads as rain,
   * shooting stars, warp stars. `length` is the segment length range; `width` the
   * stroke width.
   */
  | { kind: 'streak'; length: [number, number]; color: string; width?: number; colors?: string[]; colorWeights?: number[] }
  /**
   * Axis-aligned rectangle (rotates with `spin`). `width` is the horizontal size
   * range; `aspect` the height/width ratio range (default [1,1] = squares).
   * Mondrian blocks, confetti, city lights.
   */
  | { kind: 'rect'; width: [number, number]; aspect?: [number, number]; color: string; colors?: string[]; colorWeights?: number[] };

/** Rotate through sprite variants over time. Each entity offsets by its seeded phase. */
export interface CycleSpec {
  period: number;
}

export type MotionSpec =
  /**
   * Drift at a per-entity speed picked from `speed` (px/sec) along `angle` degrees
   * (0 = right, 90 = down; default 0). `bidirectional` randomly flips horizontal
   * direction per entity (e.g. fish swimming both ways); `bob` adds a small vertical
   * wobble amplitude (px). Covers horizontal fields, diagonals (toasters) and rain
   * (angle 90).
   */
  | { type: 'drift'; speed: [number, number]; angle?: number; bidirectional?: boolean; bob?: number }
  /** Rise upward (px/sec) with an optional horizontal sway amplitude (px) — bubbles. */
  | { type: 'rise'; speed: [number, number]; sway?: number }
  /** Bounce diagonally at a per-entity speed, reflecting off the edges (px/sec). */
  | { type: 'bounce'; speed: [number, number] }
  /** Entity stays exactly where placed. No movement. Use with `position` for pinned elements. */
  | { type: 'static' }
  /**
   * Orbit around a center point. Each entity gets a seeded radius from `radius`
   * and a seeded phase. `speed` is angular velocity in degrees/sec. `center` is
   * fractional {x, y} (default {0.5, 0.5} = viewport center) — or
   * `{ layer: key }` to orbit a single-entity parent layer (moons around a
   * wandering planet). Strictly one level deep: the parent may not itself
   * orbit a layer, and must have `count: 1`.
   */
  | { type: 'orbit'; speed: [number, number]; radius: [number, number]; center?: { x: number; y: number } | { layer: string } }
  /**
   * Organic harmonic drift — the analytic flow field. Each entity moves at a base
   * velocity from `speed` plus 3 seeded sine octaves per axis, producing flowing
   * curved paths (Flurry streams, aurora, jellyfish) with zero simulation state.
   * `angle` fixes the base heading in degrees (omit for a seeded heading per
   * entity); `meander` scales the harmonic amplitude (dimensional, default 0.05
   * viewport units); `coherence` (0..1) blends every entity's harmonics toward a
   * shared layer-level set — at 1 the field undulates in unison (fake flocking).
   */
  | { type: 'wander'; speed: [number, number]; angle?: number; meander?: number; coherence?: number }
  /**
   * Perspective starfield: entities live on a depth axis and stream toward the
   * viewer, projected as `screen = center + offset / z`. Size and alpha scale
   * with 1/z (small and faint at the far plane, large and fast up close), and z
   * wraps — the honest warp tunnel. `speed` is in depth-units/sec
   * (1 = full near-to-far span per second, capped at LIMITS.maxWarpSpeed).
   */
  | { type: 'warp'; speed: [number, number]; center?: { x: number; y: number } }
  /**
   * Choreographed spline motion: entities traverse `points` (fractional {x,y})
   * over `duration` ms. `curve: 'smooth'` (default) uses Catmull-Rom through the
   * points; 'linear' uses straight segments. `closed` (default true) loops the
   * path; open paths ping-pong. Each entity gets a seeded phase offset along the
   * path, and `scatter` (dimensional) adds a seeded per-entity offset so shared
   * paths don't stack. Figure-eights, sweeping arcs, patrol routes.
   */
  | {
      type: 'path';
      points: Array<{ x: number; y: number }>;
      duration: number;
      curve?: 'linear' | 'smooth';
      closed?: boolean;
      scatter?: number;
    };

/** A validation problem, pointing at a JSON path within the spec. */
export interface SpecError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: SpecError[];
  /** Non-blocking warnings about unknown/misplaced properties or likely authoring mistakes. */
  warnings?: SpecWarning[];
}

/** An advisory warning (non-blocking). Returned by `adviseSpec`. */
export interface SpecWarning {
  path: string;
  code: string;
  message: string;
}

/** Perf/safety caps enforced by `validateSpec`. */
export const LIMITS = {
  maxPerLayer: 400,
  maxTotal: 800,
  maxLayers: 36,
  maxSpeed: 4000, // px/sec — bounds motion so nothing teleports
  maxPulseAmp: 0.5, // opacity breathing amplitude cap
  minPulsePeriod: 500, // ms — caps pulse at 2 Hz (WCAG flash threshold is 3 Hz)
  maxSpin: 360, // degrees/sec — one full revolution per second
  maxGrowAmp: 0.8, // size breathing amplitude cap (fraction of base size)
  maxOrbitSpeed: 180, // degrees/sec — half a revolution per second
  maxLinksK: 8,
  maxLinkLayerCount: 200,
  minCyclePeriod: 500, // ms — same flash-safety floor as pulse
  referenceViewport: 1080, // for validating viewport-unit dimensional caps
  maxTrailLength: 5000, // ms — cap trail duration
  maxTrailSamples: 24, // dots per trail
  minDriftPeriod: 10000, // ms — background drift floor (10 s)
  maxDriftAmount: 0.3, // fraction of gradient stop shift
  maxGhosting: 0.95, // frame persistence cap — bounds the seek warm-up replay
  maxGhostReplayFrames: 120, // fixed-step frames replayed on a non-contiguous seek
  maxMeander: 500, // px — wander harmonic amplitude cap (viewport cap: /referenceViewport)
  maxWarpSpeed: 1.5, // depth-units/sec — full near-to-far span in ~0.7 s at max
  minPathPoints: 2,
  maxPathPoints: 24,
  minPathDuration: 2000, // ms — a path lap can't be faster than this
  maxGridColumns: 100,
} as const;
