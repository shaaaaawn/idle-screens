import { describe, expect, it } from 'vitest';
import type { SaverSpec } from '@idle-screens/schema';
import { getCatalog } from './catalog';
import { BENCHMARK_INTENTS } from './benchmarks';
import { runAgentBatch, trainingJsonl, sftJsonl, repairJsonl } from './agent-run';
import type { ChatTransport } from './agent-loop';
import type { ChatResponse, ChatToolCall } from './openrouter';

const catalog = getCatalog();
const screen = catalog.screens.find((s) => s.id === 'monet--benchmark--calm-horizon')!;
const profile = catalog.artists.find((a) => a.id === screen.artistId)!;
const benchmark = BENCHMARK_INTENTS.find((b) => b.id === screen.screenId)!;

const VALID_SPEC: SaverSpec = {
  schemaVersion: 1,
  id: 'run-test',
  label: 'Run test',
  seed: 3,
  background: { type: 'solid', color: '#101820' },
  layers: [
    {
      count: 30,
      sprite: { kind: 'circle', radius: [0.002, 0.005], color: '#9fb3c8' },
      motion: { type: 'drift', angle: 90, speed: [0.01, 0.04], bob: 0.004 },
    },
  ],
};

let seq = 0;
const tc = (name: string, args: unknown): ChatToolCall => ({
  id: `call_${++seq}`,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});

/** Replays one script per screen run, restarting for each trial. */
function scriptedChat(script: ChatResponse[]): ChatTransport {
  let i = 0;
  return async () => {
    const res = script[i % script.length]!;
    i++;
    return res;
  };
}

const targets = [{ screen, profile, benchmark }];

describe('runAgentBatch', () => {
  it('runs each target once per trial and stamps the trial index', async () => {
    const chat = scriptedChat([
      { content: null, toolCalls: [tc('submit_spec', { spec: VALID_SPEC })] },
      { content: null, toolCalls: [tc('finish', {})] },
    ]);
    const run = await runAgentBatch({
      runId: 'run-trials',
      model: 'test/model',
      maxToolCalls: 10,
      trials: 3,
      targets,
      profiles: catalog.artists,
      chat,
    });
    expect(run.trials).toBe(3);
    expect(run.artifacts).toHaveLength(3);
    expect(run.artifacts.map((a) => a.trial)).toEqual([0, 1, 2]);
    expect(run.evalId).toBe('style-authoring-v1');
  });

  it('defaults to a single trial', async () => {
    const chat = scriptedChat([{ content: null, toolCalls: [tc('finish', {})] }]);
    const run = await runAgentBatch({
      runId: 'run-default',
      model: 'test/model',
      maxToolCalls: 10,
      targets,
      profiles: catalog.artists,
      chat,
    });
    expect(run.trials).toBe(1);
    expect(run.artifacts).toHaveLength(1);
  });
});

describe('exports', () => {
  /** One rejected submission, then one accepted — the shape worth exporting. */
  async function runWithRepair() {
    const chat = scriptedChat([
      { content: null, toolCalls: [tc('submit_spec', { spec: { schemaVersion: 1 } })] },
      { content: null, toolCalls: [tc('submit_spec', { spec: VALID_SPEC })] },
      { content: null, toolCalls: [tc('finish', {})] },
    ]);
    return runAgentBatch({
      runId: 'run-export',
      model: 'test/model',
      maxToolCalls: 10,
      operator: 'a-human-name',
      targets,
      profiles: catalog.artists,
      chat,
    });
  }

  it('trainingJsonl keeps every version with its full score breakdown', async () => {
    const run = await runWithRepair();
    const rows = trainingJsonl(run).split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.recordVersion).toBe(1);
    expect(row.evalId).toBe('style-authoring-v1');
    expect(row.runId).toBe('run-export');

    // The parts, not just the composite — a composite can be recomputed from
    // its terms, never the other way round.
    const versions = row.versions as Array<{ score: Record<string, unknown> }>;
    expect(versions).toHaveLength(1);
    const score = versions[0]!.score;
    for (const key of ['perception', 'styleFit', 'intentFit', 'perceptionOk', 'advisoryPenalty', 'notes']) {
      expect(score).toHaveProperty(key);
    }
  });

  it('trainingJsonl carries the negatives', async () => {
    const run = await runWithRepair();
    const row = JSON.parse(trainingJsonl(run)) as { rejections: unknown[] };
    expect(row.rejections).toHaveLength(1);
  });

  it('a training row is readable without its parent run', async () => {
    const run = await runWithRepair();
    const row = JSON.parse(trainingJsonl(run)) as Record<string, unknown>;
    for (const key of ['recordVersion', 'evalId', 'runId', 'createdAt', 'harness', 'provenance']) {
      expect(row[key]).toBeDefined();
    }
    expect((row.provenance as Record<string, unknown>).styleDnaHash).toBeTruthy();
  });

  it('sftJsonl completes from best, not from final', async () => {
    // v2 regresses; SFT must not learn the regression as the answer.
    const weak: SaverSpec = {
      ...VALID_SPEC,
      layers: [{ ...VALID_SPEC.layers[0]!, count: 1 }],
    };
    const chat = scriptedChat([
      { content: null, toolCalls: [tc('submit_spec', { spec: VALID_SPEC })] },
      { content: null, toolCalls: [tc('submit_spec', { spec: weak })] },
      { content: null, toolCalls: [tc('finish', {})] },
    ]);
    const run = await runAgentBatch({
      runId: 'run-sft',
      model: 'test/model',
      maxToolCalls: 10,
      targets,
      profiles: catalog.artists,
      chat,
    });
    const artifact = run.artifacts[0]!;
    expect(artifact.final!.n).toBe(2);
    expect(artifact.best!.n).toBe(1);
    const row = JSON.parse(sftJsonl(run)) as { score: number };
    expect(row.score).toBe(artifact.best!.score.score);
    expect(row.score).not.toBe(artifact.final!.score.score);
  });

  it('repairJsonl pairs each rejection with the spec that fixed it', async () => {
    const run = await runWithRepair();
    const row = JSON.parse(repairJsonl(run)) as {
      rejected: unknown;
      validationErrors: string[];
      corrected: unknown;
    };
    expect(row.validationErrors.length).toBeGreaterThan(0);
    expect(row.rejected).toBeDefined();
    expect(row.corrected).not.toBeNull();
  });

  it('repairJsonl is empty when nothing was rejected', async () => {
    const chat = scriptedChat([
      { content: null, toolCalls: [tc('submit_spec', { spec: VALID_SPEC })] },
      { content: null, toolCalls: [tc('finish', {})] },
    ]);
    const run = await runAgentBatch({
      runId: 'run-clean',
      model: 'test/model',
      maxToolCalls: 10,
      targets,
      profiles: catalog.artists,
      chat,
    });
    expect(repairJsonl(run)).toBe('');
  });
});
