import { describe, expect, it } from 'vitest';
import deck from './__fixtures__/deck.sequence.json';
import snowWhite from './__fixtures__/snow-white.sequence.json';
import ambientTidepool from './__fixtures__/timed/ambient-tidepool.json';
import dxMark from './__fixtures__/timed/dx-mark.json';
import timedSunrise from './__fixtures__/timed/timed-sunrise.json';
import wrapIdent from './__fixtures__/timed/wrap-ident.sequence.json';
import { EXAMPLE_SEQUENCES, SCHEMA_EXAMPLES } from './examples';
import { luminanceGrid } from './perceive';
import {
  layerPatternMotion, patternHazardReport, patternSampleTimes, stripeExtrema, stripeRuns,
  PATTERN_MAX_SAMPLE_TIMES, PATTERN_MIN_PAIRS, PATTERN_MOVING_AREA,
} from './pattern-hazard';
import type { IdleSequence, SaverSpec } from './types';
import { validateSpec } from './validate';

const scene = (layers: unknown[], extra: Record<string, unknown> = {}, bg = '#000000'): SaverSpec =>
  ({ schemaVersion: 1, id: 'p', label: 'P', background: { type: 'solid', color: bg }, layers, ...extra }) as unknown as SaverSpec;

/**
 * Horizontal lines `pitchPx` apart at 1080p (a third of the pitch wide), in
 * a path polygon of radius `radius` (fraction of the short side) centred on
 * the frame. Radius 2 fills any 16:9 frame however it is turned.
 */
function grating(pitchPx: number, opts: { radius?: number; color?: string; bg?: string; layer?: Record<string, unknown> } = {}): SaverSpec {
  const radius = opts.radius ?? 2;
  const unit = radius * 1080;
  const d = pitchPx / unit;
  const parts: string[] = [];
  for (let y = -0.95; y <= 0.95 + 1e-9; y += d) parts.push(`M -0.95 ${y.toFixed(5)} L 0.95 ${y.toFixed(5)}`);
  const color = opts.color ?? '#ffffff';
  return scene([{
    count: 1, position: { x: 0.5, y: 0.5 }, motion: { type: 'static' },
    sprite: { kind: 'polygon', radius: [radius, radius], color, path: parts.join(' '), fill: false, stroke: { color, width: pitchPx / 3 / unit } },
    ...opts.layer,
  }], {}, opts.bg);
}

/** Vertical lines across the whole width, in a band `h` (fraction of the short side) tall: stripes a horizontal drift moves across. */
function band(pitchPx: number, h: number, motion: Record<string, unknown>): SaverSpec {
  const d = pitchPx / 2160;
  const parts: string[] = [];
  for (let x = -0.95; x <= 0.95 + 1e-9; x += d) parts.push(`M ${x.toFixed(5)} ${-h / 4} L ${x.toFixed(5)} ${h / 4}`);
  return scene([{
    count: 1, position: { x: 0.5, y: 0.5 }, motion,
    sprite: { kind: 'polygon', radius: [2, 2], color: '#ffffff', path: parts.join(' '), fill: false, stroke: { color: '#ffffff', width: pitchPx / 3 / 2160 } },
  }]);
}

/** `n` full-width white bars on black, `gap` apart (fraction of the short side), from the top. */
const bars = (n: number, gap: number, height = 0.012): SaverSpec => scene([{
  count: n, position: { x: 0.5, y: 0.04 }, layout: { type: 'list', gap }, motion: { type: 'static' },
  sprite: { kind: 'rect', width: [2, 2], aspect: [height / 2, height / 2], color: '#ffffff' },
}]);

/** Concentric rings `pitchPx` apart at 1080p, out to 0.95 of a radius-1 polygon centred on the frame. */
function rings(pitchPx: number): SaverSpec {
  const d = pitchPx / 1080;
  const parts: string[] = [];
  for (let r = d; r <= 0.95; r += d) {
    const pts = Array.from({ length: 49 }, (_, i) => `${(r * Math.cos((i / 48) * 2 * Math.PI)).toFixed(3)} ${(r * Math.sin((i / 48) * 2 * Math.PI)).toFixed(3)}`);
    parts.push(`M ${pts.join(' L ')}`);
  }
  return scene([{
    count: 1, position: { x: 0.5, y: 0.5 }, motion: { type: 'static' },
    sprite: { kind: 'polygon', radius: [1, 1], color: '#ffffff', path: parts.join(' '), fill: false, stroke: { color: '#ffffff', width: d / 3 } },
  }]);
}

