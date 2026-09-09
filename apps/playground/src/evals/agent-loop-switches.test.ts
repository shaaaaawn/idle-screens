/**
 * The agent loop's two experiment switches (mono
 * `docs/training-a-saverspec-author.md` TR1 allowlist, TR2 honest baseline).
 * Both default to the historical behaviour, so the first block is a
 * regression guard: with no switches set, nothing about the tools or the
 * prompt may change.
 */
import { describe, expect, it } from 'vitest';
import type { SaverSpec } from '@idle-screens/schema';
import specSchemaJson from '../../../../packages/schema/saver-spec.schema.json';
import { getCatalog } from './catalog';
import { BENCHMARK_INTENTS } from './benchmarks';
import {
  ALL_AGENT_TOOLS,
  buildAgentPrompt,
  resolveAgentTools,
  runAgentScreen,
  type ChatTransport,
} from './agent-loop';
import { runAgentBatch, trainingJsonl } from './agent-run';
import { buildSchemaAllowlist, listAllowlistFields } from './schema-allowlist';
import type { ChatRequest, ChatResponse, ChatToolCall } from './openrouter';

const catalog = getCatalog();
const screen = catalog.screens.find((s) => s.kind === 'benchmark')!;
const profile = catalog.artists.find((a) => a.id === screen.artistId)!;
const benchmark = BENCHMARK_INTENTS.find((b) => b.id === screen.screenId)!;

const FORMAT_HEADING = '# SaverSpec — Format Specification (version 1)';

const VALID_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'switch-test',
  label: 'Switch test',
  seed: 7,
  background: { type: 'solid', color: '#0a1628' },
  layers: [
    {
      count: 40,
      sprite: { kind: 'circle', radius: [0.001, 0.003], color: '#8899aa' },
      motion: { type: 'drift', angle: 90, speed: [0.01, 0.04] },
    },
  ],
};

