/**
 * Agent-loop eval engine: hand a model a StyleDNA profile + benchmark intent
 * and let it author a SaverSpec through tools — submit → perceive → score →
 * refine — up to a per-run tool-call budget. What comes out is an artifact:
 * the prompt, the full trajectory, and locally-scored initial/final specs.
 *
 * The transport is INJECTED (`chat`) — the UI passes the OpenRouter one from
 * `openrouter.ts`, tests pass a scripted fake. This file never touches the
 * network or the API key, and every score in the artifact is computed locally
 * with `scoreScreen` — the model's self-assessment is never a label.
 */
import FORMAT_MD from '../../../../packages/schema/FORMAT.md?raw';
import specSchemaJson from '../../../../packages/schema/saver-spec.schema.json';
import { adviseSpec, perceiveScene, validateSpec, type SaverSpec } from '@idle-screens/schema';
import { explainIntentFit, scoreScreen } from './score';
import type { ChatMessage, ChatRequest, ChatResponse, ChatToolDef } from './openrouter';
import type { AgentScreenArtifact, AgentSpecVersion } from './agent-artifact';
import type { ArtistStyleProfile, BenchmarkIntent, EvalScreen } from './types';

export type ChatTransport = (req: ChatRequest) => Promise<ChatResponse>;

export type AgentEvent =
  | { type: 'assistant'; text: string }
  | { type: 'tool'; name: string; ok: boolean; summary: string }
  | { type: 'version'; n: number; score: number };

export interface RunAgentScreenOptions {
  screen: EvalScreen;
  profile: ArtistStyleProfile;
  /** Null for signature screens — they answer to the artist, not a rubric. */
  benchmark: BenchmarkIntent | null;
  model: string;
  maxToolCalls: number;
  chat: ChatTransport;
  onEvent?: (e: AgentEvent) => void;
  signal?: AbortSignal;
}

const DEFAULT_VIEWPORT = { width: 1920, height: 1080 };
const SAMPLE_T = 5000;

// OpenAI-style function parameters don't want draft-07 meta keys.
const SPEC_PARAMS = (() => {
  const copy = { ...(specSchemaJson as Record<string, unknown>) };
  delete copy.$schema;
  delete copy.$id;
  return copy;
})();