/** `n` spokes radiating from the centre of a radius-1 polygon. */
function spokes(n: number): SaverSpec {
  const parts = Array.from({ length: n }, (_, k) => {
    const a = (k / n) * 2 * Math.PI;
    return `M 0 0 L ${(Math.cos(a) * 0.98).toFixed(4)} ${(Math.sin(a) * 0.98).toFixed(4)}`;
  });
  return scene([{
    count: 1, position: { x: 0.5, y: 0.5 }, motion: { type: 'static' },
    sprite: { kind: 'polygon', radius: [1, 1], color: '#ffffff', path: parts.join(' '), fill: false, stroke: { color: '#ffffff', width: 0.006 } },
  }]);
}

/** Horizontal lines whose spacing grows by `growth` a line from `pitchPx` at the top: a floor in perspective. */
function perspective(pitchPx: number, growth: number): SaverSpec {
  const parts: string[] = [];
  for (let y = -0.95, d = pitchPx / 2160; y <= 0.95; y += d, d *= 1 + growth) parts.push(`M -0.95 ${y.toFixed(5)} L 0.95 ${y.toFixed(5)}`);
  return scene([{
    count: 1, position: { x: 0.5, y: 0.5 }, motion: { type: 'static' },
    sprite: { kind: 'polygon', radius: [2, 2], color: '#ffffff', path: parts.join(' '), fill: false, stroke: { color: '#ffffff', width: 4 / 2160 } },
  }]);
}

/** A `cols` × `rows` grid of white dots. */
const dots = (cols: number, rows: number, r: number): SaverSpec => scene([{
  count: cols * rows, layout: { type: 'grid', columns: cols }, motion: { type: 'static' },
  sprite: { kind: 'circle', radius: [r, r], color: '#ffffff' },
}]);

/** `layers` × `count` white discs scattered at random. */
const scatter = (layers: number, count: number, radius: [number, number]): SaverSpec => scene(Array.from({ length: layers }, () => ({
  count, sprite: { kind: 'circle', radius, color: '#ffffff' }, alpha: [0.5, 1], motion: { type: 'static' },
})));

/** A black-and-white noise field, `scale` features across the short side, under one small dot. */
const noiseField = (scale: number, quantize?: number): SaverSpec => ({
  schemaVersion: 1, id: 'f', label: 'F',
  background: { type: 'field', scale, octaves: 3, warp: 0.4, ...(quantize ? { quantize } : {}), bands: ['#000000', '#ffffff'] },
  layers: [{ count: 1, sprite: { kind: 'circle', radius: [0.01, 0.01], color: '#ffffff' }, motion: { type: 'static' } }],
}) as unknown as SaverSpec;

/**
 * The scene a server smoke check (X593) previews as one frame: 36 layers of
 * 22 drifting 24-gons, 792 in all, scattered at random, with a timeline that
 * only resizes them. Not a grating on any seed.
 */
function driftingPolygons(): SaverSpec {
  const poly = (k: number): [number, number] => [+(Math.cos((k / 24) * 6.283) * 0.987654321).toFixed(9), +(Math.sin((k / 24) * 6.283) * 0.912345678).toFixed(9)];
  const L = 36;
  return {
    schemaVersion: 1, id: 'x593', label: 'x593', background: { type: 'solid', color: '#0b1026' },
    layers: Array.from({ length: L }, (_, j) => ({
      key: `l${j}`, count: 22,
      sprite: { kind: 'polygon', points: Array.from({ length: 24 }, (_, k) => poly(k)), radius: [0.01, 0.03], color: '#a0d9ff' },
      alpha: [0.3, 0.8], motion: { type: 'drift', speed: [0.01, 0.03] },
    })),
    timeline: {
      loop: true, duration: 60000,
      keys: Array.from({ length: 252 }, (_, k) => ({ t: Math.floor(k / L) * 8000 + (k % L) * 100, path: `layers.${k % L}.sprite.radius`, value: [0.01 + (k % 7) / 700, 0.03], dur: 3000 })),
    },
  } as unknown as SaverSpec;
}

/** Rasters are fine-grained; under coverage on a loaded machine a sweep takes seconds. */
const HEAVY = 60_000;

