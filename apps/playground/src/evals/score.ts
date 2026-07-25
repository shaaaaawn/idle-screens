import { adviseSpec, perceiveScene, validateSpec } from '@idle-screens/schema';
import type { SaverSpec, ScenePerception } from '@idle-screens/schema';
import { BENCHMARK_INTENTS } from './benchmarks';
import { buildProvenance, computeDelta, fingerprintScreens, suggestedActionsFrom } from './provenance';
import type {
  ArtistStyleProfile,
  BenchmarkIntent,
  EvalScreen,
  RunRequest,
  RunSummary,
  ScreenScore,
} from './types';

const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };
const SAMPLE_T = 5000;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function hexRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function colorDist(a: string, b: string): number {
  const A = hexRgb(a);
  const B = hexRgb(b);
  if (!A || !B) return 1;
  const dr = (A.r - B.r) / 255;
  const dg = (A.g - B.g) / 255;
  const db = (A.b - B.b) / 255;
  return Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3);
}

function paletteOverlap(spec: SaverSpec, profile: ArtistStyleProfile): number {
  const used = new Set<string>();
  const walk = (c: unknown): void => {
    if (typeof c === 'string' && c.startsWith('#')) used.add(c.toLowerCase());
    else if (Array.isArray(c)) c.forEach(walk);
    else if (c && typeof c === 'object') Object.values(c).forEach(walk);
  };
  walk(spec);
  if (used.size === 0) return 0;
  const accents = profile.palette.accents.map((a) => a.toLowerCase());
  let hits = 0;
  for (const accent of accents) {
    let best = 1;
    for (const u of used) best = Math.min(best, colorDist(accent, u));
    if (best < 0.22) hits++;
  }
  return hits / Math.max(1, accents.length);
}

function motionDialectFit(spec: SaverSpec, profile: ArtistStyleProfile): number {
  const preferred = new Set(profile.motionDialect.preferred);
  if (preferred.size === 0) return 1;
  let hit = 0;
  for (const layer of spec.layers) {
    if (preferred.has(layer.motion.type as never)) hit++;
  }
  return clamp(hit / Math.max(1, spec.layers.length), 0, 1);
}

function densityFit(spec: SaverSpec, profile: ArtistStyleProfile): number {
  const total = spec.layers.reduce((n, l) => n + l.count, 0);
  const expected = 40 * profile.composition.densityScale * profile.composition.layerCountHint;
  const ratio = total / Math.max(1, expected);
  if (ratio >= 0.45 && ratio <= 2.2) return 1;
  if (ratio >= 0.25 && ratio <= 3.5) return 0.6;
  return 0.25;
}

/** One row of a score explanation — the UI renders these verbatim. */
export interface ScoreTerm {
  label: string;
  /** Weight this term carries in its parent score. */
  weight: number;
  /** Normalised 0..1 result. */
  value: number;
  /** What was actually measured, in the reader's units. */
  actual: string;
  /** What the test wanted. */
  expected: string;
}

/** Style-fit decomposed. Kept beside `styleFit` so the two cannot drift. */
export function explainStyleFit(spec: SaverSpec, profile: ArtistStyleProfile): ScoreTerm[] {
  const palette = paletteOverlap(spec, profile);
  const motion = motionDialectFit(spec, profile);
  const density = densityFit(spec, profile);
  const total = spec.layers.reduce((n, l) => n + l.count, 0);
  const expected = 40 * profile.composition.densityScale * profile.composition.layerCountHint;
  const preferred = profile.motionDialect.preferred;
  const onDialect = spec.layers.filter((l) => preferred.includes(l.motion.type as never)).length;
  return [
    {
      label: 'palette overlap',
      weight: 0.45,
      value: palette,
      actual: `${Math.round(palette * profile.palette.accents.length)}/${profile.palette.accents.length} accents matched`,
      expected: `spec colours within ΔE 0.22 of the profile's accents`,
    },
    {
      label: 'motion dialect',
      weight: 0.35,
      value: motion,
      actual: `${onDialect}/${spec.layers.length} layers use ${preferred.join('/') || '(any)'}`,
      expected: 'every layer moves in the artist’s preferred dialect',
    },
    {
      label: 'density',
      weight: 0.2,
      value: density,
      actual: `${total} entities vs ~${Math.round(expected)} expected`,
      expected: '0.45×–2.2× the profile’s expected entity count',
    },
  ];
}

