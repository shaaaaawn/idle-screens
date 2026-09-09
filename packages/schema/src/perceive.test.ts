import { describe, it, expect } from 'vitest';
import { diffScenes, dominanceRanking, luminanceGrid, motionStats, perceiveScene, perceiveSequenceFrame, renderBrailleMap, renderDensityMap } from './perceive';
import type { IdleSequence } from './types';
import { EXAMPLE_SPECS, POLYGONS_SPEC, WARP_TUNNEL_SPEC } from './examples/index';
import { LIMITS, type SaverSpec } from './types';

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

describe('additive-glow calibration (G1)', () => {
  it('a soft additive circle covers more than the same hard opaque circle', () => {
    const hard = luminanceGrid(spec([
      { count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'circle', radius: [30, 30], color: '#66ccff' }, motion: { type: 'static' } },
    ]));
    const glow = luminanceGrid(spec([
      { count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'circle', radius: [30, 30], color: '#66ccff', soft: true }, blend: 'lighter', motion: { type: 'static' } },
    ]));
    expect(glow.coverage).toBeGreaterThan(hard.coverage);
  });

  it('leaves hard non-additive circles unchanged (no runaway coverage)', () => {
    // The single-white-circle case the suite already bounds must stay < 0.2.
    const grid = luminanceGrid(
      spec([{ count: 1, position: { x: 0.25, y: 0.5 }, sprite: { kind: 'circle', radius: [60, 60], color: '#ffffff' }, motion: { type: 'static' } }]),
      { viewport: { width: 1600, height: 900 } },
    );
    expect(grid.coverage).toBeLessThan(0.2);
  });
});

describe('geometry-aware dominance (G2)', () => {
  it('a thin bright ring registers meaningful weight beside a dim large disc', () => {
    const s = spec([
      { key: 'disc', count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'circle', radius: [120, 120], color: '#222233' }, alpha: [0.3, 0.3], motion: { type: 'static' } },
      { key: 'ring', count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'ring', radius: [100, 100], width: 3, color: '#ffffff' }, motion: { type: 'static' } },
    ]);
    const ranks = dominanceRanking(s);
    const ring = ranks.find((r) => r.key === 'ring')!;
    expect(ring.share).toBeGreaterThan(0.1);
  });
});

describe('renderDensityMap (G4)', () => {
  it('is grid-sized and pairs with a higher-res grid for a sharper picture', () => {
    const s = spec([
      { count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'circle', radius: [40, 40], color: '#ffffff' }, motion: { type: 'static' } },
    ]);
    const grid = luminanceGrid(s, { cols: 120, rows: 48 });
    const density = renderDensityMap(grid);
    const lines = density.split('\n');
    expect(lines).toHaveLength(48);
    expect(lines[0]!.length).toBe(120);
    expect([...density].some((ch) => ch !== ' ' && ch !== '\n')).toBe(true);
  });

  it('perceiveScene lists literal text strings and sizes invisible in the maps', () => {
    const s = spec([
      { key: 'label', count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'text', strings: ['HELLO', 'WORLD'], color: '#ffffff', font: '48px sans-serif' }, motion: { type: 'static' } },
    ]);
    const p = perceiveScene(s);
    const t = p.text.find((x) => x.key === 'label')!;
    expect(t.strings).toEqual(['HELLO', 'WORLD']);
    expect(t.sizePx).toBe(48);
    expect(typeof p.density).toBe('string');
  });
});

