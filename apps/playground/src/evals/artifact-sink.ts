/**
 * Ship a finished agent run off the browser and onto disk.
 *
 * Why this exists: `saveAgentRun` keeps the last 5 runs in localStorage and, on
 * a quota error, silently drops the oldest and retries — then swallows the
 * failure entirely. Trajectories are large, so that path fires in normal use.
 * Everything else the eval produces is cheap to regenerate; agent runs cost
 * real API calls and can never be reproduced, because the model behind a given
 * id drifts. Losing them silently is the worst failure mode in the suite.
 *
 * Dev-server only, and off unless the server was started with a sink directory
 * configured — see `vite.config.ts`. localStorage stays as the UI's convenience
 * cache; this is the durable copy.
 */
import { trainingJsonl, repairJsonl, sftJsonl, type AgentRun } from './agent-run';

/** Injected by vite.config.ts; empty string when no sink is configured. */
declare const __EVAL_SINK__: string;

export const SINK_ENABLED: boolean =
  typeof __EVAL_SINK__ === 'string' && __EVAL_SINK__ === 'on';

export interface SinkResult {
  ok: boolean;
  /** Where the dev server wrote it, for the UI to show. */
  path?: string;
  error?: string;
}

/**
 * The operator is a human name typed into Settings. It identifies a person, it
 * has no analytic value in a training record, and the whole point of writing
 * these to disk is that they persist — so it is dropped at the boundary rather
 * than carried and scrubbed later.
 */
function scrub(run: AgentRun): Omit<AgentRun, 'operator'> {
  const copy: AgentRun = { ...run };
  delete copy.operator;
  return copy;
}

export async function persistAgentRun(run: AgentRun): Promise<SinkResult> {
  if (!SINK_ENABLED) return { ok: false, error: 'no sink configured' };
  try {
    const res = await fetch('/__eval-sink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: run.runId,
        evalId: run.evalId,
        files: {
          'run.json': JSON.stringify(scrub(run), null, 2),
          'training.jsonl': trainingJsonl(run),
          'sft.jsonl': sftJsonl(run),
          'repair.jsonl': repairJsonl(run),
        },
      }),
    });
    if (!res.ok) return { ok: false, error: `sink HTTP ${res.status}` };
    const body = (await res.json()) as { path?: string };
    return { ok: true, ...(body.path ? { path: body.path } : {}) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