function styleFit(spec: SaverSpec, profile: ArtistStyleProfile): number {
  const terms = explainStyleFit(spec, profile);
  return terms.reduce((acc, t) => acc + t.weight * t.value, 0);
}

function layerSpeeds(spec: SaverSpec): number[] {
  return spec.layers.map((l) => {
    const m = l.motion;
    if (m.type === 'static') return 0;
    if ('speed' in m && Array.isArray(m.speed)) return (m.speed[0]! + m.speed[1]!) / 2;
    return 0;
  });
}

/**
 * The benchmark rubric, check by check — this IS the test the screen is being
 * put to, so the UI shows it rather than only the number it collapses into.
 * `intentFit` averages these, so the panel and the score can never disagree.
 */
export function explainIntentFit(
  screen: EvalScreen,
  spec: SaverSpec,
  perception: ScreenScore['perception'],
): ScoreTerm[] {
  if (screen.kind === 'signature') return [];
  const intent: BenchmarkIntent | undefined = BENCHMARK_INTENTS.find((b) => b.id === screen.screenId);
  if (!intent) return [];
  const terms: ScoreTerm[] = [];
  const c = intent.checks;
  const pct1 = (n: number): string => `${(n * 100).toFixed(1)}%`;

  if (c.minLayers != null) {
    terms.push({
      label: 'layer count (min)',
      weight: 1,
      value: spec.layers.length >= c.minLayers ? 1 : 0,
      actual: `${spec.layers.length} layers`,
      expected: `≥ ${c.minLayers}`,
    });
  }
  if (c.maxLayers != null) {
    terms.push({
      label: 'layer count (max)',
      weight: 1,
      value: spec.layers.length <= c.maxLayers ? 1 : 0,
      actual: `${spec.layers.length} layers`,
      expected: `≤ ${c.maxLayers}`,
    });
  }
  if (c.minCoverage != null) {
    terms.push({
      label: 'coverage (min)',
      weight: 1,
      value: perception.coverage >= c.minCoverage ? 1 : 0.3,
      actual: pct1(perception.coverage),
      expected: `≥ ${pct1(c.minCoverage)}`,
    });
  }
  if (c.maxCoverage != null) {
    terms.push({
      label: 'coverage (max)',
      weight: 1,
      value: perception.coverage <= c.maxCoverage ? 1 : 0.4,
      actual: pct1(perception.coverage),
      expected: `≤ ${pct1(c.maxCoverage)}`,
    });
  }
  if (c.requirePulse) {
    const pulsing = spec.layers.filter((l) => l.pulse).length;
    terms.push({
      label: 'pulse present',
      weight: 1,
      value: pulsing > 0 ? 1 : 0,
      actual: `${pulsing} pulsing layer${pulsing === 1 ? '' : 's'}`,
      expected: '≥ 1 layer with pulse',
    });
  }
  if (c.requireSpeedSeparation) {
    const speeds = layerSpeeds(spec).filter((s) => s > 0);
    const min = speeds.length ? Math.min(...speeds) : 0;
    const max = speeds.length ? Math.max(...speeds) : 0;
    terms.push({
      label: 'speed separation',
      weight: 1,
      value: speeds.length < 2 ? 0 : max >= min * 1.6 ? 1 : 0.35,
      actual: speeds.length < 2 ? `${speeds.length} moving layer(s)` : `${(max / min).toFixed(2)}× spread`,
      expected: '≥ 1.6× between slowest and fastest',
    });
  }
  if (c.requireFocalDominance) {
    const share = perception.topDominanceShare;
    terms.push({
      label: 'focal dominance',
      weight: 1,
      value: share >= 0.28 ? 1 : share >= 0.15 ? 0.55 : 0.2,
      actual: `top layer holds ${pct1(share)}`,
      expected: '≥ 28% of visual mass',
    });
  }
  return terms;
}

function intentFit(screen: EvalScreen, spec: SaverSpec, perception: ScreenScore['perception']): number {
  if (screen.kind === 'signature') return 1;
  const intent = BENCHMARK_INTENTS.find((b) => b.id === screen.screenId);
  if (!intent) return 0.5;
  const terms = explainIntentFit(screen, spec, perception);
  return terms.length ? terms.reduce((a, t) => a + t.value, 0) / terms.length : 1;
}

