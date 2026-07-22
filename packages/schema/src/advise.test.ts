import { describe, it, expect } from 'vitest';
import { adviseSpec } from './advise';
import { describeScene } from './describe';
import { EXAMPLE_SPECS } from './examples/index';
import type { SaverSpec } from './types';

const base: SaverSpec = {
  schemaVersion: 1,
  id: 'test',
  label: 'Test',
  units: 'px',
  layers: [
    { count: 20, sprite: { kind: 'circle', radius: [5, 10], color: '#fff' }, motion: { type: 'drift', speed: [10, 30] } },
  ],
};

describe('adviseSpec', () => {
  it('returns zero warnings for all shipped examples', () => {
    for (const spec of EXAMPLE_SPECS) {
      const warnings = adviseSpec(spec);
      expect(warnings, `${spec.id} should produce zero warnings`).toEqual([]);
    }
  });

  it('warns on dense scenes (> 500 entities)', () => {
    const dense: SaverSpec = {
      ...base,
      layers: [{ count: 300, sprite: { kind: 'circle', radius: [1, 2], color: '#fff' }, motion: { type: 'static' } },
        { count: 250, sprite: { kind: 'circle', radius: [1, 2], color: '#fff' }, motion: { type: 'static' } }],
    };
    const w = adviseSpec(dense);
    expect(w.some((x) => x.code === 'dense-scene')).toBe(true);
  });

  it('warns on invisible layers', () => {
    const inv: SaverSpec = {
      ...base,
      layers: [{ count: 10, sprite: { kind: 'circle', radius: [0.01, 0.02], color: '#fff' }, alpha: [0.01, 0.02], motion: { type: 'static' } }],
    };
    const w = adviseSpec(inv);
    expect(w.some((x) => x.code === 'invisible-layer')).toBe(true);
  });

  it('warns on sparse scenes (coverage < 0.05%)', () => {
    const sparse: SaverSpec = {
      ...base,
      layers: [{ count: 3, sprite: { kind: 'circle', radius: [0.5, 1], color: '#fff' }, alpha: [0.1, 0.2], motion: { type: 'static' } }],
    };
    const w = adviseSpec(sparse);
    expect(w.some((x) => x.code === 'sparse-scene')).toBe(true);
  });

  it('warns on text-heavy static specs', () => {
    const heavy: SaverSpec = {
      ...base,
      layers: [
        { count: 1, sprite: { kind: 'text', strings: ['A'] }, size: [20, 20], motion: { type: 'static' } },
        { count: 1, sprite: { kind: 'text', strings: ['B'] }, size: [20, 20], motion: { type: 'static' } },
        { count: 1, sprite: { kind: 'text', strings: ['C'] }, size: [20, 20], motion: { type: 'static' } },
        { count: 1, sprite: { kind: 'text', strings: ['D'] }, size: [20, 20], motion: { type: 'static' } },
        { count: 1, sprite: { kind: 'text', strings: ['E'] }, size: [20, 20], motion: { type: 'static' } },
      ],
    };
    const w = adviseSpec(heavy);
    expect(w.some((x) => x.code === 'text-heavy')).toBe(true);
  });

  it('warns on link starvation', () => {
    const starved: SaverSpec = {
      ...base,
      layers: [{
        count: 10,
        sprite: { kind: 'circle', radius: [5, 10], color: '#fff' },
        motion: { type: 'drift', speed: [10, 30] },
        links: { k: 4, maxDist: 1 },
      }],
    };
    const w = adviseSpec(starved);
    expect(w.some((x) => x.code === 'link-starvation')).toBe(true);
  });

  it('warns on uniform motion', () => {
    const uniform: SaverSpec = {
      ...base,
      layers: [{
        count: 20,
        sprite: { kind: 'circle', radius: [5, 10], color: '#fff' },
        motion: { type: 'drift', speed: [100, 100] },
      }],
    };
    const w = adviseSpec(uniform);
    expect(w.some((x) => x.code === 'uniform-motion')).toBe(true);
  });
});

describe('describeScene', () => {
  it('returns snapshots at requested time values', () => {
    const desc = describeScene(base, { times: [0, 3000] });
    expect(desc.snapshots).toHaveLength(2);
    expect(desc.snapshots[0]!.t).toBe(0);
    expect(desc.snapshots[1]!.t).toBe(3000);
  });

  it('reports layer count matching spec', () => {
    const desc = describeScene(base, { times: [0] });
    expect(desc.snapshots[0]!.layers[0]!.count).toBe(20);
  });

  it('scales count with viewport for viewport-unit specs', () => {
    const vpSpec: SaverSpec = {
      ...base,
      units: 'viewport',
      layers: [{ count: 100, sprite: { kind: 'circle', radius: [0.01, 0.02], color: '#fff' }, motion: { type: 'drift', speed: [0.05, 0.1] } }],
    };
    const small = describeScene(vpSpec, { viewport: { width: 540, height: 540 }, times: [0] });
    const large = describeScene(vpSpec, { viewport: { width: 2160, height: 2160 }, times: [0] });
    expect(small.snapshots[0]!.layers[0]!.count).toBe(50);
    expect(large.snapshots[0]!.layers[0]!.count).toBe(200);
  });

  it('reports link connectivity for link layers', () => {
    const linked: SaverSpec = {
      ...base,
      units: 'viewport',
      layers: [{
        count: 30,
        sprite: { kind: 'circle', radius: [0.01, 0.02], color: '#fff' },
        motion: { type: 'drift', speed: [0.01, 0.02] },
        links: { k: 3, maxDist: 0.3 },
      }],
    };
    const desc = describeScene(linked, { times: [0] });
    const layer = desc.snapshots[0]!.layers[0]!;
    expect(layer.linksDrawn).toBeGreaterThan(0);
    expect(layer.linksExpected).toBeGreaterThan(0);
    expect(layer.connectedComponents).toBeGreaterThan(0);
    expect(layer.isolatedNodes).not.toBeNull();
  });
});