const valid = (s: SaverSpec): SaverSpec => {
  expect(validateSpec(structuredClone(s)).errors).toEqual([]);
  return s;
};

describe('patternHazardReport: gratings and bar lists are refused', () => {
  it('a still, frame-filling line grating (≈19 px pitch at 1080p) fails as a pattern', () => {
    const r = patternHazardReport(valid(grating(19.4)));
    expect(r.fails).toBe(true);
    expect(r.kind).toBe('pattern');
    expect(r.area).toBeGreaterThan(0.9);
    expect(r.pairs).toBeGreaterThan(PATTERN_MIN_PAIRS);
    expect(r.pitch).toBeCloseTo(19.4 / 1080, 2);
    expect(r.message).toMatch(/BT\.1702/);
    expect(r.message).toMatch(/To pass/);
  });

  it('the same grating fails at a turned transform and spinning slowly or fast', () => {
    for (const layer of [{ transform: { rotate: 0 } }, { transform: { rotate: 37 } }, { spin: 30 }, { spin: 360 }]) {
      const r = patternHazardReport(valid(grating(19.4, { layer })));
      expect(r.fails, JSON.stringify(layer)).toBe(true);
    }
  }, HEAVY);

  it('forty white bars on black in a list layout fail', () => {
    const r = patternHazardReport(valid(bars(40, 0.025)));
    expect(r.fails).toBe(true);
    expect(r.kind).toBe('pattern');
  });

  it('is resolved at every pitch from 8 px at 1080p up, in any orientation', () => {
    for (const pitch of [8, 12, 20, 60, 120]) {
      for (const rotate of [0, 30, 45, 88]) {
        const r = patternHazardReport(grating(pitch, { layer: { transform: { rotate } } }));
        expect(r.fails, `${pitch} px at ${rotate}°`).toBe(true);
      }
    }
  }, HEAVY);

  it('holds the 8 px floor at in-between angles, and between whole cells at a slant', () => {
    for (const rotate of [10, 20, 60, 75]) {
      expect(patternHazardReport(grating(8, { layer: { transform: { rotate } } })).fails, `8 px at ${rotate}°`).toBe(true);
    }
    for (const pitch of [9, 10, 15, 35]) {
      expect(patternHazardReport(grating(pitch, { layer: { transform: { rotate: 37 } } })).fails, `${pitch} px at 37°`).toBe(true);
    }
  }, HEAVY);

  it('refuses radial, curved and dot patterns: rings, spokes and dot lattices', () => {
    const cases: Array<[string, SaverSpec]> = [
      ['rings 12 px', rings(12)], ['rings 20 px', rings(20)], ['rings 40 px', rings(40)],
      ['48 spokes', spokes(48)], ['72 spokes', spokes(72)], ['120 spokes', spokes(120)],
      ['dots 16 × 9', dots(16, 9, 0.012)], ['dots 20 × 12', dots(20, 12, 0.01)], ['dots 24 × 14', dots(24, 14, 0.008)],
    ];
    for (const [name, s] of cases) {
      const r = patternHazardReport(valid(s));
      expect(r.kind, name).toBe('pattern');
      expect(r.area, name).toBeGreaterThan(0.8);
    }
  }, HEAVY);

  it('refuses a floor in perspective, its spacing growing a few per cent a line', () => {
    for (const growth of [0.02, 0.03]) {
      const r = patternHazardReport(valid(perspective(12, growth)));
      expect(r.kind, `${growth}`).toBe('pattern');
      expect(r.area).toBeGreaterThan(0.9);
    }
  }, HEAVY);
});

