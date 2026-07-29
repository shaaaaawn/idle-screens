import { describe, it, expect } from 'vitest';
import { adviseSpec, adviseSequence } from './advise';
import { describeScene } from './describe';
import { EXAMPLE_SPECS } from './examples/index';
import type { IdleSequence, SaverSpec } from './types';

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

  it('warns when a layer is painted its own background colour', () => {
    // The failure `invisible-layer` cannot catch: full radius, full alpha, and
    // still unseeable because the colour matches the plate behind it.
    const camouflaged: SaverSpec = {
      ...base,
      background: { type: 'gradient', stops: [{ at: 0, color: '#2b0a06' }, { at: 1, color: '#2b0a06' }] },
      layers: [{
        count: 30,
        sprite: { kind: 'circle', radius: [20, 40], color: '#2b0a06' },
        alpha: [1, 1],
        motion: { type: 'drift', speed: [10, 30] },
      }],
    };
    const warnings = adviseSpec(camouflaged);
    expect(warnings.map((w) => w.code)).toContain('low-contrast-layer');
    expect(warnings.find((w) => w.code === 'low-contrast-layer')!.path).toBe('layers[0].sprite');
    // Not a size/alpha problem — the other invisibility check stays quiet.
    expect(warnings.map((w) => w.code)).not.toContain('invisible-layer');
  });

  it('judges additive layers by the light they add, not their difference', () => {
    // Under `lighter` a background-matched colour still brightens the plate, so
    // the question is whether the layer has any light to contribute at all.
    const bg = { type: 'gradient' as const, stops: [{ at: 0, color: '#101010' }, { at: 1, color: '#101010' }] };
    const dim: SaverSpec = {
      ...base,
      background: bg,
      layers: [{
        count: 30,
        sprite: { kind: 'circle', radius: [20, 40], color: '#050505' },
        blend: 'lighter',
        motion: { type: 'drift', speed: [10, 30] },
      }],
    };
    expect(adviseSpec(dim).map((w) => w.code)).toContain('low-contrast-layer');

    // A bright additive layer is fine even though it sits on a similar-luma
    // plate — difference would have mis-flagged it.
    const bright: SaverSpec = {
      ...dim,
      layers: [{ ...dim.layers[0]!, sprite: { kind: 'circle', radius: [20, 40], color: '#ff4a1c' } }],
    };
    expect(adviseSpec(bright).map((w) => w.code)).not.toContain('low-contrast-layer');
  });

  it('does not flag equal-luminance, contrasting-hue fields', () => {
    // Pointillism: golden dots over a pale grey-blue plate. Only 0.013 apart in
    // luma — a luminance-based check flags this, and it is perfectly visible.
    // This test exists to stop anyone "simplifying" colourSeparation back to a
    // luma difference.
    const pointillist: SaverSpec = {
      ...base,
      background: {
        type: 'gradient',
        stops: [{ at: 0, color: '#d8e0e8' }, { at: 0.6, color: '#c8d0c0' }, { at: 1, color: '#9aa888' }],
      },
      layers: [{
        count: 60,
        sprite: { kind: 'circle', radius: [2, 12], color: '#e8c060' },
        alpha: [0.7, 1],
        motion: { type: 'drift', speed: [5, 15] },
      }],
    };
    expect(adviseSpec(pointillist).map((w) => w.code)).not.toContain('low-contrast-layer');
  });

  it('does not flag faint-but-coloured atmosphere', () => {
    // The schema actively recommends this pattern ("tiny soft circles at low
    // alpha"); low opacity is `invisible-layer`'s axis, not this one.
    const atmosphere: SaverSpec = {
      ...base,
      background: { type: 'gradient', stops: [{ at: 0, color: '#05050a' }, { at: 1, color: '#05050a' }] },
      layers: [{
        count: 80,
        sprite: { kind: 'circle', radius: [12, 24], color: '#8fb4d8', soft: true },
        alpha: [0.15, 0.25],
        blend: 'lighter',
        motion: { type: 'drift', speed: [5, 15] },
      }],
    };
    expect(adviseSpec(atmosphere).map((w) => w.code)).not.toContain('low-contrast-layer');
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

// ---------------------------------------------------------------------------
// adviseSequence
// ---------------------------------------------------------------------------

describe('adviseSequence', () => {
  const scene: SaverSpec = {
    schemaVersion: 1,
    id: 'seq-adv',
    label: 'Seq Advise',
    background: { type: 'solid', color: '#111111' },
    layers: [{ count: 3, sprite: { kind: 'circle', radius: [5, 10], color: '#ffffff' }, motion: { type: 'static' } }],
  };

  function mkSeq(overrides: Partial<IdleSequence> = {}): IdleSequence {
    return {
      format: 'idle-sequence',
      schemaVersion: 1,
      id: 'adv-test',
      label: 'Advise Test',
      seed: 1,
      loop: false,
      segments: [
        { key: 'a', scene, duration: 5000 },
        { key: 'b', scene, duration: 5000 },
      ],
      ...overrides,
    };
  }

  it('returns no warnings for structurally identical segments', () => {
    const warnings = adviseSequence(mkSeq());
    expect(warnings.filter((w) => w.code === 'boundary-luminance-jump')).toHaveLength(0);
  });

  it('warns on large luminance jump at boundary', () => {
    const dark: SaverSpec = { ...scene, background: { type: 'solid', color: '#000000' } };
    const bright: SaverSpec = { ...scene, background: { type: 'solid', color: '#ffffff' } };
    const warnings = adviseSequence(mkSeq({
      segments: [
        { key: 'a', scene: dark, duration: 5000 },
        { key: 'b', scene: bright, duration: 5000 },
      ],
    }));
    expect(warnings.some((w) => w.code === 'boundary-luminance-jump')).toBe(true);
  });

  it('warns on morph structural mismatch', () => {
    const diffScene: SaverSpec = {
      ...scene,
      layers: [{ count: 10, sprite: { kind: 'emoji', glyphs: ['🔴'] }, motion: { type: 'static' } }],
    };
    const warnings = adviseSequence(mkSeq({
      segments: [
        { key: 'a', scene, duration: 5000, transition: { type: 'morph', dur: 1000 } },
        { key: 'b', scene: diffScene, duration: 5000 },
      ],
    }));
    expect(warnings.some((w) => w.code === 'morph-structural-mismatch')).toBe(true);
  });

  it('propagates per-segment advisories', () => {
    const camoScene: SaverSpec = {
      ...scene,
      background: { type: 'solid', color: '#ffffff' },
      layers: [{ count: 5, sprite: { kind: 'circle', radius: [5, 10], color: '#ffffff' }, motion: { type: 'static' } }],
    };
    const warnings = adviseSequence(mkSeq({
      segments: [{ key: 'a', scene: camoScene, duration: 5000 }],
    }));
    expect(warnings.some((w) => w.path.startsWith('segments[0].scene.'))).toBe(true);
  });
});