describe('persistence-aware perception (ghosting + trail)', () => {
  const movers = (overrides: Partial<SaverSpec> = {}): SaverSpec => spec([
    { count: 24, sprite: { kind: 'circle', radius: [5, 10], color: '#7fd0ff', soft: true }, alpha: [0.5, 0.9], motion: { type: 'drift', speed: [80, 150] } },
  ], overrides);

  it('ghosting is visible: a ghosted scene smears more than the same scene without', () => {
    const off = luminanceGrid(movers());
    const on = luminanceGrid(movers({ ghosting: 0.9 }));
    expect(on.coverage).toBeGreaterThan(off.coverage);
    expect(on.meanLuminance).toBeGreaterThan(off.meanLuminance);
  });

  it('more persistence means more smear (monotonic in g)', () => {
    const low = luminanceGrid(movers({ ghosting: 0.5 }));
    const high = luminanceGrid(movers({ ghosting: 0.95 }));
    expect(high.coverage).toBeGreaterThan(low.coverage);
  });

  it('trail is visible: afterglow adds coverage behind moving entities', () => {
    const bare = movers();
    const trailed = movers();
    trailed.layers[0]!.trail = { length: 1200, fade: 1 };
    const off = luminanceGrid(bare);
    const on = luminanceGrid(trailed);
    expect(on.coverage).toBeGreaterThan(off.coverage);
  });

  it('stays deterministic with persistence in play', () => {
    const s = movers({ ghosting: 0.9 });
    s.layers[0]!.trail = { length: 800 };
    expect(luminanceGrid(s)).toEqual(luminanceGrid(s));
  });

  it('a static ghosted scene keeps its composition (smear needs motion)', () => {
    const still = spec([
      { count: 8, sprite: { kind: 'circle', radius: [20, 30], color: '#ffffff' }, motion: { type: 'static' } },
    ]);
    const off = luminanceGrid(still);
    const on = luminanceGrid({ ...still, ghosting: 0.9 });
    // Same footprint: ghost taps land on the same cells for static entities.
    expect(on.coverage).toBeCloseTo(off.coverage, 4);
    expect(on.centroid!.x).toBeCloseTo(off.centroid!.x, 4);
    expect(on.centroid!.y).toBeCloseTo(off.centroid!.y, 4);
  });

  it('diffScenes can now measure a ghosting change (the §10 misdiagnosis trap)', () => {
    const diff = diffScenes(movers(), movers({ ghosting: 0.9 }));
    expect(diff.coverage.delta).toBeGreaterThan(0);
  });

  it('dominance counts trail ribbons — a comet layer is ranked by its comet', () => {
    const twoLayers = (withTrail: boolean): SaverSpec => spec([
      { key: 'anchor', count: 1, position: { x: 0.2, y: 0.2 }, sprite: { kind: 'circle', radius: [30, 30], color: '#ffffff' }, motion: { type: 'static' } },
      { key: 'comet', count: 1, sprite: { kind: 'circle', radius: [10, 10], color: '#88ccff' }, motion: { type: 'drift', speed: [200, 200] }, ...(withTrail ? { trail: { length: 1500, fade: 1 } } : {}) },
    ]);
    const bare = dominanceRanking(twoLayers(false)).find((r) => r.key === 'comet')!;
    const trailed = dominanceRanking(twoLayers(true)).find((r) => r.key === 'comet')!;
    expect(trailed.share).toBeGreaterThan(bare.share);
  });

  it('dominance counts ghosting smear for moving layers', () => {
    const s = (ghosting?: number): SaverSpec => spec([
      { key: 'still', count: 4, sprite: { kind: 'circle', radius: [25, 25], color: '#ffffff' }, motion: { type: 'static' } },
      { key: 'runner', count: 4, sprite: { kind: 'circle', radius: [10, 10], color: '#88ccff' }, motion: { type: 'drift', speed: [200, 200] } },
    ], ghosting !== undefined ? { ghosting } : {});
    const clear = dominanceRanking(s()).find((r) => r.key === 'runner')!;
    const smeared = dominanceRanking(s(0.9)).find((r) => r.key === 'runner')!;
    expect(smeared.share).toBeGreaterThan(clear.share);
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

describe('perceiveSequenceFrame (1d — bed + segment)', () => {
  const dark: SaverSpec = {
    schemaVersion: 1, id: 'dark', label: 'Dark',
    background: { type: 'solid', color: '#101010' },
    layers: [{ key: 'dot', count: 1, sprite: { kind: 'circle', radius: [0.02, 0.02], color: '#ffffff' }, motion: { type: 'static' }, position: { x: 0.8, y: 0.8 } }],
  };
  const bed: SaverSpec = {
    schemaVersion: 1, id: 'bed', label: 'Bed',
    background: { type: 'solid', color: '#202030' },
    layers: [{ key: 'orb', count: 1, sprite: { kind: 'circle', radius: [0.15, 0.15], color: '#ffffff' }, motion: { type: 'drift', speed: [0.05, 0.05], angle: 0 }, position: { x: 0.2, y: 0.3 } }],
  };
  const seqOf = (withBed: boolean): IdleSequence => ({
    format: 'idle-sequence', schemaVersion: 1, id: 'p', label: 'P', loop: false, seed: 7,
    ...(withBed ? { bed } : {}),
    segments: [
      { key: 'a', scene: dark, duration: 5000 },
      { key: 'b', scene: { ...dark, id: 'b', layers: [{ ...dark.layers[0]!, key: 'text', sprite: { kind: 'textBlock', text: 'Act II', fontSize: 0.05, maxWidth: 0.5 } }] }, duration: 5000 },
    ],
  });

  it('without a bed it is perceiveScene of the resolved segment at localT, plus the segment field', () => {
    const p = perceiveSequenceFrame(seqOf(false), 6000);
    expect(p.bed).toBe(false);
    expect(p.segment).toEqual({ index: 1, key: 'b', localT: 1000 });
    const plain = perceiveScene(seqOf(false).segments[1]!.scene, { t: 1000, seed: 8 }); // seq.seed 7 + index 1, mirroring the renderer
    expect(p.braille).toBe(plain.braille);
    expect(p.coverage).toBe(plain.coverage);
    expect(p.dominance).toEqual(plain.dominance);
    expect(p.text).toEqual(plain.text);
    expect(p.t).toBe(1000);
  });

  it('with a bed the maps are the composite: more coverage than either alone, bed layers keyed bed:', () => {
    const p = perceiveSequenceFrame(seqOf(true), 2000);
    expect(p.bed).toBe(true);
    expect(p.segment.index).toBe(0);
    const bedAlone = perceiveScene(bed, { t: 2000, seed: 7 });
    const segAlone = perceiveScene(dark, { t: 2000 });
    expect(p.coverage).toBeGreaterThanOrEqual(bedAlone.coverage);
    expect(p.coverage).toBeGreaterThanOrEqual(segAlone.coverage);
    expect(p.coverage).toBeGreaterThan(bedAlone.coverage - 1e-9 + segAlone.coverage * 0.5);
    expect(p.dominance.map((d) => d.key).sort()).toEqual(['bed:orb', 'dot']);
    expect(p.dominance[0]!.key).toBe('bed:orb'); // the big bright orb outranks the dot
    expect(p.dominance.reduce((s, d) => s + d.share, 0)).toBeCloseTo(1, 9);
    expect(p.motion.map((m) => m.key)).toEqual(['bed:orb', 'dot']);
    expect(p.motion[0]!.moving).toBe(true);
    expect(p.motion[1]!.layerIndex).toBe(1); // segment indices shift past the bed's layers
  });

  it("the bed runs on the global clock: its centroid is continuous across the boundary while the segment's clock resets", () => {
    const before = perceiveSequenceFrame(seqOf(true), 4990);
    const after = perceiveSequenceFrame(seqOf(true), 5010);
    expect(before.segment.index).toBe(0);
    expect(after.segment).toEqual({ index: 1, key: 'b', localT: 10 });
    // Assert on the bed's own centroid, not the merged grid: the ink swaps
    // from a dot to a text block across this boundary, so a merged-centroid
    // comparison would depend on that unrelated content change rather than
    // on whether the bed's clock is actually continuous.
    const bx = (T: number) => luminanceGrid(bed, { t: T, seed: 7 }).centroid!.x;
    expect(Math.abs(bx(5010) - bx(4990))).toBeLessThan(0.01);
    expect(after.text.map((t) => t.key)).toEqual(['text']); // segment b's caption, listed after the bed's (none)
    expect(after.text[0]!.layerIndex).toBe(1);
  });

  it('bed advisories are prefixed bed.; the segment background never fires against the bed', () => {
    const p = perceiveSequenceFrame(seqOf(true), 2000);
    for (const a of p.advisories) expect(a.path.startsWith('bed.') || a.path.startsWith('layers')).toBe(true);
  });

  it('renders the bed and segment at the seeds SequenceInstance actually uses (own seed, else seq.seed offset), not raw seq.seed', () => {
    // A single fixed-position entity (the `bed`/`dark` fixtures above) doesn't
    // move when the seed changes, so it can't distinguish a correct seed from
    // a wrong one. This fixture scatters several entities over a position
    // range, so its centroid does depend on which seed rendered it.
    const scatter = (id: string): SaverSpec => ({
      schemaVersion: 1, id, label: id,
      background: { type: 'solid', color: '#000000' },
      layers: [{ count: 12, sprite: { kind: 'circle', radius: [0.02, 0.02], color: '#ffffff' }, motion: { type: 'static' } }],
    });
    const scatterBed = scatter('scatter-bed');
    const scatterSeg = scatter('scatter-seg');
    const seq: IdleSequence = { format: 'idle-sequence', schemaVersion: 1, id: 's', label: 'S', loop: false, seed: 7, bed: scatterBed, segments: [{ key: 'a', scene: scatterSeg, duration: 5000 }] };

    // compile.ts: bed seed = seq.seed + LIMITS.maxSegments; segment 0 seed = seq.seed + 0.
    const bedGrid = luminanceGrid(scatterBed, { t: 1000, seed: 7 + LIMITS.maxSegments });
    const segGrid = luminanceGrid(scatterSeg, { t: 1000, seed: 7 });
    const cells = bedGrid.cells.map((v, i) => Math.min(1, v + segGrid.cells[i]!));
    let cx = 0, dev = 0;
    for (let r = 0; r < bedGrid.rows; r++) {
      for (let c = 0; c < bedGrid.cols; c++) {
        const i = r * bedGrid.cols + c;
        const d = Math.abs(cells[i]! - bedGrid.background[r]!);
        cx += d * (c + 0.5);
        dev += d;
      }
    }
    const expectedCentroidX = cx / dev / bedGrid.cols;

    const p = perceiveSequenceFrame(seq, 1000);
    expect(p.centroid!.x).toBeCloseTo(expectedCentroidX, 9);
    // Sanity: the raw, unoffset seq.seed would have produced a visibly
    // different composite for this fixture — otherwise this test proves
    // nothing about which seed was actually used.
    const bedAtRawSeed = luminanceGrid(scatterBed, { t: 1000, seed: 7 });
    expect(bedAtRawSeed.centroid!.x).not.toBeCloseTo(bedGrid.centroid!.x, 2);
  });
});