const TOOLS: ChatToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'submit_spec',
      description:
        'Submit a candidate SaverSpec. Invalid specs come back with validation errors — fix and resubmit. Each valid submission is versioned (v1, v2, …).',
      parameters: {
        type: 'object',
        properties: { spec: SPEC_PARAMS },
        required: ['spec'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'perceive',
      description:
        'SEE the current candidate: a braille luminance picture plus coverage, luminance, balance, dominance and advisories. Always perceive after submitting.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'score',
      description:
        'Grade the current candidate against the style rubric and the benchmark rubric. Returns failing checks with measured vs wanted values.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: 'End the session. Your last submitted spec becomes the final artifact.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

function systemPrompt(profile: ArtistStyleProfile, maxToolCalls: number): string {
  return `You are an artist-engineer authoring a screensaver in SaverSpec v1 as ${profile.artist} (${profile.movement}).

A SaverSpec is DATA — a background plus layers of moving sprites — compiled into a seeded, deterministic, flash-safe saver. There is no code in a spec: no scripting, no network, no DOM.

## Tools
- submit_spec: submit a candidate spec. Validation errors come back as the result — fix and resubmit.
- perceive: SEE the current candidate (braille luminance map + coverage/luminance/balance/advisories).
- score: grade the current candidate against the style and benchmark rubrics (failing checks, measured vs wanted).
- finish: end the session; your last submitted spec is the final artifact.

## Budget
You have at most ${maxToolCalls} tool calls (finish is free). A good rhythm: submit v1 early → perceive → score → fix the worst failing check → resubmit → finish. Do not narrate your plans; call tools.

## SaverSpec v1 format
${FORMAT_MD}`;
}

function rubricLines(c: BenchmarkIntent['checks']): string[] {
  const out: string[] = [];
  if (c.minLayers != null) out.push(`layer count ≥ ${c.minLayers}`);
  if (c.maxLayers != null) out.push(`layer count ≤ ${c.maxLayers}`);
  if (c.minCoverage != null) out.push(`coverage ≥ ${(c.minCoverage * 100).toFixed(1)}%`);
  if (c.maxCoverage != null) out.push(`coverage ≤ ${(c.maxCoverage * 100).toFixed(1)}%`);
  if (c.requirePulse) out.push('at least one layer must pulse');
  if (c.requireSpeedSeparation) out.push('clear speed separation between layers (≥ 1.6×)');
  if (c.requireFocalDominance) out.push('one dominant focal mass (top layer share ≥ 28%)');
  return out;
}

function userPrompt(
  screen: EvalScreen,
  profile: ArtistStyleProfile,
  benchmark: BenchmarkIntent | null,
): string {
  const p = profile;
  const lines = [
    `## StyleDNA — ${p.artist} (${p.movement}, ${p.years})`,
    `Thesis: ${p.research.thesis}`,
    '',
    'Principles:',
    ...p.research.visualPrinciples.map((x) => `• ${x}`),
    '',
    'Anti-patterns (do NOT do these):',
    ...p.research.antiPatterns.map((x) => `• ${x}`),
    '',
    `Tempo: ${p.research.tempo} · Depth: ${p.research.depth}`,
    `Palette accents: ${p.palette.accents.join(', ')}`,
    `Sprites: ${p.markMaking.primarySprites.join(', ')} · Blend: ${p.markMaking.blend} · Soft glow: ${p.markMaking.softGlow}`,
    `Motions: ${p.motionDialect.preferred.join(', ')} · Speed scale ×${p.motionDialect.speedScale}`,
    `Density ×${p.composition.densityScale} · Layers ≈ ${p.composition.layerCountHint}`,
  ];
  if (benchmark) {
    lines.push(
      '',
      `## Benchmark — ${benchmark.title}`,
      benchmark.intent,
      '',
      '## Rubric (what score() checks)',
      ...rubricLines(benchmark.checks).map((x) => `• ${x}`),
    );
  } else {
    lines.push('', `## Signature piece — ${screen.title}`, screen.intent);
  }
  lines.push('', 'Author the screen now. Begin by calling submit_spec with your first draft.');
  return lines.join('\n');
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (err instanceof DOMException && err.name === 'AbortError')
  );
}

export async function runAgentScreen(opts: RunAgentScreenOptions): Promise<AgentScreenArtifact> {
  const { screen, profile, benchmark, model, maxToolCalls, chat, onEvent, signal } = opts;
  const startedAt = new Date().toISOString();
  const prompt = {
    system: systemPrompt(profile, maxToolCalls),
    user: userPrompt(screen, profile, benchmark),
  };
  const messages: ChatMessage[] = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];
  const trajectory: ChatMessage[] = [...messages];
  const versions: AgentSpecVersion[] = [];
  let candidate: SaverSpec | null = null;
  let outcome: AgentScreenArtifact['outcome'] | null = null;
  let error: string | undefined;
  let callsUsed = 0;

  const execTool = (name: string, argsJson: string): { result: string; ok: boolean; summary: string } => {
    if (name === 'finish') return { result: '{"ok":true}', ok: true, summary: 'finish' };
    if (name === 'submit_spec') {
      let spec: unknown;
      try {
        spec = (JSON.parse(argsJson) as { spec?: unknown }).spec;
      } catch {
        return { result: '{"ok":false,"error":"arguments were not valid JSON"}', ok: false, summary: 'bad JSON' };
      }
      const validation = validateSpec(spec);
      if (!validation.valid) {
        const errors = validation.errors.map((e) => `${e.path}: ${e.message}`);
        return {
          result: JSON.stringify({ ok: false, errors }),
          ok: false,
          summary: `invalid — ${errors[0] ?? 'validation failed'}`,
        };
      }
      candidate = spec as SaverSpec;
      const scored = scoreScreen({ ...screen, spec: candidate }, profile);
      const version: AgentSpecVersion = { n: versions.length + 1, spec: candidate, score: scored };
      versions.push(version);
      onEvent?.({ type: 'version', n: version.n, score: scored.score });
      const advisories = adviseSpec(candidate, DEFAULT_VIEWPORT).map((a) => `${a.code}: ${a.message}`);
      return {
        result: JSON.stringify({
          ok: true,
          version: version.n,
          advisoryCount: advisories.length,
          advisories: advisories.slice(0, 6),
          next: 'call perceive to see it, score to grade it, or finish to end',
        }),
        ok: true,
        summary: `v${version.n} accepted · score ${scored.score.toFixed(3)}`,
      };
    }
    if (name === 'perceive') {
      if (!candidate) {
        return { result: '{"ok":false,"error":"no candidate yet — submit_spec first"}', ok: false, summary: 'no candidate' };
      }
      const p = perceiveScene(candidate, { viewport: DEFAULT_VIEWPORT, t: SAMPLE_T, seed: candidate.seed });
      return {
        result: JSON.stringify({
          ok: true,
          braille: p.braille,
          coverage: p.coverage,
          meanLuminance: p.meanLuminance,
          centroid: p.centroid,
          dominance: p.dominance.slice(0, 3),
          advisories: p.advisories.map((a) => `${a.code}: ${a.message}`).slice(0, 6),
        }),
        ok: true,
        summary: `coverage ${(p.coverage * 100).toFixed(1)}% · luminance ${p.meanLuminance.toFixed(2)}`,
      };
    }
    if (name === 'score') {
      if (!candidate) {
        return { result: '{"ok":false,"error":"no candidate yet — submit_spec first"}', ok: false, summary: 'no candidate' };
      }
      const sc = versions[versions.length - 1]!.score;
      const intentTerms = explainIntentFit({ ...screen, spec: candidate }, candidate, sc.perception);
      return {
        result: JSON.stringify({
          ok: true,
          score: sc.score,
          styleFit: sc.styleFit,
          intentFit: sc.intentFit,
          perceptionOk: sc.perceptionOk,
          advisoryPenalty: sc.advisoryPenalty,
          notes: sc.notes,
          rubric: intentTerms.map((t) => ({
            check: t.label,
            value: t.value,
            actual: t.actual,
            expected: t.expected,
          })),
        }),
        ok: true,
        summary: `score ${sc.score.toFixed(3)} (style ${sc.styleFit.toFixed(2)} · intent ${sc.intentFit.toFixed(2)})`,
      };
    }
    return { result: `{"ok":false,"error":"unknown tool ${name}"}`, ok: false, summary: 'unknown tool' };
  };

  // Chat rounds are capped too — a model that talks instead of calling tools
  // must not spin forever on the user's dime.
  const maxRounds = maxToolCalls * 2 + 6;
  let rounds = 0;

  while (!outcome && rounds < maxRounds) {
    if (signal?.aborted) {
      outcome = 'aborted';
      break;
    }
    rounds++;
    let res: ChatResponse;
    try {
      res = await chat({ model, messages, tools: TOOLS, signal });
    } catch (err) {
      if (isAbort(err, signal)) outcome = 'aborted';
      else {
        outcome = 'error';
        error = err instanceof Error ? err.message : String(err);
      }
      break;
    }
    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content: res.content,
      ...(res.toolCalls.length ? { tool_calls: res.toolCalls } : {}),
    };
    messages.push(assistantMsg);
    trajectory.push(assistantMsg);
    if (res.content) onEvent?.({ type: 'assistant', text: res.content.slice(0, 500) });

    if (!res.toolCalls.length) {
      const nudge: ChatMessage = {
        role: 'user',
        content: 'Continue with tools (submit_spec / perceive / score), or call finish to end.',
      };
      messages.push(nudge);
      trajectory.push(nudge);
      continue;
    }

    for (const call of res.toolCalls) {
      const name = call.function.name;
      if (name !== 'finish') callsUsed++;
      const { result, ok, summary } = execTool(name, call.function.arguments);
      const toolMsg: ChatMessage = { role: 'tool', tool_call_id: call.id, content: result };
      messages.push(toolMsg);
      trajectory.push(toolMsg);
      onEvent?.({ type: 'tool', name, ok, summary });
      if (name === 'finish') {
        outcome = 'finished';
        break;
      }
      if (callsUsed >= maxToolCalls) {
        outcome = 'max-calls';
        break;
      }
    }
  }
  if (!outcome) outcome = 'max-calls';

  return {
    screenId: screen.id,
    artistId: screen.artistId,
    benchmarkId: benchmark?.id ?? screen.screenId,
    model,
    maxToolCalls,
    toolCallsUsed: callsUsed,
    startedAt,
    finishedAt: new Date().toISOString(),
    prompt,
    trajectory,
    versions,
    initial: versions[0] ?? null,
    final: versions[versions.length - 1] ?? null,
    outcome,
    ...(error ? { error } : {}),
  };
}
