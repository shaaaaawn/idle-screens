import { describe, it, expect } from 'vitest';
import { createRng } from '@idle-screens/core';
import { buildEntities } from './simulate';
import { EXAMPLE_SPECS } from './examples/index';

const W = 1920;
const H = 1080;
const SEED = 42;

function snapshotSpec(spec: { layers: Array<Record<string, unknown>> }) {
  const rng = createRng(SEED);
  return spec.layers.map((layer) => buildEntities(layer as never, rng, W, H));
}

describe('determinism baseline — entity streams must not shift', () => {
  for (const spec of EXAMPLE_SPECS) {
    it(`${spec.id}: buildEntities produces identical output`, () => {
      const a = snapshotSpec(spec as never);
      const b = snapshotSpec(spec as never);
      expect(a).toEqual(b);
    });

    it(`${spec.id}: entity stream matches snapshot`, () => {
      const result = snapshotSpec(spec as never);
      expect(result).toMatchSnapshot();
    });
  }

  it('all shipped examples are covered', () => {
    expect(EXAMPLE_SPECS.length).toBeGreaterThanOrEqual(8);
    const ids = EXAMPLE_SPECS.map((s) => s.id);
    expect(ids).toContain('aquarium');
    expect(ids).toContain('lanterns');
    expect(ids).toContain('orrery');
    expect(ids).toContain('snowfall');
    expect(ids).toContain('sakura');
    expect(ids).toContain('rain');
    expect(ids).toContain('dev-dashboard');
  });
});
