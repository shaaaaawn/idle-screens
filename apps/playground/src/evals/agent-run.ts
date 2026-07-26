/**
 * Agent-run orchestration, browser storage, and training-set export.
 *
 * Serial by design: every screen costs real API calls, so screens run one at
 * a time with an AbortController the UI holds. Artifacts stay OUT of the
 * RunSummary/run-timeline world (different shape) — they live in their own
 * localStorage store and leave as JSONL training data.
 */
import { hashStyleDna } from './provenance';
import { runAgentScreen, type AgentEvent, type ChatTransport } from './agent-loop';
import type { AgentScreenArtifact } from './agent-artifact';
import type { ArtistStyleProfile, BenchmarkIntent, EvalScreen } from './types';

export interface AgentRunTarget {
  screen: EvalScreen;
  profile: ArtistStyleProfile;
  benchmark: BenchmarkIntent | null;
}

export interface AgentRun {
  runId: string;
  createdAt: string;
  model: string;
  maxToolCalls: number;
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
  model: string;
  maxToolCalls: number;
  operator?: string;
  targets: AgentRunTarget[];
  profiles: ArtistStyleProfile[];
  chat: ChatTransport;
  onProgress?: (p: AgentRunProgress) => void;
  signal?: AbortSignal;
}

/** Serial loop over targets. An aborted run still returns what it finished. */
export async function runAgentBatch(opts: RunAgentBatchOptions): Promise<AgentRun> {
  const run: AgentRun = {
    runId: opts.runId,
    createdAt: new Date().toISOString(),
    model: opts.model,
    maxToolCalls: opts.maxToolCalls,
    ...(opts.operator ? { operator: opts.operator } : {}),
    styleDnaHash: hashStyleDna(opts.profiles),
    artifacts: [],
  };
  for (let i = 0; i < opts.targets.length; i++) {
    if (opts.signal?.aborted) break;
    const t = opts.targets[i]!;
    opts.onProgress?.({ type: 'screen-start', screenId: t.screen.id, index: i, total: opts.targets.length });
    const artifact = await runAgentScreen({
      screen: t.screen,
      profile: t.profile,
      benchmark: t.benchmark,
      model: opts.model,
      maxToolCalls: opts.maxToolCalls,
      chat: opts.chat,
      signal: opts.signal,
      onEvent: (event) => opts.onProgress?.({ type: 'screen-event', screenId: t.screen.id, event }),
    });
    run.artifacts.push(artifact);
    opts.onProgress?.({ type: 'screen-done', artifact, index: i, total: opts.targets.length });
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

/** Full trajectory per screen — the raw material for preference/RL data. */
export function trainingJsonl(run: AgentRun): string {
  return run.artifacts
    .map((a) =>
      JSON.stringify({
        screenId: a.screenId,
        artistId: a.artistId,
        benchmarkId: a.benchmarkId,
        model: a.model,
        prompt: a.prompt,
        trajectory: a.trajectory,
        initial: a.initial && { spec: a.initial.spec, score: a.initial.score.score },
        final: a.final && { spec: a.final.spec, score: a.final.score.score },
        outcome: a.outcome,
        toolCallsUsed: a.toolCallsUsed,
        maxToolCalls: a.maxToolCalls,
        styleDnaHash: run.styleDnaHash,
      }),
    )
    .join('\n');
}

/** Clean prompt → final-spec pairs for SFT; screens with no final are dropped. */
export function sftJsonl(run: AgentRun): string {
  return run.artifacts
    .filter((a) => a.final)
    .map((a) =>
      JSON.stringify({
        prompt: a.prompt,
        completion: a.final!.spec,
        score: a.final!.score.score,
        model: a.model,
        screenId: a.screenId,
      }),
    )
    .join('\n');
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
