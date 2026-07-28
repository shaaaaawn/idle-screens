/**
 * Agent-run orchestration, browser storage, and training-set export.
 *
 * Serial by design: every screen costs real API calls, so screens run one at
 * a time with an AbortController the UI holds. Artifacts stay OUT of the
 * RunSummary/run-timeline world (different shape) — they live in their own
 * localStorage store and leave as JSONL training data.
 */
import { hashStyleDna, SCHEMA_PKG_VERSION } from './provenance';
import { runAgentScreen, type AgentEvent, type ChatTransport } from './agent-loop';
import type { AgentScreenArtifact } from './agent-artifact';
import type { EvalId } from './eval-registry';
import type { ArtistStyleProfile, BenchmarkIntent, EvalScreen } from './types';

export interface AgentRunTarget {
  screen: EvalScreen;
  profile: ArtistStyleProfile;
  benchmark: BenchmarkIntent | null;
}

export interface AgentRun {
  runId: string;
  createdAt: string;
  /** Which eval this run belongs to. Stamped onto every exported record. */
  evalId: EvalId;
  model: string;
  maxToolCalls: number;
  /** Repeats per target. >1 is what makes a published number meaningful. */
  trials: number;
  operator?: string;
  styleDnaHash: string;
  artifacts: AgentScreenArtifact[];
}

export type AgentRunProgress =
  | { type: 'screen-start'; screenId: string; index: number; total: number }
  | { type: 'screen-event'; screenId: string; event: AgentEvent }
  | { type: 'screen-done'; artifact: AgentScreenArtifact; index: number; total: number }
  | { type: 'run-done'; run: AgentRun };

export interface RunAgentBatchOptions {
  runId: string;
  /** Defaults to `style-authoring-v1`. */
  evalId?: EvalId;
  model: string;
  maxToolCalls: number;
  /**
   * Repeats per target, default 1.
   *
   * A single sample per (screen, model) is the standard way a published model
   * comparison gets torn apart, and rightly: these loops are high-variance, so
   * one draw says almost nothing. Anything intended for publication wants >= 3.
   */
  trials?: number;
  operator?: string;
  targets: AgentRunTarget[];
  profiles: ArtistStyleProfile[];
  chat: ChatTransport;
  onProgress?: (p: AgentRunProgress) => void;
  signal?: AbortSignal;
}

/**
 * Serial loop over targets x trials. An aborted run still returns what it
 * finished.
 *
 * Trials are the OUTER loop so an abort leaves a complete first pass over every
 * target rather than three samples of the first few and nothing of the rest —
 * a partial run is then still usable, just at lower N.
 */
export async function runAgentBatch(opts: RunAgentBatchOptions): Promise<AgentRun> {
  const trials = Math.max(1, opts.trials ?? 1);
  const run: AgentRun = {
    runId: opts.runId,
    createdAt: new Date().toISOString(),
    evalId: opts.evalId ?? 'style-authoring-v1',
    model: opts.model,
    maxToolCalls: opts.maxToolCalls,
    trials,
    ...(opts.operator ? { operator: opts.operator } : {}),
    styleDnaHash: hashStyleDna(opts.profiles),
    artifacts: [],
  };
  const total = opts.targets.length * trials;
  let done = 0;
  for (let trial = 0; trial < trials; trial++) {
    for (const t of opts.targets) {
      if (opts.signal?.aborted) {
        opts.onProgress?.({ type: 'run-done', run });
        return run;
      }
      opts.onProgress?.({ type: 'screen-start', screenId: t.screen.id, index: done, total });
      const artifact = await runAgentScreen({
        screen: t.screen,
        profile: t.profile,
        benchmark: t.benchmark,
        model: opts.model,
        maxToolCalls: opts.maxToolCalls,
        trial,
        chat: opts.chat,
        signal: opts.signal,
        onEvent: (event) => opts.onProgress?.({ type: 'screen-event', screenId: t.screen.id, event }),
      });
      run.artifacts.push(artifact);
      opts.onProgress?.({ type: 'screen-done', artifact, index: done, total });
      done++;
    }
  }
  opts.onProgress?.({ type: 'run-done', run });
  return run;
}

// ---------------------------------------------------------------------------
// browser storage

const LS_AGENT_RUNS = 'idle-screens:style-eval:agent-runs';
const MAX_STORED_RUNS = 5;

