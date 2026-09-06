import { describe, expect, it } from 'vitest';

import { adviseSpec } from './advise';
import { EXAMPLE_SPECS } from './examples';
import { layerCohesion, perceiveScene as perceiveSceneSync } from './perceive';
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

  // --- review round one -------------------------------------------------

  it('coincident sprites are one painted shape, not two uncovered ones', () => {
    const spec: SaverSpec = {
      schemaVersion: 1, id: 'stack', label: 'stack', seed: 5,
      layers: [{
        count: 4,
        sprite: { kind: 'circle', radius: [0.1, 0.1], color: '#16325a' },
        motion: { type: 'static' },
        region: { x: [0.5, 0.5], y: [0.5, 0.5] },
        alpha: [1, 1],
      }],
    };
    const c = layerCohesion(spec)[0]!;
    expect(c.overlap).toBe(1); // the boundary counts as inside
    expect(c.reads).toBe('mass');
  });

  it('measures a skinny shape by arc length, not by edge count', () => {
    // Wide flat rects packed along one line: the long top and bottom edges are
    // buried by neighbours while the short ends stay exposed. Sampling each of
    // the four edges equally would cap this near 0.5 however long the shape is.
    const spec: SaverSpec = {
      schemaVersion: 1, id: 'slats', label: 'slats', seed: 11,
      layers: [{
        count: 10,
        sprite: { kind: 'rect', width: [0.32, 0.32], aspect: [0.06, 0.06], color: '#16325a' },
        motion: { type: 'static' },
        region: { x: [0.4, 0.6], y: [0.5, 0.5] },
        alpha: [1, 1],
      }],
    };
    expect(layerCohesion(spec)[0]!.overlap!).toBeGreaterThan(0.7);
  });

  it('a palette entry with zero weight cannot seam anything', () => {
    const spec = packed({
      sprite: {
        kind: 'circle', radius: [0.07, 0.11], color: '#16325a',
        colors: ['#16325a', '#ff0000'], colorWeights: [1, 0],
      },
      alpha: [1, 1],
    });
    const c = layerCohesion(spec)[0]!;
    expect(c.seamCause).toBeNull();
    expect(c.reads).toBe('mass');
    expect(seams(spec)).toHaveLength(0);
  });

  it('a layer staged out by life has nothing to read', () => {
    const spec = packed({
      sprite: { kind: 'circle', radius: [0.07, 0.11], color: '#16325a' },
      alpha: [1, 1],
      life: { enter: 0, exit: 1000, fade: 0 },
    });
    expect(layerCohesion(spec, { t: 5000 })[0]!.reads).toBeNull();
    expect(layerCohesion(spec, { t: 500 })[0]!.reads).toBe('mass');
  });

  it('form and its advisory describe the same instant under a custom t', () => {
    const spec = packed({
      sprite: { kind: 'circle', radius: [0.07, 0.11], color: '#16325a' },
      alpha: [1, 1],
      life: { enter: 0, exit: 1000, fade: 0 },
    });
    // At t = 5 s the layer is gone, so neither channel should describe it.
    const late = perceiveSceneSync(spec, { t: 5000 });
    expect(late.form[0]!.reads).toBeNull();
    expect(late.advisories.filter((wn) => wn.code === 'overlap-seams')).toHaveLength(0);
  });

  // --- review round two -------------------------------------------------

  it('insets along the edge normal, so a concave shape with its centre in the notch still merges', () => {
    // An arch: a filled block with a notch cut out of the bottom middle. The
    // entity centre (0, 0) sits IN the notch, outside the filled area, so a
    // centre-directed inset would push samples out of the shape entirely.
    const arch: Array<[number, number]> = [
      [-1, -1], [-0.5, -1], [-0.5, 0.3], [0.5, 0.3],
      [0.5, -1], [1, -1], [1, 1], [-1, 1],
    ];
    const spec: SaverSpec = {
      schemaVersion: 1, id: 'arches', label: 'arches', seed: 4,
      layers: [{
        count: 3,
        sprite: { kind: 'polygon', radius: [0.12, 0.12], color: '#16325a', points: arch },
        motion: { type: 'static' },
        region: { x: [0.5, 0.5], y: [0.5, 0.5] },
        alpha: [1, 1],
      }],
    };
    const c = layerCohesion(spec)[0]!;
    expect(c.overlap).toBe(1);
    expect(c.reads).toBe('mass');
  });

  it('a sliver thinner than the nominal inset still merges with its twin', () => {
    // Both normal candidates would overshoot a shape this thin, putting every
    // sample outside its own rect; the step is bounded by the shortest edge.
    const spec: SaverSpec = {
      schemaVersion: 1, id: 'slivers', label: 'slivers', seed: 6,
      layers: [{
        count: 3,
        sprite: { kind: 'rect', width: [0.2, 0.2], aspect: [0.00001, 0.00001], color: '#16325a' },
        motion: { type: 'static' },
        region: { x: [0.5, 0.5], y: [0.5, 0.5] },
        alpha: [1, 1],
      }],
    };
    // A tip sample or two can still land outside a sliver this extreme;
    // what matters is that it merges rather than reporting near zero.
    expect(layerCohesion(spec)[0]!.overlap!).toBeGreaterThan(0.9);
  });

  it('adviseSpec counts the entities the renderer will build, not the unclamped scale-up', () => {
    // At 4K countScale is 2, which would take these three layers to 966 raw
    // entities — over LIMITS.maxTotal. buildScene clamps, so the small layer
    // lands at 5 entities and falls under the advisory's 6-entity gate.
    // Without the matching clamp in adviseSpec it would see 6 and fire, while
    // `form` in the same response described the 5-entity layer.
    const filler = (key: string): LayerSpec => ({
      key, count: 240,
      sprite: { kind: 'circle', radius: [0.002, 0.003], color: '#222222' },
      motion: { type: 'static' },
    });
    const spec: SaverSpec = {
      schemaVersion: 1, id: 'crowded', label: 'crowded', seed: 1831,
      layers: [
        {
          key: 'body', count: 3,
          sprite: { kind: 'circle', radius: [0.07, 0.11], color: '#16325a' },
          motion: { type: 'static' },
          region: { x: [0.1, 0.18], y: [0.44, 0.56] },
          alpha: [0.84, 0.96],
        },
        filler('a'), filler('b'),
      ],
    };
    const p = perceiveSceneSync(spec, { viewport: { width: 3840, height: 2160 } });
    expect(p.form[0]!.reads).toBe('seamed'); // packed, and alpha < 1
    expect(p.advisories.filter((wn) => wn.code === 'overlap-seams')).toHaveLength(0);
  });

  it('a polygon with no enclosed area has no silhouette to report', () => {
    // Three vertices that collapse to a single distinct point: the renderer
    // fills nothing, so the answer is null rather than "uncovered marks".
    const spec: SaverSpec = {
      schemaVersion: 1, id: 'degenerate', label: 'degenerate', seed: 8,
      layers: [{
        count: 4,
        sprite: {
          kind: 'polygon', radius: [0.1, 0.1], color: '#16325a',
          points: [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]] as Array<[number, number]>,
        },
        motion: { type: 'static' },
        alpha: [1, 1],
      }],
    };
    const c = layerCohesion(spec)[0]!;
    expect(c.overlap).toBeNull();
    expect(c.reads).toBeNull();
  });

  it('a collinear polygon encloses no area, so there is nothing to read', () => {
    // Nonzero radius and three distinct vertices, but zero enclosed area — the
    // case a bounding-radius filter lets through. Every entity in a layer
    // shares one sprite, so a layer that MIXES painting and non-painting
    // shapes is not expressible; what this pins is that zero-fill shapes are
    // excluded from `solid`, which is what stops them counting as siblings.
    const spec: SaverSpec = {
      schemaVersion: 1, id: 'flat', label: 'flat', seed: 9,
      layers: [{
        count: 2,
        sprite: {
          kind: 'polygon', radius: [0.1, 0.1], color: '#16325a',
          points: [[-1, 0], [0, 0], [1, 0]] as Array<[number, number]>,
        },
        motion: { type: 'static' },
        alpha: [1, 1],
      }],
    };
    const c = layerCohesion(spec)[0]!;
    expect(c.overlap).toBeNull();
    expect(c.reads).toBeNull();
  });

  it('rides along in the perception bundle', async () => {
    const { perceiveScene } = await import('./perceive');
    const spec = packed({ sprite: { kind: 'circle', radius: [0.07, 0.11], color: '#16325a' }, alpha: [1, 1] });
    expect(perceiveScene(spec).form[0]!.reads).toBe('mass');
  });
});
