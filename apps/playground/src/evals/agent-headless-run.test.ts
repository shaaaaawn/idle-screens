/**
 * Side-effect test: headless agent-loop trials of `style-authoring-v1` against
 * OpenRouter, persisting to `idle-mono/datasets/evals/style-authoring-v1/<runId>/`.
 *
 * The browser path (agent-panel → artifact-sink) needs a human at the dev
 * server; this is the same engine (runAgentBatch → runAgentScreen) driven
 * from CI/headless, writing the same file set the sink writes
 * (run.json + training/sft/repair.jsonl) plus the datasets-convention
 * summary.json (per-trial best/final, medians).
 *
 * Gated — runs only when explicitly invoked:
 *
 *   OPENROUTER_API_KEY=sk-or-... RUN_STYLE_AUTHORING_AGENT=1 \
 *     pnpm --filter @idle-screens/playground exec vitest run src/evals/agent-headless-run.test.ts
 *
 * Optional env: EVAL_MODEL (default moonshotai/kimi-k3), EVAL_TRIALS (default 3),
 * EVAL_SCREEN (default monet--benchmark--calm-horizon — the datasets probe screen),
 * EVAL_ARTIST (e.g. seurat — run EVERY screen for that artist; overrides
 * EVAL_SCREEN so an artist-axis run never silently collapses to one fixture).
 *
 * The key is read from the process environment only — never written into any
 * artifact (trajectories record model names, never credentials).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runAgentBatch, trainingJsonl, sftJsonl, repairJsonl } from './agent-run';
import type { ChatTransport } from './agent-loop';
import type { ChatRequest, ChatResponse, ChatServed } from './openrouter';
import { getCatalog, getArtist, BENCHMARK_INTENTS } from './catalog';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = process.env.EVAL_MODEL || 'moonshotai/kimi-k3';
const TRIALS = Math.max(1, Number(process.env.EVAL_TRIALS) || 3);
const SCREEN_ID = process.env.EVAL_SCREEN || 'monet--benchmark--calm-horizon';
const ARTIST_ID = process.env.EVAL_ARTIST || '';

/** chatCompletion() from openrouter.ts, minus the browser key store. */
function makeTransport(key: string): ChatTransport {
  return async (req: ChatRequest): Promise<ChatResponse> => {
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        ...(req.tools?.length ? { tools: req.tools } : {}),
      }),
      signal: req.signal ?? null,
    });
    if (!res.ok) throw new Error(`OpenRouter chat: HTTP ${res.status}`);
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: ChatResponse['toolCalls'] } }>;
      model?: string;
      id?: string;
      provider?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const msg = body.choices?.[0]?.message;
    const served: ChatServed = {
      ...(body.model ? { model: body.model } : {}),
      ...(body.provider ? { provider: body.provider } : {}),
      ...(body.id ? { generationId: body.id } : {}),
      ...(body.usage
        ? {
            usage: {
              ...(body.usage.prompt_tokens != null ? { promptTokens: body.usage.prompt_tokens } : {}),
              ...(body.usage.completion_tokens != null
                ? { completionTokens: body.usage.completion_tokens }
                : {}),
              ...(body.usage.total_tokens != null ? { totalTokens: body.usage.total_tokens } : {}),
            },
          }
        : {}),
    };
    return {
      content: msg?.content ?? null,
      toolCalls: msg?.tool_calls ?? [],
      ...(Object.keys(served).length ? { served } : {}),
    };
  };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const mid = s[m] ?? 0;
  return s.length % 2 ? mid : ((s[m - 1] ?? 0) + mid) / 2;
};