describe('patternHazardReport: the BT.1702 thresholds', () => {
  it('counts more than five pairs: six bars fail where five pass', () => {
    // 0.1 apart: five pitches span half the frame's height, well over 40 %.
    expect(patternHazardReport(valid(bars(6, 0.1, 0.03))).fails).toBe(true);
    const five = patternHazardReport(valid(bars(5, 0.1, 0.03)));
    expect(five.fails).toBe(false);
    expect(five.pairs).toBe(0);
  });

  it('needs a flash-level swing (0.1 relative luminance) with the darker side under 0.8', () => {
    // #606060 on #707070: 0.045 apart in linear light.
    expect(patternHazardReport(grating(20, { color: '#606060', bg: '#707070' })).fails).toBe(false);
    // #e0e0e0 on white: 0.25 apart, darker 0.75.
    expect(patternHazardReport(grating(20, { color: '#e0e0e0', bg: '#ffffff' })).fails).toBe(true);
    // #f0f0f0 on white: 0.13 apart, but the darker side is 0.87 (WCAG's flash pair excludes it).
    expect(patternHazardReport(grating(20, { color: '#f0f0f0', bg: '#ffffff' })).fails).toBe(false);
  });

  it('allows a still pattern up to 40 % of the frame', () => {
    const small = patternHazardReport(grating(30, { radius: 0.4 }));
    expect(small.area).toBeGreaterThan(0.25);
    expect(small.area).toBeLessThan(0.4);
    expect(small.fails).toBe(false);
    const large = patternHazardReport(grating(30, { radius: 0.45 }));
    expect(large.area).toBeGreaterThan(0.4);
    expect(large.kind).toBe('pattern');
  });

  it('allows only 25 % once the pattern spins, rocks or bobs', () => {
    for (const layer of [{ spin: 10 }, { rock: { amp: 5, period: 4000 } }, { motion: { type: 'drift', speed: [0.01, 0.01], angle: 90, bob: 0.01 } }]) {
      const r = patternHazardReport(valid(grating(30, { radius: 0.37, layer })));
      expect(r.kind, JSON.stringify(layer)).toBe('moving-pattern');
      expect(r.movingArea).toBeGreaterThan(0.25);
      expect(r.movingArea).toBeLessThanOrEqual(0.4);
    }
  }, HEAVY);

  it('judges a pattern still when only something else moves', () => {
    const s = grating(30, { radius: 0.37 });
    s.layers.push({ count: 30, sprite: { kind: 'circle', radius: [0.004, 0.008], color: '#ffffff' }, alpha: [0.5, 0.9], motion: { type: 'rise', speed: [0.02, 0.05], sway: 0.01 } } as SaverSpec['layers'][number]);
    const r = patternHazardReport(valid(s));
    expect(r.area).toBeGreaterThan(0.25);
    expect(r.fails).toBe(false);
  });

  it('judges one-way flow as still, and refuses it once its forecast flicker passes 3 Hz', () => {
    // 30 px pitch: f = v / pitch = v × 1080 / 30 flashes a second.
    const slow = patternHazardReport(valid(band(30, 0.3, { type: 'drift', speed: [0.05, 0.05], angle: 0 })));
    expect(slow.area).toBeGreaterThan(0.25);
    expect(slow.fails).toBe(false);
    expect(slow.flickerHz).toBeGreaterThan(1.2);
    expect(slow.flickerHz).toBeLessThan(2.4);
    const fast = patternHazardReport(valid(band(30, 0.3, { type: 'drift', speed: [0.2, 0.2], angle: 0 })));
    expect(fast.kind).toBe('flicker');
    expect(fast.flickerHz).toBeGreaterThan(6);
    expect(fast.flickerHz).toBeLessThan(9);
    expect(fast.flickerArea).toBeGreaterThan(0.25);
    expect(fast.message).toMatch(/flickers/);
  }, HEAVY);
});

