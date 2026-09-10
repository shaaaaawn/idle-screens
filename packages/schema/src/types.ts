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
   * Declared density intent. `sparse` says the emptiness is the point (one
   * mark on a dark ground, long silences): `adviseSpec` withholds
   * `sparse-scene`, and scorers that gate on coverage should read this before
   * calling a faithful scene broken. `dense` withholds `dense-scene` the same
   * way. Either declaration is checked against the measured coverage and a
   * `density-mismatch` advisory fires when the scene contradicts it. Omitted
   * means `normal`. A hint only — it changes no pixel.
   */
  density?: 'sparse' | 'normal' | 'dense';
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
   * A scalar applies one speed to every entity; a `[min, max]` range gives each
   * entity a seeded speed within the range (like `speed`/`alpha`) — confetti,
   * tumbling debris, foliage. Existing scalar specs are unaffected (the range
   * form draws one extra seeded value, only when present).
   */
  spin?: number | [number, number];
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
   * Only valid when `count` is 1 — or, with a `list` / `table` layout, as the
   * top-left anchor of the whole block. Overrides `region` scatter placement.
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
  layout?:
    | { type: 'grid'; columns?: number; jitter?: number | { x?: number; y?: number } }
    /**
     * Data layouts — entities in READING ORDER, no scatter. `list` stacks them
     * in one column `gap` apart (viewport units of min(w,h), default 0.06);
     * `table` fills `columns` row-major with `gap` `{x, y}` (one number = both).
     * Text and emoji sprites take `strings[i]` / `glyphs[i]` in order instead of
     * a seeded pick, and palette `colors[i]` likewise, so N labels or N bars are
     * ONE layer. `position` (with any count) is the block's top-left anchor;
     * without it the block is centred in `region`.
     */
    | { type: 'list'; gap?: number }
    | { type: 'table'; columns: number; gap?: number | { x?: number; y?: number } };
  /**
   * Layer lifecycle for act structure — a pure function of t, no state. Alpha is 0
   * before `enter` (ms), ramps up over `fade` ms (default 1000), holds at 1, then
   * ramps down starting at `exit`. Entities are skipped entirely while at alpha 0.
   */
  life?: { enter?: number; exit?: number; fade?: number };
  /**
   * Sparse events — marks that appear, expand and fade in place, one at a time,
   * with long silences between (the "one ping" primitive). Each entity is dark
   * except for a window of `life` ms that recurs every `every` ms at a
   * per-entity offset: `jitter` 1 (default) scatters the offsets (a fixed
   * low-discrepancy sequence — not seeded, so declaring `emit` disturbs no
   * other draw and the same spec times its events identically under every
   * seed), 0 spreads the entities evenly across the period — a metronome, one
   * event at a time as long as `life ≤ every / count`.
   * Inside a window the entity fades in over the first quarter and out over
   * the rest; `grow` scales its size from `grow[0]` to `grow[1]` across the
   * window — expansion rather than travel. A pure function of t. Flash safety:
   * `every` ≥ 1000 ms and `life` ≥ 500 ms, so no entity fires more than once a
   * second and never as a hard cut. Composes with `pulse`, `life`, `trail` and
   * every motion; with `motion.ease` the eased travel restarts on every event.
   */
  emit?: { every: number; life: number; jitter?: number; grow?: [number, number] };
  /**
   * Phase-lock. Replaces the seeded per-entity phases of `pulse`, `grow` and
   * `cycle` with one shared phase (`phase` in turns, 0..1, default 0) and runs
   * those three at `rate` × scene time (default 1). Two layers declaring the
   * same clock breathe in step; different phases give a fixed offset (call and
   * response). `pulse.wave` still adds its position-derived phase on top, so a
   * clocked wave stays a wave. Because a clocked layer moves in unison, its
   * `pulse`/`grow` periods must satisfy `period / rate ≥ 1000 ms` (1 Hz).
   */
  clock?: { phase?: number; rate?: number };
}

/**
 * Closed-form velocity easing for `drift`, `rise` and `wander`. `settle`
 * starts at the entity's speed and decelerates to rest with time constant
 * `tau` ms — it travels `speed × tau` and stops, a mark flung and coming to
 * rest. `buoyant` starts at rest and approaches the speed over `tau` — a
 * bubble reaching terminal velocity. Position stays an analytic function of
 * t (no integration state). With `emit`, the eased travel restarts from the
 * spawn point on every event. For `wander` only the base velocity eases —
 * the harmonic meander keeps breathing, so a settled wanderer hovers rather
 * than freezes.
 */