describe('headless style-authoring-v1 agent run', () => {
  it.skipIf(!process.env.RUN_STYLE_AUTHORING_AGENT)(
    'runs trials against OpenRouter and persists to datasets/evals/',
    async () => {
      const key = process.env.OPENROUTER_API_KEY ?? '';
      expect(key, 'OPENROUTER_API_KEY required').toMatch(/^sk-or-v1-/);

      const catalog = getCatalog();
      const targetScreens = ARTIST_ID
        ? (catalog.screensByArtist.get(ARTIST_ID) ?? [])
        : catalog.screens.filter((s) => s.id === SCREEN_ID);
      if (!targetScreens.length) {
        throw new Error(
          ARTIST_ID ? `artist not in catalog: ${ARTIST_ID}` : `screen not in catalog: ${SCREEN_ID}`,
        );
      }
      const targets = targetScreens.map((screen) => {
        const profile = getArtist(screen.artistId);
        if (!profile) throw new Error(`artist not in catalog: ${screen.artistId}`);
        const benchmark =
          screen.kind === 'benchmark'
            ? (BENCHMARK_INTENTS.find((b) => b.id === screen.screenId) ?? null)
            : null;
        return { screen, profile, benchmark };
      });
      const artistId = ARTIST_ID || (targetScreens[0]?.artistId ?? 'unknown');

      // Seconds, not minutes: two same-model/same-artist runs inside one
      // minute must not overwrite each other's runId directory.
      const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15); // YYYYMMDDTHHMMSS
      const shortModel = MODEL.split('/').pop() ?? MODEL;
      const runId = `run-${stamp}-${shortModel}-${artistId}`;

      console.log(
        `[eval] ${runId} — ${TRIALS} trials x ${targets.length} fixtures (${targetScreens.map((s) => s.id).join(', ')}) on ${MODEL}`,
      );
      const run = await runAgentBatch({
        runId,
        evalId: 'style-authoring-v1',
        model: MODEL,
        maxToolCalls: 8,
        trials: TRIALS,
        targets,
        // The hash answers "did the artist catalog change?" — it must cover
        // the whole catalog, as the UI passes it, or a subset run falsely
        // reads as a DNA change.
        profiles: catalog.artists,
        chat: makeTransport(key),
        onProgress: (p) => {
          if (p.type === 'screen-done') {
            const a = p.artifact;
            console.log(
              `[eval] trial ${a.trial}: outcome=${a.outcome} best=${a.best?.score.score ?? '-'} final=${a.final?.score.score ?? '-'} served=${a.served?.model ?? '?'}@${a.served?.provider ?? '?'}`,
            );
          }
        },
      });

      // Resolved (served) model id, not the requested one — OpenRouter may
      // route to a different snapshot than asked for.
      const servedModel = run.artifacts.find((a) => a.served?.model)?.served?.model ?? MODEL;

      const screens = targets.map(({ screen }) => ({
        screenId: screen.id,
        trials: run.artifacts
          .filter((a) => a.screenId === screen.id)
          .map((a) => ({
            trial: a.trial,
            bestVersion: a.best?.n ?? null,
            bestScore: a.best?.score.score ?? null,
            finalScore: a.final?.score.score ?? null,
            outcome: a.outcome,
          })),
      }));
      const summary = {
        runId,
        model: servedModel,
        evalId: run.evalId,
        // The axis slice this run chose. A partial run must read as partial:
        // fixturesRun is what ran, fixturesTotal is the eval's full matrix.
        axes: ARTIST_ID ? { artist: ARTIST_ID } : { screen: SCREEN_ID },
        fixturesRun: targets.length,
        fixturesTotal: catalog.screens.length,
        screens,
        medianBest: median(run.artifacts.map((a) => a.best?.score.score ?? 0)),
        medianFinal: median(run.artifacts.map((a) => a.final?.score.score ?? 0)),
      };

      // <mono>/datasets/evals/<evalId>/<runId>/ — five levels up from src/evals.
      // Fail loudly when the mono isn't there: mkdirSync(recursive) would
      // happily create a stray datasets/ tree outside any repo and the run
      // would "succeed" while writing artifacts where nothing finds them.
      const monoRoot = resolve(__dirname, '../../../../..');
      if (!existsSync(join(monoRoot, 'idle-server'))) {
        throw new Error(`idle-mono root not found at ${monoRoot} — run from a mono checkout`);
      }
      const outDir = join(monoRoot, 'datasets/evals', run.evalId, runId);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
      writeFileSync(join(outDir, 'training.jsonl'), `${trainingJsonl(run)}\n`);
      writeFileSync(join(outDir, 'sft.jsonl'), `${sftJsonl(run)}\n`);
      writeFileSync(join(outDir, 'repair.jsonl'), `${repairJsonl(run)}\n`);
      writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
      const screensById = new Map(targets.map((t) => [t.screen.id, t.screen]));
      for (const a of run.artifacts) {
        const s = screensById.get(a.screenId);
        const wd = join(outDir, 'work', s && s.kind === 'benchmark' ? s.screenId : 'signature');
        mkdirSync(wd, { recursive: true });
        writeFileSync(
          join(wd, `${a.screenId}.trial${a.trial}.artifact.json`),
          `${JSON.stringify(a, null, 2)}\n`,
        );
      }
      console.log(`[eval] wrote ${outDir}`);
      console.log(`[eval] medianBest=${summary.medianBest} medianFinal=${summary.medianFinal}`);

      expect(run.artifacts.length).toBe(TRIALS * targets.length);
    },
    30 * 60 * 1000,
  );
});