describe('patternHazardReport: what must not trip it', () => {
  it('passes every shipped example and bundled sequence segment', () => {
    for (const e of SCHEMA_EXAMPLES) expect(patternHazardReport(e.spec).fails, e.id).toBe(false);
    for (const e of EXAMPLE_SEQUENCES) {
      const seq = e.sequence;
      for (const s of [...(seq.bed ? [seq.bed] : []), ...seq.segments.map((g) => g.scene)]) expect(patternHazardReport(s).fails, e.id).toBe(false);
    }
  }, HEAVY);

  it('passes the stored-scene fixtures', () => {
    const scenes: SaverSpec[] = [ambientTidepool, dxMark, timedSunrise].map((s) => s as unknown as SaverSpec);
    for (const seq of [deck, snowWhite, wrapIdent] as unknown as IdleSequence[]) scenes.push(...(seq.bed ? [seq.bed] : []), ...seq.segments.map((g) => g.scene));
    for (const s of scenes) expect(patternHazardReport(s).fails, s.label).toBe(false);
  }, HEAVY);

  it('passes a dense starfield, heavy rain and a page of text', () => {
    const stars = scene([{ count: 400, sprite: { kind: 'circle', radius: [0.001, 0.004], color: '#ffffff' }, alpha: [0.6, 1], motion: { type: 'static' } }]);
    const rain = scene([{ count: 400, sprite: { kind: 'streak', color: '#cfe4ff', width: 0.002, length: [0.03, 0.08] }, alpha: [0.5, 0.9], motion: { type: 'drift', speed: [0.6, 1.2], angle: 100 } }]);
    const text = scene([{
      count: 14, position: { x: 0.1, y: 0.06 }, layout: { type: 'list', gap: 0.065 }, motion: { type: 'static' },
      sprite: { kind: 'text', strings: ['The quick brown fox jumps over the lazy dog, again and again'], color: '#ffffff', font: '600 40px sans-serif', align: 'left' },
    }]);
    for (const s of [stars, rain, text]) {
      const r = patternHazardReport(valid(s));
      expect(r.fails, s.layers[0]!.sprite.kind).toBe(false);
    }
  });

  it('passes a random scatter of 792 drifting polygons on every seed: speckle is not a grating', () => {
    const s = valid(driftingPolygons());
    for (const seed of [42, 1, 7, 3, 99]) {
      const r = patternHazardReport(s, { seed });
      expect(r.fails, `seed ${seed}`).toBe(false);
      expect(r.area, `seed ${seed}`).toBeLessThan(PATTERN_MOVING_AREA);
    }
  }, HEAVY);

  it('passes random scatters from sparse to dense, and noise-field backgrounds', () => {
    const cases: Array<[string, SaverSpec]> = [
      // The two 800-disc scatters of 0.01–0.04 radius read as stripes over 88 % of the frame under a neighbour-only spacing rule.
      ['100 discs', scatter(1, 100, [0.01, 0.03])], ['400 discs', scatter(1, 400, [0.01, 0.03])],
      ['600 discs', scatter(2, 300, [0.008, 0.02])], ['800 discs', scatter(2, 400, [0.01, 0.03])],
      ['800 large discs', scatter(2, 400, [0.015, 0.04])], ['800 small discs', scatter(2, 400, [0.006, 0.015])],
      ['800 specks', scatter(2, 400, [0.003, 0.01])],
      ['noise field, scale 2', noiseField(2)], ['noise field, scale 8', noiseField(8)],
      ['noise field, scale 8, two bands', noiseField(8, 2)], ['noise field, scale 8, six bands', noiseField(8, 6)],
    ];
    for (const [name, s] of cases) {
      const r = patternHazardReport(valid(s));
      expect(r.fails, name).toBe(false);
      expect(r.area, name).toBeLessThan(PATTERN_MOVING_AREA);
    }
  }, HEAVY);

  it('passes a row of six large objects: one pitch deep is not a pattern', () => {
    const row = scene([{
      count: 6, position: { x: 0.12, y: 0.5 }, layout: { type: 'list', direction: 'row', gap: 0.27 }, motion: { type: 'static' },
      sprite: { kind: 'rect', width: [0.18, 0.18], aspect: [1.2, 1.2], color: '#ffffff' },
    }]);
    expect(patternHazardReport(row).fails).toBe(false);
  });
});

describe('patternHazardReport: sampling and cost', () => {
  it('finds a grating keyed in after the base sample time', () => {
    const s = grating(20, { layer: { key: 'g', opacity: 0 } });
    s.timeline = { keys: [{ t: 9000, path: 'g.opacity', value: 1, dur: 1000 }] } as SaverSpec['timeline'];
    valid(s);
    expect(patternSampleTimes(s)).toEqual([5000, 10000]);
    const r = patternHazardReport(s);
    expect(r.fails).toBe(true);
    expect(r.at).toBe(10000);
  });

  it('caps the sample times, keeping the base and the last settle', () => {
    const s = grating(20, { layer: { key: 'g', opacity: 1 } });
    s.timeline = { keys: Array.from({ length: 20 }, (_, i) => ({ t: i * 1000, path: 'g.opacity', value: i % 2 ? 1 : 0.9, dur: 500 })) } as SaverSpec['timeline'];
    const ts = patternSampleTimes(s);
    expect(ts.length).toBe(PATTERN_MAX_SAMPLE_TIMES);
    expect(ts[0]).toBe(5000);
    expect(ts[ts.length - 1]).toBe(19500);
  });

  it('draws one raster for a scene with no stripes, and is deterministic', () => {
    const rain = SCHEMA_EXAMPLES.find((e) => e.id === 'rain')!.spec;
    const a = patternHazardReport(rain);
    expect(a.rasters).toBe(1);
    expect(patternHazardReport(rain)).toEqual(a);
  });

  it('leaves the public luminanceGrid cap at 200 cells a side', () => {
    const g = luminanceGrid(bars(6, 0.1), { cols: 384, rows: 216 });
    expect(g.cols).toBe(200);
    expect(g.rows).toBe(200);
  });
});

