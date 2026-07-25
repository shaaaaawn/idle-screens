import type { BackgroundSpec, SaverSpec } from '@idle-screens/schema';

/** Shared benchmark intent — same prompt for every artist. */
export interface BenchmarkIntent {
  id: string;
  title: string;
  /** What every style must attempt; held constant across artists. */
  intent: string;
  /** Soft targets used by intent_fit scoring. */
  checks: {
    minLayers?: number;
    maxLayers?: number;
    minCoverage?: number;
    maxCoverage?: number;
    requirePulse?: boolean;
    requireSpeedSeparation?: boolean;
    requireFocalDominance?: boolean;
  };
}

export type SpriteKind = 'circle' | 'ring' | 'streak' | 'rect' | 'emoji' | 'text';
export type MotionKind =
  | 'drift'
  | 'rise'
  | 'orbit'
  | 'wander'
  | 'warp'
  | 'path'
  | 'static'
  | 'bounce';

/**
 * Durable style object — serializable, steerable, independent of any one screen.
 * Future idle-server StyleDO can store this shape and recompile screens from
 * DNA × intent.
 */
export interface ArtistStyleProfile {
  id: string;
  artist: string;
  movement: string;
  years: string;
  research: {
    thesis: string;
    visualPrinciples: string[];
    antiPatterns: string[];
    tempo: 'calm' | 'moderate' | 'energetic';
    depth: 'flat' | 'atmospheric' | 'parallax' | 'layered-planes';
  };
  palette: {
    background: BackgroundSpec;
    accents: string[];
    /** Optional weights matching accents length. */
    weights?: number[];
  };
  markMaking: {
    primarySprites: SpriteKind[];
    softGlow: boolean;
    blend: 'lighter' | 'screen' | 'multiply' | 'source-over';
    typicalAlpha: [number, number];
    ghosting?: number;
    linkMode?: 'nearest' | 'chain' | 'random';
    emojiGlyphs?: string[];
  };
  motionDialect: {
    preferred: MotionKind[];
    speedScale: number;
    bobScale: number;
    pulse?: { amp: number; period: number; wave?: boolean };
  };
  composition: {
    regionBias?: { x?: [number, number]; y?: [number, number] };
    densityScale: number;
    layerCountHint: number;
  };
  /** What schema v1 cannot express for this style — feeds next cycle. */
  schemaGaps: string[];
  /** Proposed Durable Object / setParam paths. */
  durableKeys: string[];
  signaturePrompts: Array<{ id: string; title: string; intent: string; recipe: SignatureRecipe }>;
}

/** Named composition recipes for signature (and optional bench) screens. */
export type SignatureRecipe =
  | 'field-of-marks'
  | 'horizon-band'
  | 'focal-orb'
  | 'geometric-planes'
  | 'linked-web'
  | 'rising-forms'
  | 'pulsing-atmosphere'
  | 'grid-lattice'
  | 'spiral-orbit'
  | 'gesture-streaks'
  | 'all-over-infinity'
  | 'hard-edge-blocks';

export interface EvalScreen {
  /** `${artistId}--${kind}--${screenId}` */
  id: string;
  artistId: string;
  kind: 'benchmark' | 'signature';
  screenId: string;
  title: string;
  intent: string;
  recipe: SignatureRecipe | 'benchmark';
  spec: SaverSpec;
}

export interface ScreenScore {
  screenId: string;
  artistId: string;
  kind: 'benchmark' | 'signature';
  valid: boolean;
  validationErrors: string[];
  advisoryCount: number;
  perception: {
    coverage: number;
    meanLuminance: number;
    luminanceVar: number;
    layerCount: number;
    entityCount: number;
    centroid: { x: number; y: number } | null;
    topDominanceShare: number;
  };
  styleFit: number;
  intentFit: number;
  score: number;
  notes: string[];
}

export interface RunSummary {
  runId: string;
  createdAt: string;
  config: {
    viewport: { width: number; height: number };
    t: number;
    seedFallback: number;
  };
  suiteMedian: number;
  perArtist: Array<{ artistId: string; median: number; mean: number; n: number }>;
  perBenchmark: Array<{
    benchmarkId: string;
    median: number;
    /** Cross-artist score variance — collapse detector. */
    variance: number;
  }>;
  gapHistogram: Array<{ gap: string; count: number }>;
  failures: Array<{ screenId: string; reason: string }>;
  /** Pointers for the next cycle. */
  nextCycle: {
    weakArtists: string[];
    collapsedBenchmarks: string[];
    topGaps: string[];
  };
}
