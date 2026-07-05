/**
 * Performance summary for a saver, from a list of per-frame CPU costs (ms spent in
 * `renderFrame` or per animation frame). Wall-clock FPS on a shared CI runner is noisy,
 * so this REPORTS the numbers + a cost tier and only HARD-FAILS on a pathological
 * ceiling (a frame budget so large it can only mean the saver is broken). Keep this
 * separate from the deterministic flash gate so perf noise never blocks safety.
 */

export type CostTier = 'idle' | 'low' | 'medium' | 'high';

export interface PerfOptions {
  /** A frame slower than this counts toward the jank ratio. Default 16.7ms (~60fps). */
  jankMs?: number;
  /** p95 above this is pathological -> hard fail. Default 100ms. */
  pathologicalMs?: number;
}

export interface PerfReport {
  frames: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  /** Effective fps implied by the median frame cost. */
  fps: number;
  /** Fraction of frames slower than `jankMs`. */
  jankRatio: number;
  costTier: CostTier;
  /** p95 exceeded the pathological ceiling. */
  pathological: boolean;
  /** !pathological — everything else is report-only. */
  withinBudget: boolean;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(p * (sorted.length - 1)));
  return sorted[idx];
}

function tierFor(medianMs: number): CostTier {
  if (medianMs <= 2) return 'idle';
  if (medianMs <= 8) return 'low';
  if (medianMs <= 16) return 'medium';
  return 'high';
}

export function analyzePerf(frameTimesMs: number[], opts: PerfOptions = {}): PerfReport {
  const jankMs = opts.jankMs ?? 1000 / 60;
  const pathologicalMs = opts.pathologicalMs ?? 100;

  const frames = frameTimesMs.length;
  if (frames === 0) {
    return {
      frames: 0, meanMs: 0, medianMs: 0, p95Ms: 0, maxMs: 0, fps: 0,
      jankRatio: 0, costTier: 'idle', pathological: false, withinBudget: true,
    };
  }

  const sorted = [...frameTimesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const meanMs = sum / frames;
  const medianMs = percentile(sorted, 0.5);
  const p95Ms = percentile(sorted, 0.95);
  const maxMs = sorted[sorted.length - 1];
  const jankRatio = frameTimesMs.filter((t) => t > jankMs).length / frames;
  const pathological = p95Ms > pathologicalMs;

  return {
    frames,
    meanMs,
    medianMs,
    p95Ms,
    maxMs,
    fps: medianMs > 0 ? 1000 / medianMs : 0,
    jankRatio,
    costTier: tierFor(medianMs),
    pathological,
    withinBudget: !pathological,
  };
}
