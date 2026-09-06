import { describe, expect, it } from 'vitest';

import { adviseSpec } from './advise';
import { EXAMPLE_SPECS } from './examples';
import { layerCohesion } from './perceive';
import type { LayerSpec, SaverSpec } from './types';

/** One layer of 30 entities packed into a small box — the silhouette idiom. */
function packed(extra: Partial<LayerSpec> & Pick<LayerSpec, 'sprite'>): SaverSpec {
  return {
    schemaVersion: 1,
    id: 'packed',
    label: 'packed',
    seed: 1831,
    background: { type: 'gradient', stops: [{ at: 0, color: '#e2d6b6' }, { at: 1, color: '#cabd9b' }] },
    layers: [{
      key: 'body',
      count: 30,
      motion: { type: 'static' },
      region: { x: [0.07, 0.23], y: [0.23, 0.95] },
      ...extra,
    } as LayerSpec],
  };
}

const seams = (spec: SaverSpec) => adviseSpec(spec).filter((w) => w.code === 'overlap-seams');

describe('layer cohesion', () => {
  it('a scattered field reads as separate marks', () => {
    const spec: SaverSpec = {
      schemaVersion: 1, id: 'field', label: 'field', seed: 7,
      layers: [{
        count: 20,
        sprite: { kind: 'circle', radius: [0.002, 0.004], color: '#ffffff' },
        motion: { type: 'static' },
      }],
    };
    const c = layerCohesion(spec)[0]!;
    expect(c.overlap).toBeLessThan(0.05);
    expect(c.reads).toBe('marks');
  });

  it('packed flat-opaque circles of one colour read as a single mass', () => {
    const c = layerCohesion(packed({
      sprite: { kind: 'circle', radius: [0.07, 0.11], color: '#16325a' },
      alpha: [1, 1],
    }))[0]!;
    expect(c.overlap!).toBeGreaterThan(0.35);
    expect(c.seamless).toBe(true);
    expect(c.seamCause).toBeNull();
    expect(c.reads).toBe('mass');
  });

  /**
   * The whole point of the channel: these three have the SAME geometry and are
   * indistinguishable in luminance, coverage and dominance. Only the paint
   * settings decide whether the wall shows one shape or a pile of sprites.
   */
  it.each([
    ['alpha below 1', { sprite: { kind: 'circle', radius: [0.07, 0.11], color: '#16325a' }, alpha: [0.84, 0.96] }, /alpha/],
    ['a blend mode', { sprite: { kind: 'circle', radius: [0.07, 0.11], color: '#16325a' }, alpha: [1, 1], blend: 'multiply' }, /blend/],
    ['soft falloff', { sprite: { kind: 'circle', radius: [0.07, 0.11], color: '#16325a', soft: true }, alpha: [1, 1] }, /soft/],
    ['pulse', { sprite: { kind: 'circle', radius: [0.07, 0.11], color: '#16325a' }, alpha: [1, 1], pulse: { amp: 0.2, period: 4000 } }, /pulse/],
    ['a multi-colour palette', { sprite: { kind: 'circle', radius: [0.07, 0.11], color: '#16325a', colors: ['#16325a', '#0c2442'] }, alpha: [1, 1] }, /colours/],
  ] as const)('the same packed geometry is seamed by %s', (_label, extra, cause) => {
    const spec = packed(extra as Partial<LayerSpec> & Pick<LayerSpec, 'sprite'>);
    const c = layerCohesion(spec)[0]!;
    expect(c.overlap!).toBeGreaterThan(0.35);
    expect(c.seamless).toBe(false);
    expect(c.seamCause).toMatch(cause);
    expect(c.reads).toBe('seamed');
    expect(seams(spec)).toHaveLength(1);
  });

  it('stays silent on a low-alpha additive wash — the playbook recommends those', () => {
    const spec = packed({
      sprite: { kind: 'circle', radius: [0.06, 0.12], color: '#88aaff', soft: true },
      alpha: [0.15, 0.25],
      blend: 'lighter',
    });
    const c = layerCohesion(spec)[0]!;
    expect(c.overlap!).toBeGreaterThan(0.35); // geometrically packed
    expect(c.reads).toBe('seamed'); // and honestly reported as seamed
    expect(seams(spec)).toHaveLength(0); // but that is the effect, not a defect
  });

  it('does not fire on any shipped example', () => {
    const specs = Array.isArray(EXAMPLE_SPECS) ? EXAMPLE_SPECS : Object.values(EXAMPLE_SPECS);
    const offenders = (specs as SaverSpec[])
      .filter((s) => seams(s).length > 0)
      .map((s) => s.id);
    expect(offenders).toEqual([]);
  });

  it('reports null where a merged silhouette is not a meaningful idea', () => {
    const spec: SaverSpec = {
      schemaVersion: 1, id: 'lines', label: 'lines', seed: 3,
      layers: [
        { count: 12, sprite: { kind: 'streak', length: [0.02, 0.05], color: '#fff' }, motion: { type: 'drift', speed: [0.01, 0.02] } },
        { count: 8, sprite: { kind: 'emoji', glyphs: ['🐟'] }, size: [0.04, 0.06], motion: { type: 'static' } },
      ],
    };
    for (const c of layerCohesion(spec)) {
      expect(c.overlap).toBeNull();
      expect(c.reads).toBeNull();
    }
  });

  it('a single entity has no sibling to merge with', () => {
    const spec: SaverSpec = {
      schemaVersion: 1, id: 'one', label: 'one', seed: 3,
      layers: [{ count: 1, sprite: { kind: 'circle', radius: [0.2, 0.2], color: '#fff' }, motion: { type: 'static' }, position: { x: 0.5, y: 0.5 } }],
    };
    expect(layerCohesion(spec)[0]!.overlap).toBeNull();
  });

  it('rides along in the perception bundle', async () => {
    const { perceiveScene } = await import('./perceive');
    const spec = packed({ sprite: { kind: 'circle', radius: [0.07, 0.11], color: '#16325a' }, alpha: [1, 1] });
    expect(perceiveScene(spec).form[0]!.reads).toBe('mass');
  });
});