let callSeq = 0;
function tc(name: string, args: unknown): ChatToolCall {
  return { id: `call_${++callSeq}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function fakeChat(script: ChatResponse[]): { chat: ChatTransport; requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  let i = 0;
  return {
    requests,
    chat: async (req) => {
      requests.push(req);
      return script[Math.min(i++, script.length - 1)]!;
    },
  };
}

const toolNames = (req: ChatRequest): string[] => (req.tools ?? []).map((t) => t.function.name);

/** The prompt above the format reference — FORMAT.md itself mentions `perceiveScene`. */
const head = (system: string): string => system.split('## SaverSpec v1 format')[0]!;

// ---------------------------------------------------------------------------
// an independent walker over the raw JSON schema, so the allowlist's field
// list is checked against the file and not against the resolver that made it

type Json = Record<string, any>;
const RAW = specSchemaJson as Json;

function deref(node: Json): Json {
  let n = node;
  while (typeof n.$ref === 'string') {
    n = n.$ref
      .replace(/^#\//, '')
      .split('/')
      .reduce((acc: Json, seg: string) => acc[seg], RAW);
  }
  return n;
}

/** Every node one segment deeper — a `oneOf` can hold the same name with different shapes. */
function descend(node: Json, seg: string): Json[] {
  const n = deref(node);
  const out: Json[] = [];
  if (n.properties?.[seg]) out.push(n.properties[seg]);
  if (n.type === 'array' && n.items) out.push(...descend(n.items, seg));
  for (const v of n.oneOf ?? n.anyOf ?? []) out.push(...descend(v, seg));
  return out;
}

/** `sprite[kind=circle].radius` → does the raw schema really have it? */
function schemaHas(path: string): boolean {
  const [first, ...rest] = path.split('.');
  const m = /^(\w+)(?:\[(\w+)=(\w+)\])?$/.exec(first ?? '');
  if (!m) return false;
  let nodes: Json[] = [RAW.definitions[m[1]!]].filter(Boolean);
  if (m[2]) {
    nodes = nodes.flatMap((n) =>
      (n.oneOf ?? n.anyOf ?? []).filter((v: Json) => deref(v).properties?.[m[2]!]?.const === m[3]),
    );
  }
  for (const seg of rest) nodes = nodes.flatMap((n) => descend(n, seg));
  return nodes.length > 0;
}

// ---------------------------------------------------------------------------

describe('agent-loop switches: defaults are the historical behaviour', () => {
  it('sends all four tools and the full FORMAT.md prompt', async () => {
    const { chat, requests } = fakeChat([{ content: null, toolCalls: [tc('finish', {})] }]);
    const art = await runAgentScreen({ screen, profile, benchmark, model: 'test/model', maxToolCalls: 8, chat });

    expect(toolNames(requests[0]!)).toEqual(['submit_spec', 'perceive', 'score', 'finish']);
    expect(art.tools).toEqual([...ALL_AGENT_TOOLS]);
    expect(art.schemaMode).toBe('full');
    expect(art.prompt.system).toContain(FORMAT_HEADING);
    expect(art.prompt.system).toContain('- score: grade the current candidate');
    expect(art.prompt.system).toContain(
      'A good rhythm: submit v1 early → perceive → score → fix the worst failing check → resubmit → finish.',
    );
    expect(art.prompt.user).toContain('## Rubric (what score() checks)');
  });

  it('buildAgentPrompt with no switches equals the prompt the loop sends', async () => {
    const { chat } = fakeChat([{ content: null, toolCalls: [tc('finish', {})] }]);
    const art = await runAgentScreen({ screen, profile, benchmark, model: 'test/model', maxToolCalls: 8, chat });
    expect(buildAgentPrompt(screen, profile, benchmark, 8)).toEqual(art.prompt);
  });

  it('keeps the historical nudge and submit hint wording', async () => {
    const { chat } = fakeChat([
      { content: 'thinking…', toolCalls: [] },
      { content: null, toolCalls: [tc('submit_spec', { spec: VALID_SPEC })] },
      { content: null, toolCalls: [tc('finish', {})] },
    ]);
    const art = await runAgentScreen({ screen, profile, benchmark, model: 'test/model', maxToolCalls: 8, chat });
    const nudge = art.trajectory.find((m) => m.role === 'user' && m.content?.startsWith('Continue with tools'));
    expect(nudge?.content).toBe('Continue with tools (submit_spec / perceive / score), or call finish to end.');
    const accepted = art.trajectory.find((m) => m.role === 'tool' && m.content?.includes('"version":1'));
    expect(accepted?.content).toContain('call perceive to see it, score to grade it, or finish to end');
  });
});

describe('agent-loop switches: tools (TR2 honest baseline)', () => {
  const tools = ['submit_spec', 'perceive', 'finish'] as const;

  it('drops score from the tool list, the prompt and the rubric heading', async () => {
    const { chat, requests } = fakeChat([{ content: null, toolCalls: [tc('finish', {})] }]);
    const art = await runAgentScreen({
      screen, profile, benchmark, model: 'test/model', maxToolCalls: 8, chat, tools,
    });

    expect(toolNames(requests[0]!)).toEqual(['submit_spec', 'perceive', 'finish']);
    expect(art.tools).toEqual([...tools]);
    expect(head(art.prompt.system)).not.toMatch(/\bscore\b/);
    expect(art.prompt.system).toContain('A good rhythm: submit v1 early → perceive → fix what you see → resubmit → finish.');
    expect(art.prompt.user).toContain('## Rubric\n');
    expect(art.prompt.user).not.toContain('score()');
    // The rubric lines themselves stay — they are the brief.
    expect(art.prompt.user).toContain('coverage');
    // FORMAT.md is untouched by the tools switch.
    expect(art.prompt.system).toContain(FORMAT_HEADING);
  });

  it('a model that calls score anyway gets the unknown-tool result, and scores are still computed locally', async () => {
    const { chat } = fakeChat([
      { content: null, toolCalls: [tc('submit_spec', { spec: VALID_SPEC })] },
      { content: null, toolCalls: [tc('score', {})] },
      { content: null, toolCalls: [tc('finish', {})] },
    ]);
    const art = await runAgentScreen({
      screen, profile, benchmark, model: 'test/model', maxToolCalls: 8, chat, tools,
    });
    const scoreResult = art.trajectory.find((m) => m.role === 'tool' && m.content?.includes('unknown tool score'));
    expect(scoreResult).toBeDefined();
    expect(scoreResult!.content).toBe('{"ok":false,"error":"unknown tool score"}');
    expect(art.versions[0]!.score.score).toBeGreaterThan(0);
    // The nudge and the submit hint only name tools that exist.
    const accepted = art.trajectory.find((m) => m.role === 'tool' && m.content?.includes('"version":1'));
    expect(accepted?.content).toContain('call perceive to see it, or finish to end');
    expect(accepted?.content).not.toContain('grade');
  });

  it('submit + finish only: the nudge and hint name nothing that is gone', async () => {
    const { chat, requests } = fakeChat([
      { content: 'hmm', toolCalls: [] },
      { content: null, toolCalls: [tc('submit_spec', { spec: VALID_SPEC })] },
      { content: null, toolCalls: [tc('finish', {})] },
    ]);
    const art = await runAgentScreen({
      screen, profile, benchmark, model: 'test/model', maxToolCalls: 8, chat, tools: ['submit_spec', 'finish'],
    });
    expect(toolNames(requests[0]!)).toEqual(['submit_spec', 'finish']);
    expect(art.prompt.system).toContain('A good rhythm: submit v1 early → refine → resubmit → finish.');
    expect(head(art.prompt.system)).not.toMatch(/\b(perceive|score)\b/);
    const nudge = art.trajectory.find((m) => m.role === 'user' && m.content?.startsWith('Continue with tools'));
    expect(nudge?.content).toBe('Continue with tools (submit_spec), or call finish to end.');
    const accepted = art.trajectory.find((m) => m.role === 'tool' && m.content?.includes('"version":1'));
    expect(accepted?.content).toContain('resubmit to refine, or call finish to end');
  });

  it('throws when submit_spec or finish is missing, or a tool is unknown', async () => {
    expect(() => resolveAgentTools(['perceive', 'finish'])).toThrow(/submit_spec/);
    expect(() => resolveAgentTools(['submit_spec', 'score'])).toThrow(/finish/);
    expect(() => resolveAgentTools([])).toThrow(/submit_spec/);
    expect(() => resolveAgentTools(['submit_spec', 'finish', 'grade' as never])).toThrow(/unknown tool "grade"/);
    expect(() => buildAgentPrompt(screen, profile, benchmark, 8, { tools: ['finish'] })).toThrow(/submit_spec/);
    const { chat, requests } = fakeChat([]);
    await expect(
      runAgentBatch({
        runId: 'r', model: 'test/model', maxToolCalls: 8, tools: ['perceive', 'finish'],
        targets: [{ screen, profile, benchmark }], profiles: catalog.artists, chat,
      }),
    ).rejects.toThrow(/submit_spec/);
    // It failed before spending a single call.
    expect(requests).toHaveLength(0);
  });
});

describe('agent-loop switches: schemaMode allowlist (TR1)', () => {
  it('shrinks the system prompt to under a quarter and names the style\'s sprites and motions', () => {
    const full = buildAgentPrompt(screen, profile, benchmark, 8).system;
    const slim = buildAgentPrompt(screen, profile, benchmark, 8, { schemaMode: 'allowlist' }).system;

    expect(slim.length).toBeLessThan(full.length * 0.25);
    expect(slim).not.toContain(FORMAT_HEADING);
    expect(slim).toContain('## SaverSpec v1 format');
    for (const kind of [...profile.markMaking.primarySprites, 'circle']) expect(slim).toContain(`#### ${kind}`);
    for (const type of [...profile.motionDialect.preferred, 'drift']) expect(slim).toContain(`#### ${type}`);
    expect(slim).toContain('Anything not listed here is still valid SaverSpec');
    // Tools are untouched by the schema switch.
    expect(slim).toContain('- score: grade the current candidate');
  });

  it('every field the allowlist mentions exists in saver-spec.schema.json, for every profile', () => {
    for (const p of catalog.artists) {
      for (const b of [benchmark, null]) {
        const fields = listAllowlistFields(p, b);
        expect(fields.length).toBeGreaterThan(40);
        const missing = fields.filter((f) => !schemaHas(f));
        expect(missing, `${p.id}: ${missing.join(', ')}`).toEqual([]);
        // The markdown really talks about those fields (spot-check the kinds).
        const md = buildSchemaAllowlist(p, b);
        for (const kind of p.markMaking.primarySprites) expect(md).toContain(`#### ${kind}`);
        for (const type of p.motionDialect.preferred) expect(md).toContain(`#### ${type}`);
        expect(md.split('\n').length).toBeLessThanOrEqual(150);
      }
    }
  });

  it('is schema-derived: ranges and enums come from the JSON, not prose', () => {
    const md = buildSchemaAllowlist(profile, benchmark);
    const layers = RAW.definitions.saverSpec.properties.layers;
    expect(md).toContain(`layers: layer[] (${layers.minItems}..${layers.maxItems})`);
    const blend = RAW.definitions.layer.properties.blend.enum as string[];
    expect(md).toContain(`blend?: ${blend.map((b) => JSON.stringify(b)).join(' | ')}`);
    const count = RAW.definitions.layer.properties.count;
    expect(md).toContain(`count: integer ${count.minimum}..${count.maximum}`);
    // A benchmark maps its checks onto real fields; a signature screen has no such section.
    expect(md).toContain('Where the benchmark rubric looks');
    expect(buildSchemaAllowlist(profile, null)).not.toContain('Where the benchmark rubric looks');
  });

  it('is recorded on the artifact, the run and the training export', async () => {
    const { chat } = fakeChat([
      { content: null, toolCalls: [tc('submit_spec', { spec: VALID_SPEC })] },
      { content: null, toolCalls: [tc('finish', {})] },
    ]);
    const run = await runAgentBatch({
      runId: 'switches', model: 'test/model', maxToolCalls: 8,
      tools: ['submit_spec', 'finish'], schemaMode: 'allowlist',
      targets: [{ screen, profile, benchmark }], profiles: catalog.artists, chat,
    });
    expect(run.tools).toEqual(['submit_spec', 'finish']);
    expect(run.schemaMode).toBe('allowlist');
    const [art] = run.artifacts;
    expect(art!.tools).toEqual(['submit_spec', 'finish']);
    expect(art!.schemaMode).toBe('allowlist');
    expect(art!.prompt.system).not.toContain(FORMAT_HEADING);
    const row = JSON.parse(trainingJsonl(run)) as { provenance: { tools: string[]; schemaMode: string } };
    expect(row.provenance.tools).toEqual(['submit_spec', 'finish']);
    expect(row.provenance.schemaMode).toBe('allowlist');
  });

  it('an artifact recorded before the switches existed exports as the defaults', () => {
    const run = {
      runId: 'old', createdAt: 'x', evalId: 'style-authoring-v1' as const, model: 'm', maxToolCalls: 8, trials: 1,
      styleDnaHash: 'h',
      artifacts: [{
        screenId: screen.id, artistId: screen.artistId, benchmarkId: benchmark.id, model: 'm', trial: 0,
        maxToolCalls: 8, toolCallsUsed: 0, startedAt: 'x', finishedAt: 'x', prompt: { system: '', user: '' },
        trajectory: [], versions: [], rejections: [], initial: null, final: null, best: null, outcome: 'finished' as const,
      }],
    };
    const row = JSON.parse(trainingJsonl(run)) as { provenance: { tools: string[]; schemaMode: string } };
    expect(row.provenance.tools).toEqual([...ALL_AGENT_TOOLS]);
    expect(row.provenance.schemaMode).toBe('full');
  });
});
