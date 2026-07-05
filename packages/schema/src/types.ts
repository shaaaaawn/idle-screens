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
}

export type BackgroundSpec =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; stops: GradientStop[]; band?: BandSpec };

/** A vertical gradient stop (`at` 0 = top, 1 = bottom). */
export interface GradientStop {
  at: number;
  color: string;
}

/** An optional solid band at the bottom (e.g. an aquarium seafloor). */
export interface BandSpec {
  color: string;
  /** Band height in px. */
  height: number;
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
}

export type SpriteSpec =
  | { kind: 'emoji'; glyphs: string[] }
  | { kind: 'text'; strings: string[]; color?: string; font?: string }
  | { kind: 'circle'; radius: [number, number]; color: string };

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
  | { type: 'bounce'; speed: [number, number] };

/** A validation problem, pointing at a JSON path within the spec. */
export interface SpecError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: SpecError[];
}

/** Perf/safety caps enforced by `validateSpec`. */
export const LIMITS = {
  maxPerLayer: 400,
  maxTotal: 800,
  maxLayers: 8,
  maxSpeed: 4000, // px/sec — bounds motion so nothing teleports
} as const;
