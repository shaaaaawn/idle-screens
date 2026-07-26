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
  /** Perception gate: 1 when the scene registers, 0.5 marginal, 0 blank. */
  perceptionOk: number;
  /** Multiplicative penalty from notable advisories (0 = none, 1 = fully penalised). */
  advisoryPenalty: number;
  score: number;
  notes: string[];
}

/** Where / how the suite was executed. */
export type EvalHarness =
  | 'playground-ui'
  | 'headless-vitest'
  | 'agent-loop'
  | 'mcp'
  | 'manual';

/**
 * Everything needed to reproduce or continue from a run. This is the growth
 * substrate: next cycle reads provenance + nextCycle, never starts blank.
 */
export interface RunProvenance {
  harness: EvalHarness;
  /** Short human label shown on the timeline ("baseline v0", "after pulse.wave"). */
  label: string;
  /** Why this run happened — free text for the next agent. */
  note: string;
  /** Optional LLM that authored DNA / scored / steered. */
  model?: { name: string; provider?: string };
  /** Human or agent operator id. */
  operator?: string;
  /** Prior run this continues from (diff + nextCycle inheritance). */
  parentRunId?: string;
  versions: {
    /** FNV-1a of the StyleDNA catalog (artists + signature prompts). */
    styleDnaHash: string;
    /** Human tag, e.g. artists@15. */
    styleDnaLabel: string;
    /** SaverSpec format version (FORMAT.md schemaVersion). */
    saverSpecFormat: number;
    /**
     * npm version of @idle-screens/schema that compiled + perceived these
     * specs. Distinct axis from the format number: `perceiveScene` and
     * `adviseSpec` semantics can change between package versions while
     * `schemaVersion` stays 1, which moves scores without moving the format.
     * Optional — runs recorded before this was captured simply won't have it.
     */
    schemaPackage?: string;
    /** Scorer identity — bump when composite weights/bands change. */
    scorer: string;
    /** Skill / prompt pack identity. */
    skill: string;
  };
  prompts: {
    /** System / authoring prompt text used for this cycle (may be truncated in UI). */
    systemPrompt?: string;
    /** Stable hash of the full system prompt when too large to inline. */
    systemPromptHash?: string;
    /** Path to the skill or prompt file. */
    skillPath?: string;
    /** Identity of the shared benchmark intent source. */
    benchmarkSource: string;
  };
  scoringBands: {
    minCoverage: number;
    minLuminanceVar: number;
    weights: { perception: number; styleFit: number; intentFit: number };
  };
}

/** Slim index row for the timeline rail (always loaded). */
export interface RunIndexEntry {
  runId: string;
  createdAt: string;
  label: string;
  harness: EvalHarness;
  model?: string;
  suiteMedian: number;
  styleDnaHash: string;
  parentRunId?: string;
  storage: 'disk' | 'browser';
}

export interface RunDelta {
  vsRunId: string;
  suiteMedianDelta: number;
  newlyFailing: string[];
  newlyPassing: string[];
  gapDelta: Array<{ gap: string; countDelta: number }>;
}

export interface RunSummary {
  runId: string;
  createdAt: string;
  config: {
    viewport: { width: number; height: number };
    t: number;
    seedFallback: number;
  };
  /** Repro + lineage — required for growth-over-time. */
  provenance: RunProvenance;
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
  /**
   * `screenId → fnv1a(spec)` for every screen this run actually scored.
   *
   * The grid always renders TODAY's specs while the scores come from the
   * selected run, and screen ids (`monet--benchmark--calm-horizon`) survive any
   * StyleDNA edit — so without this a stale score lands on a visually different
   * tile with nothing to indicate it. ~150 hashes ≈ 7KB, versus ~300KB to
   * snapshot the specs themselves. It can't replay the old art, but it can say
   * exactly which screens are no longer what was measured.
   *
   * Optional: runs recorded before this existed report "not recorded".
   */
  screenFingerprints?: Record<string, string>;
  /** Diff vs parent when available. */
  delta?: RunDelta;
  /** Pointers for the next cycle — the primary self-improvement input. */
  nextCycle: {
    weakArtists: string[];
    collapsedBenchmarks: string[];
    topGaps: string[];
    /** Concrete actions the next tick should take. */
    suggestedActions: string[];
  };
}

/** What a New run actually does. */
export type RunMode =
  /** Call OpenRouter; model authors SaverSpecs via tools — the real eval. */
  | 'agent'
  /** Locally re-score today's catalog (no network). */
  | 'rescore';

export type AgentScope = 'screen' | 'benchmark' | 'artist' | 'suite';

/** Dialog / CLI inputs when starting a new run. */
export interface RunRequest {
  label: string;
  note: string;
  harness: EvalHarness;
  /** Default `rescore` (local). Set `agent` to call OpenRouter and author specs. */
  mode?: RunMode;
  /** Scope of screens for agent mode. Ignored for rescore (always full suite). */
  agentScope?: AgentScope;
  maxToolCalls?: number;
  modelName?: string;
  modelProvider?: string;
  operator?: string;
  systemPrompt?: string;
  parentRunId?: string;
}