export function scoreScreen(
  screen: EvalScreen,
  profile: ArtistStyleProfile,
  opts?: { viewport?: { width: number; height: number }; t?: number },
): ScreenScore {
  const viewport = opts?.viewport ?? DEFAULT_VIEWPORT;
  const t = opts?.t ?? SAMPLE_T;
  const notes: string[] = [];
  const validation = validateSpec(screen.spec);
  const validationErrors = validation.valid
    ? []
    : validation.errors.map((e) => `${e.path}: ${e.message}`);

  if (!validation.valid) {
    return {
      screenId: screen.id,
      artistId: screen.artistId,
      kind: screen.kind,
      valid: false,
      validationErrors,
      advisoryCount: 0,
      perception: {
        coverage: 0,
        meanLuminance: 0,
        luminanceVar: 0,
        layerCount: screen.spec.layers.length,
        entityCount: 0,
        centroid: null,
        topDominanceShare: 0,
      },
      styleFit: 0,
      intentFit: 0,
      perceptionOk: 0,
      advisoryPenalty: 0,
      score: 0,
      notes: ['invalid spec', ...validationErrors],
    };
  }

  const advisories = adviseSpec(screen.spec, viewport);
  const high = advisories.filter((a) =>
    /clump|contrast|flash|empty|degenerate|full-coherence/i.test(`${a.code} ${a.message}`),
  );
  const perception = perceiveScene(screen.spec, { viewport, t, seed: screen.spec.seed });
  const entityCount = screen.spec.layers.reduce((n, l) => n + l.count, 0);
  const topDominanceShare = perception.dominance[0]?.share ?? 0;
  const lumVar = Math.max(0, perception.coverage * perception.meanLuminance * (1 - perception.meanLuminance));

  const perc: ScreenScore['perception'] = {
    coverage: perception.coverage,
    meanLuminance: perception.meanLuminance,
    luminanceVar: lumVar,
    layerCount: screen.spec.layers.length,
    entityCount,
    centroid: perception.centroid,
    topDominanceShare,
  };

  const perceptionOk =
    perception.coverage >= 0.002 && lumVar >= 0.00005 && entityCount > 0
      ? 1
      : perception.coverage >= 0.001
        ? 0.5
        : 0;

  if (perceptionOk < 1) notes.push('weak perception signal');
  if (high.length) notes.push(`${high.length} notable advisories`);

  const sf = styleFit(screen.spec, profile);
  const iff = intentFit(screen, screen.spec, perc);
  const advisoryPen = Math.min(1, high.length * 0.15);
  const score = (0.35 * perceptionOk + 0.35 * sf + 0.3 * iff) * (1 - advisoryPen);

  return {
    screenId: screen.id,
    artistId: screen.artistId,
    kind: screen.kind,
    valid: true,
    validationErrors: [],
    advisoryCount: advisories.length,
    perception: perc,
    styleFit: sf,
    intentFit: iff,
    perceptionOk,
    advisoryPenalty: advisoryPen,
    score,
    notes,
  };
}

/**
 * Everything the Evals inspector needs to explain one screen: the score, the
 * terms it decomposes into, and the full perception bundle (braille picture,
 * dominance, motion, advisories). Pure and cheap — no rendering — so the panel
 * can compute it on selection rather than gating it behind "Run suite".
 */
export interface ScreenInspection {
  score: ScreenScore;
  scene: ScenePerception;
  /** The three weighted terms of the headline score. */
  topTerms: ScoreTerm[];
  styleTerms: ScoreTerm[];
  /** Empty for signature screens — they answer to the artist, not a shared intent. */
  intentTerms: ScoreTerm[];
  intent: BenchmarkIntent | null;
}

