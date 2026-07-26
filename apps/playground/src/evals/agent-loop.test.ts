import { describe, expect, it } from 'vitest';
import type { SaverSpec } from '@idle-screens/schema';
import { getCatalog } from './catalog';
import { BENCHMARK_INTENTS } from './benchmarks';
import { runAgentScreen, type AgentEvent, type ChatTransport } from './agent-loop';
import type { ChatResponse, ChatToolCall } from './openrouter';

const catalog = getCatalog();
const screen = catalog.screens.find((s) => s.kind === 'benchmark')!;
const profile = catalog.artists.find((a) => a.id === screen.artistId)!;
const benchmark = BENCHMARK_INTENTS.find((b) => b.id === screen.screenId)!;

const VALID_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'agent-test',
  label: 'Agent test',
  seed: 7,
  background: {
    type: 'gradient',
    stops: [
      { at: 0, color: '#0a1628' },
      { at: 1, color: '#121212' },
    ],
  },
  layers: [
    {
      count: 40,
      sprite: { kind: 'circle', radius: [0.001, 0.003], color: '#8899aa' },
      motion: { type: 'drift', angle: 90, speed: [0.01, 0.04], bob: 0.003 },
    },
    {
      count: 20,
      sprite: { kind: 'circle', radius: [0.002, 0.005], color: '#c0cdd8' },
      motion: { type: 'drift', angle: 85, speed: [0.03, 0.08], bob: 0.006 },
    },
  ],
};

let callSeq = 0;
function tc(name: string, args: unknown): ChatToolCall {
  return {
    id: `call_${++callSeq}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

/** Scripted transport: plays back responses in order, records requests. */
function fakeChat(script: ChatResponse[]): { chat: ChatTransport; requests: unknown[] } {
  const requests: unknown[] = [];
  let i = 0;
  return {
    requests,
    chat: async (req) => {
      requests.push(req);
      const res = script[Math.min(i, script.length - 1)]!;
      i++;
      return res;
    },
  };
}

describe('runAgentScreen', () => {
  it('happy path: invalid → valid → perceive → score → finish', async () => {
    const events: AgentEvent[] = [];
    const { chat, requests } = fakeChat([
      { content: null, toolCalls: [tc('submit_spec', { spec: { schemaVersion: 1 } })] },
      { content: null, toolCalls: [tc('submit_spec', { spec: VALID_SPEC })] },
      { content: null, toolCalls: [tc('perceive', {})] },
      { content: null, toolCalls: [tc('score', {})] },
      { content: null, toolCalls: [tc('finish', {})] },
    ]);
    const art = await runAgentScreen({
      screen, profile, benchmark, model: 'test/model', maxToolCalls: 20,
      chat, onEvent: (e) => events.push(e),
    });

    expect(art.outcome).toBe('finished');
    expect(art.toolCallsUsed).toBe(4); // finish is free
    expect(art.versions).toHaveLength(1); // invalid spec never versions
    expect(art.initial).not.toBeNull();
    expect(art.final).toBe(art.initial);
    expect(art.final!.score.score).toBeGreaterThan(0);
    expect(art.prompt.system).toContain('SaverSpec');
    expect(art.prompt.user).toContain(profile.artist);
    // The invalid submission's errors went back as a tool result.
    const errResult = art.trajectory.find(
      (m) => m.role === 'tool' && m.content?.includes('"ok":false'),
    );
    expect(errResult).toBeDefined();
    // Every model round-trip carried the tool definitions.
    expect(requests).toHaveLength(5);
    expect(events.some((e) => e.type === 'version' && e.n === 1)).toBe(true);
  });

  it('refinement: two valid submissions version in order, final is last', async () => {
    const weak: SaverSpec = { ...VALID_SPEC, layers: [VALID_SPEC.layers[0]!] };
    const { chat } = fakeChat([
      { content: null, toolCalls: [tc('submit_spec', { spec: weak })] },
      { content: null, toolCalls: [tc('submit_spec', { spec: VALID_SPEC })] },
      { content: null, toolCalls: [tc('finish', {})] },
    ]);
    const art = await runAgentScreen({
      screen, profile, benchmark, model: 'test/model', maxToolCalls: 20, chat,
    });
    expect(art.versions.map((v) => v.n)).toEqual([1, 2]);
    expect(art.initial!.spec.layers).toHaveLength(1);
    expect(art.final!.spec.layers).toHaveLength(2);
  });

  it('cuts off at exactly maxToolCalls', async () => {
    const { chat } = fakeChat([
      { content: null, toolCalls: [tc('submit_spec', { spec: VALID_SPEC })] },
      { content: null, toolCalls: [tc('perceive', {})] },
    ]);
    const art = await runAgentScreen({
      screen, profile, benchmark, model: 'test/model', maxToolCalls: 3, chat,
    });
    expect(art.outcome).toBe('max-calls');
    expect(art.toolCallsUsed).toBe(3);
  });

  it('aborts before the first call when the signal is already aborted', async () => {
    const { chat, requests } = fakeChat([]);
    const ctrl = new AbortController();
    ctrl.abort();
    const art = await runAgentScreen({
      screen, profile, benchmark, model: 'test/model', maxToolCalls: 20,
      chat, signal: ctrl.signal,
    });
    expect(art.outcome).toBe('aborted');
    expect(requests).toHaveLength(0);
  });

  it('maps an AbortError from the transport to outcome aborted', async () => {
    const chat: ChatTransport = () =>
      Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    const art = await runAgentScreen({
      screen, profile, benchmark, model: 'test/model', maxToolCalls: 20, chat,
    });
    expect(art.outcome).toBe('aborted');
  });

  it('records transport errors without throwing', async () => {
    const chat: ChatTransport = () => Promise.reject(new Error('HTTP 500'));
    const art = await runAgentScreen({
      screen, profile, benchmark, model: 'test/model', maxToolCalls: 20, chat,
    });
    expect(art.outcome).toBe('error');
    expect(art.error).toBe('HTTP 500');
  });

  it('a model that finishes without submitting has null artifacts', async () => {
    const { chat } = fakeChat([{ content: 'done', toolCalls: [tc('finish', {})] }]);
    const art = await runAgentScreen({
      screen, profile, benchmark, model: 'test/model', maxToolCalls: 20, chat,
    });
    expect(art.outcome).toBe('finished');
    expect(art.initial).toBeNull();
    expect(art.final).toBeNull();
  });

  it('a talk-only model is nudged, then stopped at the round cap', async () => {
    const { chat } = fakeChat([{ content: 'let me think…', toolCalls: [] }]);
    const art = await runAgentScreen({
      screen, profile, benchmark, model: 'test/model', maxToolCalls: 2, chat,
    });
    expect(art.outcome).toBe('max-calls');
    expect(art.trajectory.some((m) => m.role === 'user' && m.content?.includes('Continue with tools'))).toBe(true);
  });
});