describe('layerPatternMotion', () => {
  const layer = (extra: Record<string, unknown>): SaverSpec => scene([{ count: 1, sprite: { kind: 'circle', radius: [0.01, 0.01], color: '#fff' }, motion: { type: 'static' }, ...extra }]);
  it('sorts still, one-way flow and every other motion', () => {
    expect(layerPatternMotion(layer({}), 0)).toBe('static');
    expect(layerPatternMotion(layer({ motion: { type: 'drift', speed: [0.1, 0.1], angle: 30 } }), 0)).toBe('flow');
    expect(layerPatternMotion(layer({ motion: { type: 'rise', speed: [0.1, 0.1] } }), 0)).toBe('flow');
    expect(layerPatternMotion(layer({ motion: { type: 'rise', speed: [0.1, 0.1], sway: 0.01 } }), 0)).toBe('moving');
    expect(layerPatternMotion(layer({ motion: { type: 'drift', speed: [0.1, 0.1], bidirectional: true } }), 0)).toBe('moving');
    expect(layerPatternMotion(layer({ spin: [0, 0] }), 0)).toBe('static');
    expect(layerPatternMotion(layer({ spin: 5 }), 0)).toBe('moving');
    expect(layerPatternMotion(layer({ pulse: { amp: 0.1, period: 2000 } }), 0)).toBe('moving');
    expect(layerPatternMotion(layer({ motion: { type: 'orbit', speed: [10, 10], radius: [0.1, 0.1] } }), 0)).toBe('moving');
    const keyed = layer({ key: 'a', opacity: 1 });
    keyed.timeline = { keys: [{ t: 0, path: 'a.opacity', value: 0.5 }] } as SaverSpec['timeline'];
    expect(layerPatternMotion(keyed, 0)).toBe('moving');
  });
});

describe('stripe runs along one scan line', () => {
  const square = (period: number, n: number, lo = 0, hi = 1): number[] =>
    Array.from({ length: period * n }, (_, i) => (i % period < period / 2 ? hi : lo));

  it('registers a reversal only at the flash swing', () => {
    expect(stripeExtrema(square(6, 8, 0.5, 0.58))).toEqual([]);
    expect(stripeExtrema(square(6, 8, 0.5, 0.61)).length).toBeGreaterThan(10);
  });

  it('counts six light stripes as a run and five as none', () => {
    const six = stripeRuns(stripeExtrema([0, 0, ...square(6, 6), 0, 0]), 0, 'x');
    expect(six.some((r) => r.count === 6 && r.period === 6)).toBe(true);
    expect(stripeRuns(stripeExtrema([0, 0, ...square(6, 5), 0, 0]), 0, 'x')).toEqual([]);
  });

  it('reads a pitch between whole cells as regular, and random spacing as not', () => {
    // 2.4 cells a period, sampled: spacings of 2 and 3.
    const aliased = Array.from({ length: 60 }, (_, i) => ((i / 2.4) % 1 < 0.5 ? 1 : 0));
    expect(stripeRuns(stripeExtrema(aliased), 0, 'x').length).toBeGreaterThan(0);
    const gaps = [3, 11, 4, 19, 6, 2, 14, 5, 23, 3, 9];
    const random: number[] = [];
    for (const g of gaps) random.push(1, ...Array.from({ length: g }, () => 0));
    expect(stripeRuns(stripeExtrema(random), 0, 'x')).toEqual([]);
  });

  // Six stripes at the given spacings, one cell wide, on a dark line.
  const spaced = (gaps: number[]): number[] => {
    const out = [0, 0];
    for (const g of gaps) out.push(1, ...Array.from({ length: g - 1 }, () => 0));
    out.push(1, 0, 0);
    return out;
  };

  it('rejects spacing that wanders, though each spacing is near the one before it', () => {
    // Each step is within a third of the last (a run under a neighbour-only rule), but the
    // spacing doubles over the run: no lattice holds these six stripes.
    expect(stripeRuns(stripeExtrema(spaced([20, 27, 28, 38, 41])), 0, 'x')).toEqual([]);
    // Alternating short and long spacings are not one pitch either (the gaps' centres between them are near enough).
    expect(stripeRuns(stripeExtrema(spaced([10, 5, 10, 6, 7])), 0, 'x').filter((r) => r.light)).toEqual([]);
  });

  it('keeps a lattice with a stripe a little off it, at a whole run and at a run edge', () => {
    const steady = stripeRuns(stripeExtrema(spaced([21, 22, 22, 21, 22, 21, 22, 22])), 0, 'x');
    expect(steady.some((r) => r.light && r.count === 9 && r.period === 22)).toBe(true);
    const edge = stripeRuns(stripeExtrema(spaced([17, 22, 21, 22, 23, 22])), 0, 'x');
    expect(edge.some((r) => r.light && r.count === 6)).toBe(true);
  });
});

