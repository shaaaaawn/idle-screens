import { describe, expect, it } from 'vitest';
import { getCatalog } from './catalog';
import { scoreSuite } from './score';
import { validateSpec } from '@idle-screens/schema';

describe('artistic style eval catalog', () => {
  const catalog = getCatalog();

  it('has 15 artists and 150 screens', () => {
    expect(catalog.artists).toHaveLength(15);
    expect(catalog.screens).toHaveLength(150);
    expect(catalog.benchmarks).toHaveLength(5);
  });

  it('every screen validates', () => {
    const invalid = catalog.screens.filter((s) => !validateSpec(s.spec).valid);
    expect(invalid.map((s) => s.id)).toEqual([]);
  });

  it('each artist has 5 benchmarks and 5 signatures', () => {
    for (const a of catalog.artists) {
      const list = catalog.screensByArtist.get(a.id) ?? [];
      expect(list.filter((s) => s.kind === 'benchmark')).toHaveLength(5);
      expect(list.filter((s) => s.kind === 'signature')).toHaveLength(5);
    }
  });

  it('scoreSuite produces a summary with provenance and nextCycle hooks', () => {
    const { summary, results } = scoreSuite(catalog.screens, catalog.artists, {
      runId: 'test-run',
      request: {
        label: 'unit test',
        note: 'provenance smoke',
        harness: 'headless-vitest',
        modelName: 'test-harness',
      },
    });
    expect(results).toHaveLength(150);
    expect(summary.perArtist).toHaveLength(15);
    expect(summary.perBenchmark).toHaveLength(5);
    expect(summary.provenance.harness).toBe('headless-vitest');
    expect(summary.provenance.versions.styleDnaHash).toMatch(/^[0-9a-f]{8}$/);
    expect(summary.provenance.model?.name).toBe('test-harness');
    expect(summary.nextCycle.suggestedActions.length).toBeGreaterThan(0);
    expect(summary.suiteMedian).toBeGreaterThan(0);
  });
});
