import { adviseSpec, perceiveScene, validateSpec } from '@idle-screens/schema';
import type { SaverSpec } from '@idle-screens/schema';
import { BENCHMARK_INTENTS } from './benchmarks';
import type { ArtistStyleProfile, BenchmarkIntent, EvalScreen, RunSummary, ScreenScore } from './types';

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

function styleFit(spec: SaverSpec, profile: ArtistStyleProfile): number {
  return 0.45 * paletteOverlap(spec, profile) + 0.35 * motionDialectFit(spec, profile) + 0.2 * densityFit(spec, profile);
}

function layerSpeeds(spec: SaverSpec): number[] {
  return spec.layers.map((l) => {
    const m = l.motion;
    if (m.type === 'static') return 0;
    if ('speed' in m && Array.isArray(m.speed)) return (m.speed[0]! + m.speed[1]!) / 2;
    return 0;
  });
}

function intentFit(screen: EvalScreen, spec: SaverSpec, perception: ScreenScore['perception']): number {
  if (screen.kind === 'signature') return 1;
  const intent: BenchmarkIntent | undefined = BENCHMARK_INTENTS.find((b) => b.id === screen.screenId);
  if (!intent) return 0.5;
  const parts: number[] = [];
  const c = intent.checks;
  if (c.minLayers != null) parts.push(spec.layers.length >= c.minLayers ? 1 : 0);
  if (c.maxLayers != null) parts.push(spec.layers.length <= c.maxLayers ? 1 : 0);
  if (c.minCoverage != null) parts.push(perception.coverage >= c.minCoverage ? 1 : 0.3);
  if (c.maxCoverage != null) parts.push(perception.coverage <= c.maxCoverage ? 1 : 0.4);
  if (c.requirePulse) parts.push(spec.layers.some((l) => l.pulse) ? 1 : 0);
  if (c.requireSpeedSeparation) {
    const speeds = layerSpeeds(spec).filter((s) => s > 0);
    if (speeds.length < 2) parts.push(0);
    else {
      const min = Math.min(...speeds);
      const max = Math.max(...speeds);
      parts.push(max >= min * 1.6 ? 1 : 0.35);
    }
  }
  if (c.requireFocalDominance) {
    parts.push(
      perception.topDominanceShare >= 0.28 ? 1 : perception.topDominanceShare >= 0.15 ? 0.55 : 0.2,
    );
  }
  return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 1;
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
    score,
    notes,
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

export function scoreSuite(
  screens: EvalScreen[],
  profiles: ArtistStyleProfile[],
  runId: string,
): { results: ScreenScore[]; summary: RunSummary } {
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

  const summary: RunSummary = {
    runId,
    createdAt: new Date().toISOString(),
    config: { viewport: DEFAULT_VIEWPORT, t: SAMPLE_T, seedFallback: 42 },
    suiteMedian,
    perArtist,
    perBenchmark,
    gapHistogram,
    failures,
    nextCycle: {
      weakArtists,
      collapsedBenchmarks,
      topGaps: gapHistogram.slice(0, 8).map((g) => g.gap),
    },
  };

  return { results, summary };
}