function safeLocal(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function listAgentRuns(): Array<Omit<AgentRun, 'artifacts'> & { screens: number }> {
  const raw = safeLocal()?.getItem(LS_AGENT_RUNS);
  if (!raw) return [];
  try {
    const runs = JSON.parse(raw) as AgentRun[];
    if (!Array.isArray(runs)) return [];
    return runs.map(({ artifacts, ...rest }) => ({ ...rest, screens: artifacts.length }));
  } catch {
    return [];
  }
}

export function loadAgentRun(runId: string): AgentRun | null {
  const raw = safeLocal()?.getItem(LS_AGENT_RUNS);
  if (!raw) return null;
  try {
    const runs = JSON.parse(raw) as AgentRun[];
    return runs.find((r) => r.runId === runId) ?? null;
  } catch {
    return null;
  }
}

export function saveAgentRun(run: AgentRun): void {
  const raw = safeLocal()?.getItem(LS_AGENT_RUNS);
  let runs: AgentRun[] = [];
  try {
    if (raw) runs = JSON.parse(raw) as AgentRun[];
  } catch {
    runs = [];
  }
  runs = [run, ...runs.filter((r) => r.runId !== run.runId)].slice(0, MAX_STORED_RUNS);
  try {
    safeLocal()?.setItem(LS_AGENT_RUNS, JSON.stringify(runs));
  } catch {
    // Trajectories are large; if quota bites, drop the oldest and retry once.
    runs = runs.slice(0, Math.max(1, runs.length - 1));
    try {
      safeLocal()?.setItem(LS_AGENT_RUNS, JSON.stringify(runs));
    } catch { /* export still works — storage is a convenience */ }
  }
}

// ---------------------------------------------------------------------------
// export shapes

/**
 * Bump when the record shape changes in a way a reader must notice.
 *
 * The committed `results.jsonl` baseline already demonstrates why this exists:
 * its rows predate `perceptionOk` and `advisoryPenalty` on `ScreenScore`, so
 * two files with the same name hold different shapes and nothing in either says
 * so. A version field costs one key and makes that legible forever.
 */
export const TRAINING_RECORD_VERSION = 1;

/**
 * One self-describing record per screen — the raw material for preference and
 * RL data.
 *
 * Everything the artifact holds survives, because the export is the last point
 * at which any of it exists:
 *
 * - `versions[]` whole, not just initial/final. Consecutive versions with
 *   rising scores are free preference pairs on an identical prompt, which is
 *   the single highest-value structure in the artifact.
 * - the full `ScreenScore` per version, not the composite scalar. The composite
 *   is recoverable from its parts; the parts are not recoverable from it.
 * - `rejections[]`, the negatives.
 * - the provenance envelope, so a line torn out of its run is still readable.
 */
export function trainingJsonl(run: AgentRun): string {
  return run.artifacts
    .map((a) =>
      JSON.stringify({
        recordVersion: TRAINING_RECORD_VERSION,
        evalId: run.evalId,
        runId: run.runId,
        createdAt: run.createdAt,
        harness: 'agent-loop',
        screenId: a.screenId,
        artistId: a.artistId,
        benchmarkId: a.benchmarkId,
        trial: a.trial,
        requestedModel: a.model,
        served: a.served ?? null,
        prompt: a.prompt,
        trajectory: a.trajectory,
        versions: a.versions,
        rejections: a.rejections,
        initialVersion: a.initial?.n ?? null,
        finalVersion: a.final?.n ?? null,
        bestVersion: a.best?.n ?? null,
        outcome: a.outcome,
        error: a.error ?? null,
        toolCallsUsed: a.toolCallsUsed,
        maxToolCalls: a.maxToolCalls,
        provenance: {
          styleDnaHash: run.styleDnaHash,
          schemaPackage: SCHEMA_PKG_VERSION,
          trials: run.trials,
        },
      }),
    )
    .join('\n');
}

/**
 * Clean prompt → spec pairs for SFT.
 *
 * Trains on `best`, not `final`: a model can refine v2 into a worse v3 and stop
 * there, and taking the last version would teach the regression while labelling
 * it the answer.
 */
export function sftJsonl(run: AgentRun): string {
  return run.artifacts
    .filter((a) => a.best)
    .map((a) =>
      JSON.stringify({
        recordVersion: TRAINING_RECORD_VERSION,
        evalId: run.evalId,
        prompt: a.prompt,
        completion: a.best!.spec,
        score: a.best!.score.score,
        scoreBreakdown: a.best!.score,
        requestedModel: a.model,
        served: a.served ?? null,
        screenId: a.screenId,
        trial: a.trial,
      }),
    )
    .join('\n');
}

/**
 * Prompt → (rejected spec, validator errors, accepted spec) triples.
 *
 * Split out because these are the most teachable rows in the run and they were
 * previously unreachable: an invalid submission only ever appeared as a
 * tool-result string inside the trajectory. `corrected` is the first version
 * accepted after the rejection, or null if the model never recovered.
 */
export function repairJsonl(run: AgentRun): string {
  const lines: string[] = [];
  for (const a of run.artifacts) {
    for (const r of a.rejections) {
      const corrected = a.versions.find((v) => v.n === r.afterVersion + 1) ?? null;
      lines.push(
        JSON.stringify({
          recordVersion: TRAINING_RECORD_VERSION,
          evalId: run.evalId,
          screenId: a.screenId,
          trial: a.trial,
          prompt: a.prompt,
          rejected: r.spec,
          reason: r.reason,
          validationErrors: r.validationErrors,
          corrected: corrected?.spec ?? null,
          correctedScore: corrected?.score.score ?? null,
        }),
      );
    }
  }
  return lines.join('\n');
}

export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