export interface MotionEase {
  type: 'settle' | 'buoyant';
  tau: number;
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
   * `feather` (0..1) softens the edges: that fraction of the half-size fades
   * out toward the border — Rothko's soft-edged block at 0.5–0.8.
   * Mondrian blocks, confetti, city lights.
   */
  | { kind: 'rect'; width: [number, number]; aspect?: [number, number]; color: string; feather?: number; colors?: string[]; colorWeights?: number[] }
  /**
   * A data bar. Entity i draws a bar `length × values[i] / max` long (viewport
   * units of min(w,h)), `thickness` thick, growing from its position toward
   * `direction` (default 'right'). `values` are PAINT — steer
   * `layers.N.sprite.values` and the bars glide; `max` defaults to the largest
   * value. Pair with a `list` layout: a chart is one layer, labels another.
   */
  | {
      kind: 'bar';
      values: number[];
      length: number;
      thickness: number;
      color: string;
      max?: number;
      direction?: 'right' | 'left' | 'up' | 'down';
      colors?: string[];
      colorWeights?: number[];
    }
  /**
   * Regular or custom polygon. `sides` (3..12, default 6) draws a regular
   * n-gon of the seeded `radius` (circumradius), point up; `points` (3..24
   * unit coordinates in −1..1, scaled by the radius) draws any facet — a
   * Picasso shard, a Kandinsky triangle, a Mondrian plane. `soft` feathers
   * the fill from the centre like a soft circle. Rotates with `spin`.
   */
  | { kind: 'polygon'; radius: [number, number]; color: string; sides?: number; points?: Array<[number, number]>; soft?: boolean; colors?: string[]; colorWeights?: number[] }
  /**
   * A freehand mark: a path through `points` (2..24 unit coordinates in
   * −1..1, scaled by the seeded `length`) stroked `width` wide with round
   * joins. `curve: 'smooth'` (default) runs a Catmull-Rom spline through the
   * points, `'linear'` a polyline. `taper` thins the mark to almost nothing at
   * both ends — a brush stroke rather than a line. `orient` turns the path's
   * +x along the entity's heading (like `streak`). Rotates with `spin`. Van
   * Gogh's stroke, Hokusai's contour, O'Keeffe's petal, Basquiat's scrawl.
   */
  | {
      kind: 'stroke';
      length: [number, number];
      points: Array<[number, number]>;
      color: string;
      width?: number;
      curve?: 'smooth' | 'linear';
      taper?: boolean;
      orient?: boolean;
      colors?: string[];
      colorWeights?: number[];
    }
  /**
   * Multi-line text block with deterministic line-breaking. Unlike `text` (one
   * string drawn as a single fillText call), `textBlock` wraps `text` within
   * `maxWidth` using a fixed metrics table so line breaks are identical across
   * platforms (same seed → same frames). All dimensions are viewport-fraction
   * (of `min(w,h)`), not px — addresses the absolute-font-size inconsistency.
   * Use with `count: 1`, `motion: { type: 'static' }`, and `position`.
   */
  | {
      kind: 'textBlock';
      text: string;
      /** Wrap width as a fraction of `min(w,h)` (up to 2.0 — `text-off-screen` catches overflow). */
      maxWidth: number;
      fontSize: number;
      lineHeight?: number;
      /** Moves the painted lines inside the wrap width (ragged edge); never the block. */
      align?: 'left' | 'center' | 'right';
      color?: string;
      reveal?: TextRevealSpec;
      /**
       * Which point of the rendered text (widest line × lines·lineHeight, as
       * `align` lays it out) `position` names. Absent: today's behaviour —
       * `position` is the top-left of the `maxWidth` layout box. With
       * `'center'` the block is centred at `position` on every aspect ratio.
       * Placement, so it is in the structural signature.
       */
      anchor?: TextBlockAnchor;
      /**
       * CSS font family and/or weight/style only (`"bold monospace"`,
       * `"300 'Inter', sans-serif"`). A size inside it is rejected —
       * `fontSize` owns size. Absent: `system-ui, sans-serif`.
       */
      font?: string;
      /**
       * 0..1 multiplier on the block's paint alpha (default 1). Paint, not
       * carpentry: excluded from the structural signature, so steering it
       * with `dur` glides the block in or out without a rebuild. Declare it
       * (`"opacity": 1`) to make the path steerable.
       */
      opacity?: number;
    };

/** Compass points of a `textBlock`'s rendered box that `position` may name. */
export type TextBlockAnchor =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right';

/**
 * Animated typing/deleting for `textBlock`. Layout always runs on the FULL
 * text — reveal only masks which glyphs are painted, so lines never reflow
 * and the block's box never changes size. `progress` is a numeric paint
 * param (excluded from the structural signature), so steering it with
 * `dur`/`ease` animates typing client-side in one call; gliding it back to 0
 * deletes. With center/right `align`, the revealing line stays anchored to
 * its alignment as it types (only left-aligned text reads as a classic
 * typewriter).
 */
export interface TextRevealSpec {
  /**
   * 0..1 fraction of the text revealed (default 1 = fully shown). Quantized
   * by `mode`. Steerable paint — glide it to animate typing or deleting.
   */
  progress?: number;
  /**
   * Reveal granularity: per-grapheme (default), per-word, per-line, or
   * `glyphFade` — each glyph fades in over a staggered alpha ramp instead of
   * appearing whole (the caption look). Still a pure function of `progress`.
   */
  mode?: 'typewriter' | 'word' | 'line' | 'glyphFade';
  /**
   * Self-typing rate in graphemes/second from scene start (media time). The
   * effective progress is `min(progress, speed·t/total)` — so a steered
   * `progress` can hold or delete even while `speed` is set. 0 = off.
   */
  speed?: number;
  /**
   * Caret at the reveal frontier. `true` for defaults, or configure blink
   * rate (Hz, full cycles/sec, capped at 3 for flash safety) and color.
   * Blink is a square wave of `t` — deterministic like everything else.
   */
  caret?: boolean | { blink?: number; color?: string };
  /**
   * `glyphFade` only: each glyph's fade window as a fraction of progress
   * (0 exclusive to 1, default 0.15). Small = soft typewriter; large = a
   * wave of overlapping fades. Ignored by the other modes.
   */
  fade?: number;
}

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
  | { type: 'drift'; speed: [number, number]; angle?: number; bidirectional?: boolean; bob?: number; ease?: MotionEase }
  /** Rise upward (px/sec) with an optional horizontal sway amplitude (px) — bubbles. */
  | { type: 'rise'; speed: [number, number]; sway?: number; ease?: MotionEase }
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
  | { type: 'wander'; speed: [number, number]; angle?: number; meander?: number; coherence?: number; ease?: MotionEase }
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
  maxTextBlockLength: 2000,
  minTextBlockFontSize: 0.01,
  maxTextBlockFontSize: 0.2,
  maxTextBlockMaxWidth: 2.0, // of min(w,h) — wider than the frame is legal; text-off-screen reports the overflow
  maxRevealSpeed: 120, // graphemes/sec — faster than any readable typing
  maxCaretBlinkHz: 3, // full blink cycles/sec — WCAG 2.3.1 flash-safety cap
  maxSegments: 24,
  minSegmentDuration: 1000, // ms — flash-safety floor: segment cuts are luminance transitions
  maxTransitionDur: 5000,
  minTransitionDur: 200,
  minEmitEvery: 1000, // ms — at most one event per second per entity (flash safety)
  maxEmitEvery: 600000, // ms — ten minutes; longer silences than that are `life.enter`
  minEmitLife: 500, // ms — an event is a smooth envelope, never a cut
  maxEmitGrow: 8, // × base size across an event window
  minClockedPeriod: 1000, // ms — a `clock`ed layer breathes in unison, so 1 Hz not 2
  minClockRate: 0.1,
  maxClockRate: 4,
  defaultListGap: 0.06, // viewport units between list/table cells (40 px in px specs)
  defaultListGapPx: 40,
  minPolygonSides: 3,
  maxPolygonSides: 12,
  maxShapePoints: 24, // polygon.points / stroke.points
  minEaseTau: 100, // ms
  maxEaseTau: 120000, // ms
} as const;