export function inspectScreen(
  screen: EvalScreen,
  profile: ArtistStyleProfile,
  opts?: { viewport?: { width: number; height: number }; t?: number },
): ScreenInspection {
  const viewport = opts?.viewport ?? DEFAULT_VIEWPORT;
  const t = opts?.t ?? SAMPLE_T;
  const score = scoreScreen(screen, profile, { viewport, t });
  const scene = perceiveScene(screen.spec, { viewport, t, seed: screen.spec.seed });
  return {
    score,
    scene,
    topTerms: [
      {
        label: 'perception',
        weight: 0.35,
        value: score.perceptionOk,
        actual: `coverage ${(score.perception.coverage * 100).toFixed(1)}%, ${score.perception.entityCount} entities`,
        expected: 'the scene registers at all (coverage ≥ 0.2%, non-flat luminance)',
      },
      {
        label: 'style fit',
        weight: 0.35,
        value: score.styleFit,
        actual: score.styleFit.toFixed(3),
        expected: `matches ${profile.artist}’s palette, motion dialect and density`,
      },
      {
        label: 'intent fit',
        weight: 0.3,
        value: score.intentFit,
        actual: score.intentFit.toFixed(3),
        expected:
          screen.kind === 'signature'
            ? 'n/a — signature screens are artist-owned'
            : 'satisfies the shared benchmark rubric',
      },
    ],
    styleTerms: explainStyleFit(screen.spec, profile),
    intentTerms: explainIntentFit(screen, screen.spec, score.perception),
    intent: BENCHMARK_INTENTS.find((b) => b.id === screen.screenId) ?? null,
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function variance(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
}

export interface ScoreSuiteOptions {
  runId: string;
  request: RunRequest;
  /** Prior summary for delta + lineage (usually parent or latest). */
  parentSummary?: RunSummary | null;
}

export function scoreSuite(
  screens: EvalScreen[],
  profiles: ArtistStyleProfile[],
  runIdOrOpts: string | ScoreSuiteOptions,
): { results: ScreenScore[]; summary: RunSummary } {
  const opts: ScoreSuiteOptions =
    typeof runIdOrOpts === 'string'
      ? {
          runId: runIdOrOpts,
          request: {
            label: runIdOrOpts,
            note: '',
            harness: 'headless-vitest',
          },
        }
      : runIdOrOpts;

  const byId = new Map(profiles.map((p) => [p.id, p]));
  const results = screens.map((s) => {
    const profile = byId.get(s.artistId) ?? profiles[0]!;
    return scoreScreen(s, profile);
  });

  const perArtist = profiles.map((p) => {
    const scores = results.filter((r) => r.artistId === p.id).map((r) => r.score);
    return { artistId: p.id, median: median(scores), mean: mean(scores), n: scores.length };
  });

  const perBenchmark = BENCHMARK_INTENTS.map((b) => {
    const scores = results
      .filter((r) => r.kind === 'benchmark' && r.screenId.endsWith(`--benchmark--${b.id}`))
      .map((r) => r.score);
    return { benchmarkId: b.id, median: median(scores), variance: variance(scores) };
  });

  const gapHistogramMap = new Map<string, number>();
  for (const p of profiles) {
    for (const g of p.schemaGaps) {
      gapHistogramMap.set(g, (gapHistogramMap.get(g) ?? 0) + 1);
    }
  }
  const gapHistogram = [...gapHistogramMap.entries()]
    .map(([gap, count]) => ({ gap, count }))
    .sort((a, b) => b.count - a.count);

  const failures = results
    .filter((r) => !r.valid || r.score < 0.35)
    .map((r) => ({
      screenId: r.screenId,
      reason: !r.valid ? (r.validationErrors[0] ?? 'invalid') : `low score ${r.score.toFixed(3)}`,
    }));

  const suiteMedian = median(results.map((r) => r.score));
  const weakArtists = perArtist.filter((a) => a.median < suiteMedian * 0.85).map((a) => a.artistId);
  const collapsedBenchmarks = perBenchmark
    .filter((b) => b.variance < 0.002 && b.median > 0)
    .map((b) => b.benchmarkId);

  const provenance = buildProvenance(
    profiles,
    {
      ...opts.request,
      parentRunId: opts.request.parentRunId ?? opts.parentSummary?.runId,
    },
    { saverSpecFormat: screens[0]?.spec.schemaVersion ?? 1 },
  );

  const summary: RunSummary = {
    runId: opts.runId,
    createdAt: new Date().toISOString(),
    config: { viewport: DEFAULT_VIEWPORT, t: SAMPLE_T, seedFallback: 42 },
    provenance,
    suiteMedian,
    perArtist,
    perBenchmark,
    gapHistogram,
    failures,
    // Record what was actually measured so a later session can tell which
    // screens have since changed underneath the scores.
    screenFingerprints: fingerprintScreens(screens),
    nextCycle: {
      weakArtists,
      collapsedBenchmarks,
      topGaps: gapHistogram.slice(0, 8).map((g) => g.gap),
      suggestedActions: [],
    },
  };

  if (opts.parentSummary) {
    summary.delta = computeDelta(summary, opts.parentSummary);
  }
  summary.nextCycle.suggestedActions = suggestedActionsFrom(summary);

  return { results, summary };
}
