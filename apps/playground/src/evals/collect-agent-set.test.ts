/**
 * Side-effect test: collect a directory of externally-authored screen
 * artifacts into one AgentRun and write the standard sink files
 * (run.json / training.jsonl / sft.jsonl / repair.jsonl) plus a summary.json.
 *
 * This is the aggregation half of a headless agent-eval harness: the "model"
 * under test is an agent CLI (e.g. Kimi Code subagents) that authored specs
 * on disk using `score-candidate.test.ts` for feedback, rather than an
 * OpenRouter transport driving `runAgentBatch`. Scores are RECOMPUTED here
 * with `scoreScreen` — the artifacts' own claims are never trusted, same rule
 * as the browser loop.
 *
 * Gated on IDLE_AGENT_SET_DIR — skips in CI.
 *
 *   IDLE_AGENT_SET_DIR=<dir of *.artifact.json> \
 *   IDLE_AGENT_RUN_ID=run-... \
 *   IDLE_AGENT_MODEL=moonshotai/kimi-k3 \
 *   IDLE_AGENT_SET_OUT=<output dir> \
 *   pnpm exec vitest run src/evals/collect-agent-set.test.ts
 *
 * Each *.artifact.json (one per screen × trial):
 *
 *   {
 *     "screenId": "monet--benchmark--calm-horizon",
 *     "trial": 0,
 *     "startedAt": "ISO", "finishedAt": "ISO",
 *     "toolCallsUsed": 5,
 *     "submissions": [{ "spec": {…} }, …],           // accepted, in order
 *     "rejections": [{ "afterVersion": 0, "spec": …, "validationErrors": […] }]
 *   }
 *
 * The trajectory is a faithful reconstruction of the runAgentScreen message
 * flow (submit_spec → score → … → finish) — the harness had no chat wire, so
 * the conversation is rebuilt from what was actually submitted and measured.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SaverSpec } from '@idle-screens/schema';
import { getCatalog } from './catalog';
import { BENCHMARK_INTENTS } from './benchmarks';
import { buildAgentPrompt } from './agent-loop';
import { scoreScreen } from './score';
import { hashStyleDna } from './provenance';
import { repairJsonl, sftJsonl, trainingJsonl, type AgentRun } from './agent-run';
import type { AgentRejection, AgentScreenArtifact, AgentSpecVersion } from './agent-artifact';
import type { ChatMessage } from './openrouter';

const MAX_TOOL_CALLS = 8;

interface ExternalArtifact {
  screenId: string;
  trial: number;
  startedAt: string;
  finishedAt: string;
  toolCallsUsed: number;
  submissions: Array<{ spec: SaverSpec }>;
  rejections?: AgentRejection[];
}

function toolCallMsg(n: number, name: string, args: unknown): ChatMessage {
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      { id: `call_${n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } },
    ],
  };
}

function toolResultMsg(n: number, result: unknown): ChatMessage {
  return { role: 'tool', tool_call_id: `call_${n}`, content: JSON.stringify(result) };
}

/** Rebuild the message flow runAgentScreen would have recorded for these submissions. */
function reconstructTrajectory(
  prompt: { system: string; user: string },
  versions: AgentSpecVersion[],
  rejections: AgentRejection[],
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];
  let call = 0;
  let accepted = 0;
  const rejectedBefore = (n: number): AgentRejection[] =>
    rejections.filter((r) => r.afterVersion === n - 1);
  for (const v of versions) {
    for (const r of rejectedBefore(v.n)) {
      call++;
      messages.push(toolCallMsg(call, 'submit_spec', { spec: r.spec }));
      messages.push(toolResultMsg(call, { ok: false, errors: r.validationErrors }));
    }
    call++;
    messages.push(toolCallMsg(call, 'submit_spec', { spec: v.spec }));
    messages.push(
      toolResultMsg(call, {
        ok: true,
        version: v.n,
        next: 'call perceive to see it, score to grade it, or finish to end',
      }),
    );
    call++;
    messages.push(toolCallMsg(call, 'score', {}));
    messages.push(
      toolResultMsg(call, {
        ok: true,
        score: v.score.score,
        styleFit: v.score.styleFit,
        intentFit: v.score.intentFit,
        perceptionOk: v.score.perceptionOk,
        advisoryPenalty: v.score.advisoryPenalty,
        notes: v.score.notes,
      }),
    );
    accepted++;
  }
  for (const r of rejectedBefore(accepted + 1)) {
    call++;
    messages.push(toolCallMsg(call, 'submit_spec', { spec: r.spec }));
    messages.push(toolResultMsg(call, { ok: false, errors: r.validationErrors }));
  }
  call++;
  messages.push(toolCallMsg(call, 'finish', {}));
  messages.push(toolResultMsg(call, { ok: true }));
  return messages;
}