// ---------------------------------------------------------------------------
// Sequence envelope — multi-segment timeline over unmodified SaverSpecs
// ---------------------------------------------------------------------------

export type SequenceTransition =
  | { type: 'cut' }
  | { type: 'morph'; dur: number }
  /**
   * Cross-fade into the next segment over `dur` ms: the outgoing segment
   * stays alive on its own canvas and is composited over the incoming one
   * at `1 − easeSmooth(localT / dur)`. Works between unlike segments (no
   * structural requirement). Hosts on the `basic`/`minimal` capability tier
   * render it as `cut` (see `SequenceMountContext.capabilityTier`).
   */
  | { type: 'fade'; dur: number };

export interface SequenceSegment {
  key: string;
  scene: SaverSpec;
  /** Segment duration in ms. Only the final segment may omit this (holds until input). */
  duration?: number;
  /** How the segment advances: 'auto' (timer), 'input' (external event), 'either'. */
  advance?: 'auto' | 'input' | 'either';
  transition?: SequenceTransition;
}

export interface IdleSequence {
  format: 'idle-sequence';
  schemaVersion: 1;
  id: string;
  label: string;
  seed?: number;
  loop: boolean;
  /**
   * What the sequence clock is anchored to. `mount` (default — today's
   * behaviour): every viewer starts at T = 0 when it mounts, so a joiner sees
   * segment 0 (pre-roll semantics). `epoch`: a viewer handed `sequenceBaseT`
   * on its mount context (the host's `Date.now() − epoch`) starts its clock
   * there, so every screen in a room shows the same segment — a late joiner
   * lands mid-loop. `advance: 'input'` holds stay armed under either mode.
   */
  sync?: 'mount' | 'epoch';
  segments: SequenceSegment[];
}
