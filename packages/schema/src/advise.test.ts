import { describe, it, expect } from 'vitest';
import { adviseSpec } from './advise';
import { EXAMPLE_SPECS } from './examples/index';
import type { SaverSpec } from './types';

const base: SaverSpec = {
  schemaVersion: 1,
  id: 'test',
  label: 'Test',
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

  it('warns on drift with wrap: false', () => {
    const noWrap: SaverSpec = {
      ...base,
      layers: [{ count: 5, sprite: { kind: 'text', strings: ['hello'] }, size: [20, 30], motion: { type: 'drift', speed: [10, 30] }, wrap: false }],
    };
    const w = adviseSpec(noWrap);
    expect(w.some((x) => x.code === 'wrap-off-drift')).toBe(true);
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
});
