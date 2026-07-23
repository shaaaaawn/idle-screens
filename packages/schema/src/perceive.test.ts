import { describe, it, expect } from 'vitest';
import { diffScenes, dominanceRanking, luminanceGrid, motionStats, perceiveScene, renderBrailleMap } from './perceive';
import { EXAMPLE_SPECS, POLYGONS_SPEC, WARP_TUNNEL_SPEC } from './examples/index';
import type { SaverSpec } from './types';

const BLANK_BRAILLE = String.fromCharCode(0x2800);

function spec(layers: SaverSpec['layers'], overrides: Partial<SaverSpec> = {}): SaverSpec {
  return {
    schemaVersion: 1,
    id: 'p',
    label: 'P',
    units: 'px',
    seed: 7,
    background: { type: 'solid', color: '#000000' },
    layers,
    ...overrides,
  };
}

describe('luminanceGrid', () => {
  it('is deterministic', () => {
    const a = perceiveScene(EXAMPLE_SPECS[0]!);
    const b = perceiveScene(EXAMPLE_SPECS[0]!);
    expect(a).toEqual(b);
  });

  it('locates a single bright element in profiles and centroid', () => {
    const s = spec([
      {
        count: 1,
        position: { x: 0.25, y: 0.5 },
        sprite: { kind: 'circle', radius: [60, 60], color: '#ffffff' },
        motion: { type: 'static' },
      },
    ]);
    const grid = luminanceGrid(s, { viewport: { width: 1600, height: 900 } });
    expect(grid.centroid!.x).toBeCloseTo(0.25, 1);
    expect(grid.centroid!.y).toBeCloseTo(0.5, 1);
    const peakCol = grid.colProfile.indexOf(Math.max(...grid.colProfile));
    expect(Math.abs(peakCol / grid.cols - 0.25)).toBeLessThan(0.06);
    expect(grid.coverage).toBeGreaterThan(0);
    expect(grid.coverage).toBeLessThan(0.2);
  });

  it('black-on-black deviates nowhere (deviation, not raw luminance)', () => {
    const s = spec([
      { count: 5, sprite: { kind: 'circle', radius: [40, 60], color: '#000000' }, motion: { type: 'static' } },
    ]);
    const grid = luminanceGrid(s);
    expect(grid.coverage).toBe(0);
    expect(grid.centroid).toBeNull();
  });

  it('counts chain link lines as visual mass (Mystify-style scenes)', () => {
    const grid = luminanceGrid(POLYGONS_SPEC);
    expect(grid.coverage).toBeGreaterThan(0.005);
  });
});

describe('renderBrailleMap', () => {
  it('produces the documented dimensions and visible dots', () => {
    const grid = luminanceGrid(WARP_TUNNEL_SPEC);
    const braille = renderBrailleMap(grid);
    const lines = braille.split('\n');
    expect(lines).toHaveLength(12); // 48 rows / 4
    expect(lines[0]!.length).toBe(40); // 80 cols / 2
    expect([...braille].some((ch) => ch !== BLANK_BRAILLE && ch !== '\n')).toBe(true);
  });
});

describe('dominanceRanking', () => {
  it('ranks a large bright layer above a tiny dim one, shares sum to 1', () => {
    const s = spec([
      { key: 'whisper', count: 3, sprite: { kind: 'circle', radius: [2, 3], color: '#222233' }, alpha: [0.2, 0.3], motion: { type: 'static' } },
      { key: 'shout', count: 10, sprite: { kind: 'circle', radius: [50, 70], color: '#ffffff' }, motion: { type: 'static' } },
    ]);
    const ranks = dominanceRanking(s);
    expect(ranks[0]!.key).toBe('shout');
    expect(ranks[0]!.share).toBeGreaterThan(0.9);
    expect(ranks.reduce((acc, r) => acc + r.share, 0)).toBeCloseTo(1, 6);
  });

  it('life-gated layers carry no weight before they enter', () => {
    const s = spec([
      { key: 'now', count: 5, sprite: { kind: 'circle', radius: [30, 30], color: '#ffffff' }, motion: { type: 'static' } },
      { key: 'later', count: 5, sprite: { kind: 'circle', radius: [30, 30], color: '#ffffff' }, motion: { type: 'static' }, life: { enter: 60000 } },
    ]);
    const ranks = dominanceRanking(s, { t: 1000 });
    const later = ranks.find((r) => r.key === 'later')!;
    expect(later.share).toBe(0);
  });
});

describe('motionStats', () => {
  it('reports exact drift speed and zero for static', () => {
    const s = spec([
      { key: 'still', count: 5, sprite: { kind: 'circle', radius: [5, 5], color: '#ffffff' }, motion: { type: 'static' } },
      { key: 'runner', count: 5, sprite: { kind: 'circle', radius: [5, 5], color: '#ffffff' }, motion: { type: 'drift', speed: [100, 100] } },
    ]);
    const stats = motionStats(s);
    expect(stats.find((m) => m.key === 'still')!.meanSpeed).toBe(0);
    expect(stats.find((m) => m.key === 'runner')!.meanSpeed).toBeCloseTo(100, 0);
  });
});

describe('diffScenes', () => {
  it('detects an alpha raise as a dominance and region gain', () => {
    const dim: SaverSpec = spec([
      { key: 'stars', count: 40, sprite: { kind: 'circle', radius: [2, 4], color: '#ffffff' }, alpha: [0.2, 0.3], motion: { type: 'static' } },
      { key: 'hero', count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'circle', radius: [80, 80], color: '#ffcc44' }, alpha: [0.1, 0.1], motion: { type: 'static' } },
    ]);
    const bright = JSON.parse(JSON.stringify(dim)) as SaverSpec;
    (bright.layers[1]!.alpha as [number, number]) = [0.9, 0.9];

    const diff = diffScenes(dim, bright);
    const hero = diff.dominance.find((d) => d.key === 'hero')!;
    expect(hero.shareB).toBeGreaterThan(hero.shareA);
    const center = diff.regions.find((r) => r.region === 'center')!;
    expect(center.delta).toBeGreaterThan(0);
    expect(diff.meanLuminance.delta).toBeGreaterThan(0);
  });

  it('reports advisory changes between versions', () => {
    const sparse: SaverSpec = spec([
      { count: 1, sprite: { kind: 'circle', radius: [0.5, 0.6], color: '#111122' }, alpha: [0.05, 0.05], motion: { type: 'static' } },
    ]);
    const healthy: SaverSpec = spec([
      { count: 60, sprite: { kind: 'circle', radius: [20, 40], color: '#ffffff' }, alpha: [0.5, 0.9], motion: { type: 'drift', speed: [20, 80] } },
    ]);
    const diff = diffScenes(sparse, healthy);
    expect(diff.advisories.removed).toContain('sparse-scene');
  });
});

describe('perceiveScene across all shipped examples', () => {
  it('every example is perceivable: dots on the map, non-zero coverage, sane bundle', () => {
    for (const s of EXAMPLE_SPECS) {
      const p = perceiveScene(s);
      expect(p.coverage, `${s.id} coverage`).toBeGreaterThan(0.001);
      expect([...p.braille].some((ch) => ch !== BLANK_BRAILLE && ch !== '\n'), `${s.id} braille has dots`).toBe(true);
      expect(p.dominance.length).toBe(s.layers.length);
      expect(p.motion.length).toBe(s.layers.length);
    }
  });
});
