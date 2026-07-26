/**
 * Bridge agent-loop artifacts into the timeline RunSummary world.
 *
 * An agent run's evidence is the model-authored SaverSpec per screen (plus
 * locally computed scores). Without this bridge, "New run" with an OpenRouter
 * model only re-scored the static catalog — the network was never hit.
 */
import type { SaverSpec } from '@idle-screens/schema';
import type { AgentRun } from './agent-run';
import { buildProvenance, computeDelta, fingerprintScreens, suggestedActionsFrom, toIndexEntry } from './provenance';
import type {
  ArtistStyleProfile,
  EvalScreen,
  RunRequest,
  RunSummary,
  ScreenScore,
} from './types';
import type { StoredRun } from './run-store';
import { BENCHMARK_INTENTS } from './benchmarks';

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

export interface BridgedAgentRun {
  stored: StoredRun;
  /** Screens to render in the grid — catalog shell + model-authored specs. */
  screens: EvalScreen[];
  indexEntry: ReturnType<typeof toIndexEntry>;
}

/**
 * Fold an AgentRun into a timeline StoredRun.
 * Screens without a final spec become score-0 failures (still evidence).
 */
export function bridgeAgentRunToTimeline(
  agent: AgentRun,
  catalogScreens: EvalScreen[],
  profiles: ArtistStyleProfile[],
  req: RunRequest,
  parentSummary?: RunSummary | null,
): BridgedAgentRun {
  const byId = new Map(catalogScreens.map((s) => [s.id, s]));
  const screens: EvalScreen[] = [];
  const results: ScreenScore[] = [];

  for (const a of agent.artifacts) {
    const base = byId.get(a.screenId);
    if (!base) continue;
    if (a.final) {
      const authored: SaverSpec = {
        ...a.final.spec,
        id: base.id,
        label: base.spec.label,
        schemaVersion: 1,
      };
      const screen: EvalScreen = { ...base, spec: authored };
      screens.push(screen);
      results.push({ ...a.final.score, screenId: a.screenId, artistId: a.artistId, kind: base.kind });
    } else {
      screens.push(base);
      results.push({
        screenId: a.screenId,
        artistId: a.artistId,
        kind: base.kind,
        valid: false,
        validationErrors: [`agent outcome: ${a.outcome}${a.error ? ` — ${a.error}` : ''}`],
        advisoryCount: 0,
        perception: {
          coverage: 0,
          meanLuminance: 0,
          luminanceVar: 0,
          layerCount: 0,
          entityCount: 0,
          centroid: null,
          topDominanceShare: 0,
        },
        styleFit: 0,
        intentFit: 0,
        perceptionOk: 0,
        advisoryPenalty: 0,
        score: 0,
        notes: [`no final spec (${a.outcome})`, `toolCalls ${a.toolCallsUsed}/${a.maxToolCalls}`],
      });
    }
  }

  const suiteMedian = median(results.map((r) => r.score));
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
    for (const g of p.schemaGaps) gapHistogramMap.set(g, (gapHistogramMap.get(g) ?? 0) + 1);
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

  const weakArtists = perArtist.filter((a) => a.n > 0 && a.median < suiteMedian * 0.85).map((a) => a.artistId);
  const collapsedBenchmarks = perBenchmark
    .filter((b) => b.variance < 0.002 && b.median > 0)
    .map((b) => b.benchmarkId);

  const provenance = buildProvenance(profiles, {
    ...req,
    harness: 'agent-loop',
    modelName: req.modelName ?? agent.model,
    parentRunId: req.parentRunId ?? parentSummary?.runId,
    note:
      req.note ||
      `OpenRouter agent-loop authored ${results.filter((r) => r.valid).length}/${results.length} screens` +
        ` (maxToolCalls=${agent.maxToolCalls}).`,
  });
  // Prefer the live StyleDNA hash from the agent run when present.
  provenance.versions.styleDnaHash = agent.styleDnaHash || provenance.versions.styleDnaHash;

  const summary: RunSummary = {
    runId: agent.runId,
    createdAt: agent.createdAt,
    config: { viewport: { width: 1920, height: 1080 }, t: 5000, seedFallback: 42 },
    provenance,
    suiteMedian,
    perArtist,
    perBenchmark,
    gapHistogram,
    failures,
    screenFingerprints: fingerprintScreens(screens),
    nextCycle: {
      weakArtists,
      collapsedBenchmarks,
      topGaps: gapHistogram.slice(0, 8).map((g) => g.gap),
      suggestedActions: [],
    },
  };
  if (parentSummary) summary.delta = computeDelta(summary, parentSummary);
  summary.nextCycle.suggestedActions = suggestedActionsFrom(summary);

  const stored: StoredRun = {
    summary,
    results,
    authoredScreens: screens,
    agentRunId: agent.runId,
  };

  return {
    stored,
    screens,
    indexEntry: toIndexEntry(summary, 'browser'),
  };
}
