import { describe, expect, it } from 'vitest';
import type { SaverSpec } from '@idle-screens/schema';
import { bridgeAgentRunToTimeline } from './agent-bridge';
import type { AgentRun } from './agent-run';
import { getCatalog } from './catalog';

const tinySpec = (): SaverSpec => ({
  schemaVersion: 1,
  id: 'tmp',
  label: 'tmp',
  seed: 1,
  motionIntensity: 'calm',
  background: { type: 'solid', color: '#102030' },
  layers: [
    {
      count: 20,
      sprite: { kind: 'circle', radius: [0.002, 0.006], color: '#c8d8e8', soft: true },
      alpha: [0.4, 0.9],
      motion: { type: 'drift', speed: [0.001, 0.003], bob: 0.002 },
    },
  ],
});

describe('bridgeAgentRunToTimeline', () => {
  const catalog = getCatalog();

  it('turns agent finals into authored screens + timeline summary', () => {
    const screen = catalog.screens.find((s) => s.id === 'monet--benchmark--calm-horizon')!;
    const agent: AgentRun = {
      runId: 'run-test-agent',
      createdAt: new Date().toISOString(),
      model: 'test/model',
      maxToolCalls: 10,
      styleDnaHash: 'deadbeef',
      artifacts: [
        {
          screenId: screen.id,
          artistId: screen.artistId,
          benchmarkId: screen.screenId,
          model: 'test/model',
          maxToolCalls: 10,
          toolCallsUsed: 4,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          prompt: { system: 'sys', user: 'usr' },
          trajectory: [],
          versions: [],
          initial: null,
          final: {
            n: 1,
            spec: { ...tinySpec(), id: screen.id, label: screen.spec.label },
            score: {
              screenId: screen.id,
              artistId: screen.artistId,
              kind: 'benchmark',
              valid: true,
              validationErrors: [],
              advisoryCount: 0,
              perception: {
                coverage: 0.1,
                meanLuminance: 0.2,
                luminanceVar: 0.01,
                layerCount: 2,
                entityCount: 10,
                centroid: { x: 0.5, y: 0.5 },
                topDominanceShare: 0.4,
              },
              styleFit: 0.8,
              intentFit: 0.9,
              perceptionOk: 1,
              advisoryPenalty: 0,
              score: 0.85,
              notes: [],
            },
          },
          outcome: 'finished',
        },
      ],
    };

    const bridged = bridgeAgentRunToTimeline(
      agent,
      catalog.screens,
      catalog.artists,
      {
        label: 'bridge test',
        note: 'unit',
        harness: 'agent-loop',
        mode: 'agent',
        modelName: 'test/model',
      },
      null,
    );

    expect(bridged.stored.summary.provenance.harness).toBe('agent-loop');
    expect(bridged.stored.summary.provenance.model?.name).toBe('test/model');
    expect(bridged.screens).toHaveLength(1);
    expect(bridged.screens[0]!.spec.layers.length).toBeGreaterThan(0);
    expect(bridged.stored.authoredScreens?.[0]?.id).toBe(screen.id);
    expect(bridged.stored.results[0]?.score).toBe(0.85);
  });
});