/**
 * Whole reports, frozen. The snapshot was written by the scan as merged,
 * before its per-patch medians were computed once instead of once per run;
 * it must still match after any change that is meant to be a pure speed-up.
 * It was re-frozen once, deliberately, when runs became lattice fits rather
 * than neighbour-spacing chains: two values moved, both at a pattern's edge
 * (the spinning disc of stripes lost one 4×4 block, 0.373 → 0.371 of the
 * frame, and two reports name a different, equally long top run, so its
 * contrast moved by under 0.04). Every verdict, kind, pair count and pitch
 * stayed the same.
 * Numbers are rounded to 12 significant digits, as the other baselines are,
 * so a platform's last-ulp trig never fails it while a changed pitch, area or
 * message does.
 */
describe('patternHazardReport: frozen reports', () => {
  const stabilize = (v: unknown): unknown => {
    if (typeof v === 'number') return +v.toPrecision(12);
    if (Array.isArray(v)) return v.map(stabilize);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, stabilize(x)]));
    return v;
  };
  const cases: Array<[string, SaverSpec]> = [
    // The original repro shapes: a full-frame ≈19 px grating still, turned 0° and spinning; lime on near-black; forty bars.
    ['grating 19 px, still', grating(19.4)],
    ['grating 19 px, transform 0°', grating(19.4, { layer: { transform: { rotate: 0 } } })],
    ['grating 19 px, spin 30', grating(19.4, { layer: { spin: 30 } })],
    ['grating 19 px, spin 360', grating(19.4, { layer: { spin: 360 } })],
    ['grating 19 px, lime on near-black', grating(19.4, { color: '#c8ff3a', bg: '#0c0a14' })],
    ['forty bars in a list', bars(40, 0.025)],
    // Slanted stripes: the patch's slant median is not zero.
    ['grating 12 px, turned 37°', grating(12, { layer: { transform: { rotate: 37 } } })],
    ['grating 30 px, turned 45°', grating(30, { layer: { transform: { rotate: 45 } } })],
    // Patterns that pass, so every sample is scanned and the report keeps the most patterned one.
    ['grating 30 px, radius 0.4 (under 40 %)', grating(30, { radius: 0.4 })],
    ['grating 30 px, radius 0.4, turned 30°', grating(30, { radius: 0.4, layer: { transform: { rotate: 30 } } })],
    ['grating 30 px, radius 0.37, spin 10 (moving rescan)', grating(30, { radius: 0.37, layer: { spin: 10 } })],
    ['band 30 px, slow flow (flicker forecast)', band(30, 0.3, { type: 'drift', speed: [0.05, 0.05], angle: 0 })],
    ['band 30 px, fast flow', band(30, 0.3, { type: 'drift', speed: [0.2, 0.2], angle: 0 })],
    ['five bars', bars(5, 0.1, 0.03)],
    ['six bars', bars(6, 0.1, 0.03)],
  ];
  for (const id of ['relay-board', 'rain', 'aquarium', 'lanterns', 'orrery', 'snowfall']) {
    cases.push([`example ${id}`, SCHEMA_EXAMPLES.find((e) => e.id === id)!.spec]);
  }

  it('matches the reports the scan gave when it shipped', () => {
    const reports = Object.fromEntries(cases.map(([name, s]) => [name, stabilize(patternHazardReport(s))]));
    expect(reports).toMatchSnapshot();
  }, HEAVY);
});