describe('collect external agent set', () => {
  it.skipIf(!process.env.IDLE_AGENT_SET_DIR)('builds run.json + jsonl exports from disk artifacts', () => {
    const dir = process.env.IDLE_AGENT_SET_DIR!;
    const outDir = process.env.IDLE_AGENT_SET_OUT ?? dir;
    const model = process.env.IDLE_AGENT_MODEL ?? 'unknown/model';
    const runId =
      process.env.IDLE_AGENT_RUN_ID ??
      `run-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}-external`;

    const catalog = getCatalog();
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.artifact.json'))
      .sort();
    expect(files.length, `no *.artifact.json in ${dir}`).toBeGreaterThan(0);

    const served = { model, provider: 'kimi-code-cli (headless agent harness)' };
    const artifacts: AgentScreenArtifact[] = files.map((f) => {
      const ext = JSON.parse(readFileSync(join(dir, f), 'utf8')) as ExternalArtifact;
      const screen = catalog.screens.find((s) => s.id === ext.screenId);
      expect(screen, `${f}: unknown screen ${ext.screenId}`).toBeTruthy();
      const profile = catalog.artists.find((a) => a.id === screen!.artistId)!;
      const benchmark =
        screen!.kind === 'benchmark'
          ? (BENCHMARK_INTENTS.find((b) => b.id === screen!.screenId) ?? null)
          : null;
      const prompt = buildAgentPrompt(screen!, profile, benchmark, MAX_TOOL_CALLS);
      const versions: AgentSpecVersion[] = ext.submissions.map((s, i) => ({
        n: i + 1,
        spec: s.spec,
        score: scoreScreen({ ...screen!, spec: s.spec }, profile),
      }));
      const rejections = ext.rejections ?? [];
      let best: AgentSpecVersion | null = null;
      for (const v of versions) if (!best || v.score.score > best.score.score) best = v;
      return {
        screenId: ext.screenId,
        artistId: screen!.artistId,
        benchmarkId: benchmark?.id ?? screen!.screenId,
        model,
        served,
        trial: ext.trial,
        maxToolCalls: MAX_TOOL_CALLS,
        toolCallsUsed: ext.toolCallsUsed,
        startedAt: ext.startedAt,
        finishedAt: ext.finishedAt,
        prompt,
        trajectory: reconstructTrajectory(prompt, versions, rejections),
        versions,
        rejections,
        initial: versions[0] ?? null,
        final: versions[versions.length - 1] ?? null,
        best,
        outcome: versions.length ? 'finished' : 'error',
        ...(versions.length ? {} : { error: 'no valid submissions' }),
      };
    });

    const run: AgentRun = {
      runId,
      createdAt: new Date().toISOString(),
      evalId: 'style-authoring-v1',
      model,
      maxToolCalls: MAX_TOOL_CALLS,
      trials: Math.max(...artifacts.map((a) => a.trial)) + 1,
      styleDnaHash: hashStyleDna(catalog.artists),
      artifacts,
    };

    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'run.json'), JSON.stringify(run, null, 2));
    writeFileSync(join(outDir, 'training.jsonl'), trainingJsonl(run) + '\n');
    writeFileSync(join(outDir, 'sft.jsonl'), sftJsonl(run) + '\n');
    writeFileSync(join(outDir, 'repair.jsonl'), repairJsonl(run) + '\n');

    // Publish-selection summary: every trial's best, ranked per screen.
    const perScreen = new Map<string, AgentScreenArtifact[]>();
    for (const a of artifacts) {
      perScreen.set(a.screenId, [...(perScreen.get(a.screenId) ?? []), a]);
    }
    const summary = {
      runId,
      model,
      evalId: run.evalId,
      screens: [...perScreen.entries()].map(([screenId, as]) => ({
        screenId,
        trials: as
          .map((a) => ({
            trial: a.trial,
            bestVersion: a.best?.n ?? null,
            bestScore: a.best?.score.score ?? null,
            finalScore: a.final?.score.score ?? null,
            outcome: a.outcome,
          }))
          .sort((x, y) => (y.bestScore ?? 0) - (x.bestScore ?? 0)),
      })),
      medianBest: median(artifacts.map((a) => a.best?.score.score ?? 0)),
      medianFinal: median(artifacts.map((a) => a.final?.score.score ?? 0)),
    };
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  });
});

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}
