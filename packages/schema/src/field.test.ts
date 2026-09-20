// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Ajv } from 'ajv';
import { createRng, type SaverContext } from '@idle-screens/core';
import schema from '../saver-spec.schema.json';
import { FIELD_BUCKET_MS, FIELD_RASTER_SHORT_SIDE, FIELD_RASTER_SHORT_SIDE_LOW, fieldAt, fieldRgb, fieldRgbAt, fieldSampleTime, hexToRgb255, rgb255Luma } from './field';
import { buildEntities } from './simulate';
import { validateSpec } from './validate';
import { compileSaver } from './compile';
import { luminanceGrid, perceiveScene } from './perceive';
import { adviseSpec } from './advise';
import { backgroundLuma, backgroundRgb, backgroundRgbAt, hexLuma } from './luma';
import { applyDeltasToSpec, lerpSpec, resolveSpecPath, steerablePaths, structuralSignature } from './steer';
import { LIMITS, type FieldBackground, type SaverSpec } from './types';

const BANDS = ['#1b1a3a', '#0078bf', '#00a99d', '#ffe800', '#ff6c2f', '#ff48b0'];

function field(over: Partial<FieldBackground> = {}): FieldBackground {
  return { type: 'field', scale: 2, bands: BANDS, ...over };
}

function spec(over: Partial<SaverSpec> = {}): SaverSpec {
  return {
    schemaVersion: 1,
    id: 'f',
    label: 'F',
    seed: 9,
    layers: [
      { key: 'dots', count: 12, sprite: { kind: 'circle', radius: [0.01, 0.02], color: '#ffffff', soft: true }, motion: { type: 'wander', speed: [0.01, 0.02] }, alpha: [0.3, 0.6], pulse: { amp: 0.2, period: 4000 }, spin: [-10, 10] },
      { count: 3, sprite: { kind: 'rect', width: [0.05, 0.1], color: '#ff0000', colors: ['#ff0000', '#00ff00'] }, motion: { type: 'drift', speed: [0.01, 0.03] } },
    ],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Sampler
// ---------------------------------------------------------------------------

describe('fieldAt — the sampler', () => {
  it('is a pure function: same inputs, same value, on every call', () => {
    const cfg = field({ octaves: 3, warp: 0.4, drift: { period: 20000, amount: 0.5 } });
    const a = Array.from({ length: 50 }, (_, i) => fieldAt(i * 0.037, i * 0.011, i * 250, cfg, 42));
    const b = Array.from({ length: 50 }, (_, i) => fieldAt(i * 0.037, i * 0.011, i * 250, cfg, 42));
    expect(a).toEqual(b);
  });

  it('stays in 0..1 and is finite everywhere, including negative and huge coordinates', () => {
    const cfg = field({ octaves: 4, warp: 1, drift: { period: 10000, amount: 1 } });
    for (const [u, v, t] of [[0, 0, 0], [-3.7, 12.2, 5e6], [1e5, -1e5, 123], [0.5, 0.5, 99999]]) {
      const x = fieldAt(u!, v!, t!, cfg, 1);
      expect(Number.isFinite(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
  });

  it('two seeds give two different fields, and cfg.seed overrides the spec seed', () => {
    const cfg = field();
    const pts = Array.from({ length: 40 }, (_, i) => [((i * 7) % 13) / 8, ((i * 5) % 11) / 8] as const);
    const s1 = pts.map(([u, v]) => fieldAt(u, v, 0, cfg, 1));
    const s2 = pts.map(([u, v]) => fieldAt(u, v, 0, cfg, 2));
    expect(s1).not.toEqual(s2);
    const own = pts.map(([u, v]) => fieldAt(u, v, 0, field({ seed: 2 }), 1));
    expect(own).toEqual(s2);
  });

  it('is continuous: neighbouring samples differ by a small amount, never a jump', () => {
    const cfg = field({ scale: 3, octaves: 2, warp: 0.5 });
    let maxStep = 0;
    for (let i = 0; i < 2000; i++) {
      const u = i / 1000;
      maxStep = Math.max(maxStep, Math.abs(fieldAt(u + 0.001, 0.37, 0, cfg, 7) - fieldAt(u, 0.37, 0, cfg, 7)));
    }
    expect(maxStep).toBeLessThan(0.03);
  });

  it('without drift the field is static in t; with drift it moves and loops exactly every period', () => {
    const still = field();
    expect(fieldAt(0.3, 0.4, 0, still, 5)).toBe(fieldAt(0.3, 0.4, 99999, still, 5));
    const moving = field({ drift: { period: 12000, amount: 0.4 } });
    expect(fieldAt(0.3, 0.4, 0, moving, 5)).not.toBe(fieldAt(0.3, 0.4, 3000, moving, 5));
    expect(fieldAt(0.3, 0.4, 1500, moving, 5)).toBeCloseTo(fieldAt(0.3, 0.4, 1500 + 12000, moving, 5), 9);
  });

  it('drift is slow at the recommended settings: a point moves under a fifth of the range per second', () => {
    const cfg = field({ scale: 2.2, octaves: 3, warp: 0.4, drift: { period: 40000, amount: 0.3 } });
    let maxDelta = 0;
    for (let i = 0; i < 300; i++) {
      const u = (i % 20) / 12;
      const v = Math.floor(i / 20) / 12;
      for (let t = 0; t < 40000; t += 1000) {
        maxDelta = Math.max(maxDelta, Math.abs(fieldAt(u, v, t + 1000, cfg, 3) - fieldAt(u, v, t, cfg, 3)));
      }
    }
    expect(maxDelta).toBeLessThan(0.35);
  });

  it('cannot flash even at the extremes: the frame mean makes under one opposing ≥ 10 % transition per second', () => {
    // WCAG 2.3.1 fails at three or more flashes (pairs of opposing luminance
    // transitions of ≥ 10 %) per second over a large area. The worst field for
    // that is the one whose features are bigger than the frame (`scale: 0.5`,
    // so the whole screen breathes as one) driven at the 10 s floor with the
    // maximum travel: the domain crosses at most a few base-octave hills per
    // loop, so the frame mean oscillates well under 1 Hz. Measured here on the
    // frame mean sampled every 100 ms across one full loop, three seeds.
    const cfg = field({ scale: 0.5, octaves: 1, drift: { period: LIMITS.minDriftPeriod, amount: 1 } });
    for (const seed of [1, 2, 3]) {
      const frameMean = (t: number): number => {
        let sum = 0;
        for (let r = 0; r < 18; r++) for (let c = 0; c < 32; c++) sum += rgb255Luma(fieldRgbAt((c + 0.5) / 18, (r + 0.5) / 18, t, cfg, seed));
        return sum / (18 * 32);
      };
      const samples = Array.from({ length: LIMITS.minDriftPeriod / 100 + 1 }, (_, i) => frameMean(i * 100));
      // Count opposing transitions of at least 0.1 between successive local extrema.
      let transitions = 0;
      let anchor = samples[0]!;
      let dir = 0;
      for (const v of samples) {
        const d = v - anchor;
        if (dir === 0) { if (Math.abs(d) >= 0.1) { dir = Math.sign(d); anchor = v; transitions++; } }
        else if (Math.sign(d) === dir) anchor = v; // still climbing/falling: track the extreme
        else if (Math.abs(d) >= 0.1) { dir = -dir; anchor = v; transitions++; }
      }
      const perSecond = transitions / (LIMITS.minDriftPeriod / 1000);
      expect(perSecond, `seed ${seed}`).toBeLessThan(1);
    }
  });

  it('octaves round and clamp (a steered octaves gliding through 2.4 reads as 2)', () => {
    const p = [0.31, 0.62, 0] as const;
    expect(fieldAt(...p, field({ octaves: 2.4 }), 1)).toBe(fieldAt(...p, field({ octaves: 2 }), 1));
    expect(fieldAt(...p, field({ octaves: 2.6 }), 1)).toBe(fieldAt(...p, field({ octaves: 3 }), 1));
  });

  it('fieldSampleTime buckets a drifting field to 100 ms and pins a static one to 0', () => {
    expect(fieldSampleTime(field(), 8765)).toBe(0);
    const d = field({ drift: { period: 20000 } });
    expect(fieldSampleTime(d, 0)).toBe(0);
    expect(fieldSampleTime(d, 99)).toBe(0);
    expect(fieldSampleTime(d, 100)).toBe(FIELD_BUCKET_MS);
    expect(fieldSampleTime(d, 8765)).toBe(8700);
  });
});

describe('fieldRgb — bands and quantise', () => {
  it('quantize === bands.length (the default) paints exactly one band per level, byte-exact', () => {
    const n = BANDS.length;
    for (let level = 0; level < n; level++) {
      const v = (level + 0.5) / n;
      expect(fieldRgb(v, BANDS, undefined)).toEqual(hexToRgb255(BANDS[level]!));
      expect(fieldRgb(v, BANDS, n)).toEqual(hexToRgb255(BANDS[level]!));
    }
    expect(fieldRgb(1, BANDS, undefined)).toEqual(hexToRgb255(BANDS[n - 1]!)); // the top edge belongs to the last band
    expect(fieldRgb(0, BANDS, undefined)).toEqual(hexToRgb255(BANDS[0]!));
  });

  it('quantize: 0 interpolates the ramp; quantize above bands.length posterises the ramp', () => {
    expect(fieldRgb(0.5, ['#000000', '#ffffff'], 0)).toEqual([128, 128, 128]);
    expect(fieldRgb(0.25, ['#000000', '#ffffff'], 0)).toEqual([64, 64, 64]);
    // 4 levels through a 2-band ramp: 0, 85, 170, 255.
    const greys = [0.1, 0.3, 0.6, 0.9].map((v) => fieldRgb(v, ['#000000', '#ffffff'], 4)[0]);
    expect(greys).toEqual([0, 85, 170, 255]);
    // A fractional quantize (steered mid-glide) rounds.
    expect(fieldRgb(0.3, ['#000000', '#ffffff'], 3.6)).toEqual(fieldRgb(0.3, ['#000000', '#ffffff'], 4));
  });

  it('hexToRgb255 expands #rgb and rgb255Luma matches the perceptual weights', () => {
    expect(hexToRgb255('#f08')).toEqual([255, 0, 136]);
    expect(rgb255Luma([255, 255, 255])).toBeCloseTo(1, 9);
    expect(rgb255Luma([0, 255, 0])).toBeCloseTo(0.7152, 9);
  });

  it('hexToRgb255 falls back to mid grey for malformed input, including a valid hex prefix `parseInt` would otherwise accept', () => {
    expect(hexToRgb255('#zzzzzz')).toEqual([128, 128, 128]);
    // A truncated 6-digit string: parseInt('12', 16) silently succeeds on the
    // leading valid digits unless the full string is validated first.
    expect(hexToRgb255('#12zzzz')).toEqual([128, 128, 128]);
  });

  it('fieldRgbAt composes the two', () => {
    const cfg = field();
    expect(fieldRgbAt(0.2, 0.7, 0, cfg, 4)).toEqual(fieldRgb(fieldAt(0.2, 0.7, 0, cfg, 4), BANDS, undefined));
  });
});

// ---------------------------------------------------------------------------
// The entity stream is untouched — the sampler never draws from the spec RNG.
// ---------------------------------------------------------------------------

describe('a field background leaves the entity stream byte-identical', () => {
  const stream = (s: SaverSpec): unknown => {
    const rng = createRng(s.seed ?? 42);
    return JSON.parse(JSON.stringify(s.layers.map((l) => buildEntities(l, rng, 1920, 1080, 1080, 1))));
  };

  it('with and without the field (and with a field seed of its own)', () => {
    const plain = stream(spec({ background: { type: 'solid', color: '#000000' } }));
    expect(stream(spec({ background: field() }))).toEqual(plain);
    expect(stream(spec({ background: field({ seed: 123, warp: 1, drift: { period: 10000 }, quantize: 0 }) }))).toEqual(plain);
    expect(stream(spec({ background: undefined }))).toEqual(plain);
  });
});

// ---------------------------------------------------------------------------
// Validator + JSON schema
// ---------------------------------------------------------------------------

describe('validateSpec — field background', () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const check = ajv.compile(schema);
  const errPaths = (bg: unknown): string[] => validateSpec({ ...spec(), background: bg }).errors.map((e) => e.path);
  const warnPaths = (bg: unknown): string[] => (validateSpec({ ...spec(), background: bg }).warnings ?? []).map((w) => w.path);
  const both = (bg: unknown): { runtime: boolean; json: boolean } => ({
    runtime: validateSpec({ ...spec(), background: bg }).valid,
    json: check({ ...spec(), background: bg }) as boolean,
  });

  it('accepts a complete field on both validators, with zero warnings', () => {
    const bg = field({ octaves: 3, warp: 0.4, quantize: 6, drift: { period: 40000, amount: 0.3 }, seed: 5 });
    expect(validateSpec({ ...spec(), background: bg })).toEqual({ valid: true, errors: [], warnings: [] });
    expect(both(bg)).toEqual({ runtime: true, json: true });
    expect(both(field())).toEqual({ runtime: true, json: true });
    expect(both(field({ quantize: 0 }))).toEqual({ runtime: true, json: true });
  });

  it('bounds every knob (runtime and JSON schema agree)', () => {
    const bad: Array<[unknown, string]> = [
      [field({ scale: 0.4 }), 'background.scale'],
      [field({ scale: 8.5 }), 'background.scale'],
      [{ type: 'field', bands: BANDS }, 'background.scale'],
      [field({ octaves: 0 }), 'background.octaves'],
      [field({ octaves: 5 }), 'background.octaves'],
      [field({ octaves: 2.5 }), 'background.octaves'],
      [field({ warp: -0.1 }), 'background.warp'],
      [field({ warp: 1.1 }), 'background.warp'],
      [field({ quantize: 1 }), 'background.quantize'],
      [field({ quantize: 9 }), 'background.quantize'],
      [field({ quantize: 2.5 }), 'background.quantize'],
      [field({ bands: ['#000'] }), 'background.bands'],
      [field({ bands: Array.from({ length: 9 }, () => '#000') }), 'background.bands'],
      [field({ bands: ['#000', 'blue'] }), 'background.bands[1]'],
      [field({ drift: { period: 9999 } }), 'background.drift.period'],
      [field({ drift: { period: 10000, amount: 1.5 } }), 'background.drift.amount'],
      [field({ drift: { period: 10000, amount: -1 } }), 'background.drift.amount'],
      [field({ seed: 'x' as unknown as number }), 'background.seed'],
    ];
    for (const [bg, path] of bad) {
      expect(errPaths(bg), JSON.stringify(bg)).toContain(path);
      expect(check({ ...spec(), background: bg }), JSON.stringify(bg)).toBe(false);
    }
  });

  it('floors drift.period at LIMITS.minDriftPeriod — the flash guard', () => {
    expect(errPaths(field({ drift: { period: LIMITS.minDriftPeriod } }))).toEqual([]);
    expect(errPaths(field({ drift: { period: LIMITS.minDriftPeriod - 1 } }))).toContain('background.drift.period');
  });

  it('warns (never errors) on unknown field and drift properties, like the other backgrounds', () => {
    const r = validateSpec({ ...spec(), background: { ...field(), noise: 'simplex', drift: { period: 20000, speed: 2 } } });
    expect(r.valid).toBe(true);
    expect(warnPaths({ ...field(), noise: 'simplex', drift: { period: 20000, speed: 2 } })).toEqual(['background.drift.speed', 'background.noise']);
  });

  it('names the third type in the type error', () => {
    expect(validateSpec({ ...spec(), background: { type: 'noise' } }).errors[0]!.message).toBe('must be solid | gradient | field');
  });

  it('exposes the field limits', () => {
    expect(LIMITS.minFieldScale).toBe(0.5);
    expect(LIMITS.maxFieldScale).toBe(8);
    expect(LIMITS.maxFieldOctaves).toBe(4);
    expect(LIMITS.maxFieldBands).toBe(8);
    expect(FIELD_RASTER_SHORT_SIDE).toBe(96);
    expect(FIELD_RASTER_SHORT_SIDE_LOW).toBe(48);
  });
});

// ---------------------------------------------------------------------------
// Perception: the grid samples the same function; the field is ground, not ink
// ---------------------------------------------------------------------------

describe('luminanceGrid — field background', () => {
  const empty = (bg: FieldBackground, t?: number) => luminanceGrid(spec({ background: bg, layers: [] }), { viewport: { width: 1920, height: 1080 }, ...(t !== undefined ? { t } : {}) });

  it('every cell is the luma of the band the renderer paints at that cell centre (parity with fieldRgbAt)', () => {
    const bg = field({ octaves: 3, warp: 0.4, quantize: 6, drift: { period: 40000, amount: 0.3 } });
    const g = empty(bg, 12345);
    const short = 1080;
    const bandLumas = BANDS.map(hexLuma);
    for (let r = 0; r < g.rows; r += 7) {
      for (let c = 0; c < g.cols; c += 11) {
        const u = ((c + 0.5) * 1920) / g.cols / short;
        const v = ((r + 0.5) * 1080) / g.rows / short;
        const expected = rgb255Luma(fieldRgbAt(u, v, fieldSampleTime(bg, 12345), bg, 9));
        expect(g.cells[r * g.cols + c]).toBe(expected);
        // Quantised: the cell IS one of the bands.
        expect(bandLumas.some((b) => Math.abs(b - expected) < 1e-12)).toBe(true);
      }
    }
  });

  it('samples at the renderer\'s bucketed time, so t = 8765 and t = 8700 agree while t = 8800 differs', () => {
    const bg = field({ drift: { period: 20000, amount: 0.5 } });
    expect(empty(bg, 8765).cells).toEqual(empty(bg, 8700).cells);
    expect(empty(bg, 8765).cells).not.toEqual(empty(bg, 8800).cells);
  });

  it('a field alone is ground: coverage 0, no centroid, flat profiles — and backgroundCells carries the 2-D ground', () => {
    const g = empty(field({ quantize: 6 }));
    expect(g.coverage).toBe(0);
    expect(g.centroid).toBeNull();
    expect(g.rowProfile.every((v) => v === 0)).toBe(true);
    expect(g.backgroundCells).toHaveLength(g.cols * g.rows);
    expect(g.backgroundCells).toEqual(g.cells);
    // `background` (per row) is each row's mean — informational, as before.
    for (let r = 0; r < g.rows; r++) {
      const row = g.cells.slice(r * g.cols, (r + 1) * g.cols);
      expect(g.background[r]).toBeCloseTo(row.reduce((a, b) => a + b, 0) / g.cols, 9);
    }
    // The field's mean luminance sits near the mean band — no bias from the bands' order.
    expect(g.meanLuminance).toBeGreaterThan(0.3);
    expect(g.meanLuminance).toBeLessThan(0.8);
  });

  it('normalizes seed 0 to 1 for a field background, matching the renderer\'s normalizeSeed(spec.seed ?? ctx.seed)', () => {
    const bg = field({ quantize: 6 });
    const zero = luminanceGrid(spec({ seed: 0, background: bg, layers: [] }), { viewport: { width: 1920, height: 1080 } });
    const one = luminanceGrid(spec({ seed: 1, background: bg, layers: [] }), { viewport: { width: 1920, height: 1080 } });
    // Before the fix, `seed: 0` sampled the field with the raw seed 0 — a
    // different (and renderer-mismatched) stream from the normalized seed 1
    // `SpecInstance` actually renders with.
    expect(zero.cells).toEqual(one.cells);
  });

  it('solid and gradient grids carry no backgroundCells (their output is byte-identical to before)', () => {
    expect('backgroundCells' in luminanceGrid(spec({ background: { type: 'solid', color: '#000000' } }))).toBe(false);
    expect('backgroundCells' in luminanceGrid(spec({ background: { type: 'gradient', stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#404040' }] } }))).toBe(false);
  });

  it('ink over a field deviates from the field under it, not from the row mean', () => {
    const s = spec({
      background: field({ quantize: 6 }),
      layers: [{ count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'circle', radius: [0.08, 0.08], color: '#ffffff' }, motion: { type: 'static' } }],
    });
    const g = luminanceGrid(s, { viewport: { width: 1920, height: 1080 } });
    expect(g.coverage).toBeGreaterThan(0.005);
    expect(g.coverage).toBeLessThan(0.1);
    expect(g.centroid!.x).toBeCloseTo(0.5, 1);
    expect(g.centroid!.y).toBeCloseTo(0.5, 1);
    expect(() => perceiveScene(s)).not.toThrow();
  });
});

describe('luma helpers — field background', () => {
  it('backgroundLuma / backgroundRgb average the bands, as a gradient averages its stops', () => {
    const s = spec({ background: field() });
    expect(backgroundLuma(s)).toBeCloseTo(BANDS.reduce((a, c) => a + hexLuma(c), 0) / BANDS.length, 12);
    const rgb = backgroundRgb(s);
    expect(rgb.r).toBeGreaterThan(0);
    expect(rgb.r).toBeLessThan(1);
  });

  it('backgroundRgbAt samples the field at the point when x is given, and reads the mean otherwise', () => {
    const s = spec({ background: field({ quantize: 6 }) });
    const at = backgroundRgbAt(s, 540, 1080, 1080, 960, 1920);
    const expected = fieldRgbAt(960 / 1080, 540 / 1080, 0, s.background as FieldBackground, 9);
    expect([at.r, at.g, at.b]).toEqual([expected[0] / 255, expected[1] / 255, expected[2] / 255]);
    expect(backgroundRgbAt(s, 540, 1080, 1080)).toEqual(backgroundRgb(s));
  });

  it('backgroundRgbAt samples a drifting field at the bucketed `t` given, not always its rest position at t 0', () => {
    const s = spec({ background: field({ quantize: 6, drift: { amount: 1, period: 20000 } }) });
    const bg = s.background as FieldBackground;
    const t = 12345;
    const rest = backgroundRgbAt(s, 540, 1080, 1080, 960, 1920, undefined, 0);
    const atT = backgroundRgbAt(s, 540, 1080, 1080, 960, 1920, undefined, t);
    expect(atT).not.toEqual(rest); // the domain has visibly moved by t
    const expected = fieldRgbAt(960 / 1080, 540 / 1080, fieldSampleTime(bg, t), bg, 9);
    expect([atT.r, atT.g, atT.b]).toEqual([expected[0] / 255, expected[1] / 255, expected[2] / 255]);
    // Omitting `t` still defaults to the rest position, unchanged.
    expect(backgroundRgbAt(s, 540, 1080, 1080, 960, 1920)).toEqual(rest);
  });
});

describe('adviseSpec — field background', () => {
  it('a bright field is not content: a near-empty scene over one still fires sparse-scene', () => {
    const s = spec({
      background: field({ bands: ['#f0f0f0', '#ffffff'] }),
      layers: [{ count: 1, sprite: { kind: 'circle', radius: [0.0005, 0.0005], color: '#000000' }, motion: { type: 'static' }, alpha: [0.1, 0.1] }],
    });
    expect(adviseSpec(s).map((w) => w.code)).toContain('sparse-scene');
  });

  it('a layer painted the field\'s mean colour is low-contrast against it, exactly as against a gradient', () => {
    const s = spec({
      background: field({ bands: ['#404040', '#404040', '#404040'] }),
      layers: [{ count: 30, sprite: { kind: 'circle', radius: [0.02, 0.04], color: '#404040' }, motion: { type: 'static' } }],
    });
    expect(adviseSpec(s).map((w) => w.code)).toContain('low-contrast-layer');
  });

  it('a read-role textBlock over a field is judged against the field colour under its box', () => {
    // Dark text over a field whose bands are all dark: illegible, and it must say so.
    const s = spec({
      background: field({ bands: ['#101010', '#181818'] }),
      layers: [{ count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'textBlock', text: 'READ ME', maxWidth: 0.5, fontSize: 0.05, color: '#202020', role: 'read', anchor: 'center' }, motion: { type: 'static' } }],
    });
    expect(adviseSpec(s).map((w) => w.code)).toContain('text-legibility');
  });

  it('text-legibility over a drifting field reacts to opts.t (the perceived frame), not always the field\'s rest position', () => {
    const s = spec({
      background: field({ bands: ['#000000', '#ffffff'], quantize: 2, drift: { amount: 1, period: 4000 } }),
      layers: [{ count: 1, position: { x: 0.5, y: 0.5 }, sprite: { kind: 'textBlock', text: 'READ ME', maxWidth: 0.5, fontSize: 0.05, color: '#808080', role: 'read', anchor: 'center' }, motion: { type: 'static' } }],
    });
    const codesAt = (t: number): string[] => adviseSpec(s, undefined, { t }).map((w) => w.code);
    const samples = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500].map(codesAt);
    // Before the fix, every sample used the field's rest position (t 0) regardless
    // of opts.t, so they were all identical. The drift must move the sampled
    // colour enough over one period to flip the verdict at least once.
    expect(new Set(samples.map((c) => JSON.stringify(c))).size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Steering
// ---------------------------------------------------------------------------

describe('steering — field background', () => {
  const s = spec({ background: field({ octaves: 2, warp: 0.4, quantize: 6, drift: { period: 20000, amount: 0.3 }, seed: 5 }) });

  it('bands are indexed hex paint paths; every numeric knob is a path; seed is not', () => {
    const paths = steerablePaths(s);
    expect(paths).toEqual(expect.arrayContaining(['background.scale', 'background.octaves', 'background.warp', 'background.quantize', 'background.bands.0', 'background.bands.5', 'background.drift.period', 'background.drift.amount']));
    expect(paths).not.toContain('background.bands');
    expect(paths).not.toContain('background.seed');
    expect(resolveSpecPath(s, 'background.bands.2')?.key).toBe(2);
    expect(resolveSpecPath(s, 'background.bands.6')).toBeNull();
  });

  it('applyDeltasToSpec lands on a band and a knob, and the result validates', () => {
    const next = applyDeltasToSpec(s, [
      { t: 0, path: 'background.bands.1', value: '#123456' },
      { t: 0, path: 'background.scale', value: 4 },
    ]);
    expect((next.background as FieldBackground).bands[1]).toBe('#123456');
    expect((next.background as FieldBackground).scale).toBe(4);
    expect(validateSpec(next).valid).toBe(true);
  });

  it('lerpSpec glides bands (per channel) and scale between two field specs — a morph glides the field', () => {
    const to = applyDeltasToSpec(s, [{ t: 0, path: 'background.bands.0', value: '#ffffff' }, { t: 0, path: 'background.scale', value: 4 }]);
    const mid = lerpSpec(s, to, 0.5).background as FieldBackground;
    expect(mid.scale).toBe(3);
    expect(mid.bands[0]).not.toBe(BANDS[0]);
    expect(mid.bands[0]).not.toBe('#ffffff');
    expect(mid.bands[1]).toBe(BANDS[1]);
  });

  it('the background is paint: swapping a gradient for a field leaves the structural signature unchanged', () => {
    const grad = spec({ background: { type: 'gradient', stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#ffffff' }] } });
    expect(structuralSignature(s)).toBe(structuralSignature(grad));
  });
});

// ---------------------------------------------------------------------------
// Renderer: raster cache, tier, smoothing
// ---------------------------------------------------------------------------

interface Recorded {
  ctx: CanvasRenderingContext2D;
  imageDataDims: Array<[number, number]>;
  putImageData: number;
  drawImages: Array<{ smoothing: boolean; w: number; h: number }>;
  fills: string[];
}

function recordingContext(): Recorded {
  const rec: Recorded = { ctx: null as unknown as CanvasRenderingContext2D, imageDataDims: [], putImageData: 0, drawImages: [], fills: [] };
  const ctx = {
    fillRect: vi.fn(function (this: { fillStyle: string }) { rec.fills.push(this.fillStyle); }),
    fillText: vi.fn(), measureText: vi.fn(() => ({ width: 8 })), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    scale: vi.fn(), setTransform: vi.fn(), clearRect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createImageData: vi.fn((w: number, h: number) => { rec.imageDataDims.push([w, h]); return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }),
    putImageData: vi.fn(() => { rec.putImageData++; }),
    drawImage: vi.fn(function (this: { imageSmoothingEnabled: boolean }, _img: unknown, _x: number, _y: number, w: number, h: number) {
      rec.drawImages.push({ smoothing: this.imageSmoothingEnabled, w, h });
    }),
    imageSmoothingEnabled: true,
    fillStyle: '', strokeStyle: '', globalAlpha: 1, globalCompositeOperation: 'source-over', font: '', textAlign: 'center', textBaseline: 'middle', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
  } as unknown as CanvasRenderingContext2D;
  rec.ctx = ctx;
  return rec;
}

let rec: Recorded;
let origGetContext: HTMLCanvasElement['getContext'];

beforeEach(() => {
  rec = recordingContext();
  origGetContext = HTMLCanvasElement.prototype.getContext;
  // Every canvas — the visible one and the raster — shares the recorder.
  HTMLCanvasElement.prototype.getContext = (() => rec.ctx) as unknown as HTMLCanvasElement['getContext'];
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext;
});

function saverCtx(over: Partial<SaverContext> & { capabilityTier?: 'minimal' | 'basic' | 'standard' | 'high' } = {}): SaverContext {
  return { host: document.createElement('div'), dpr: 1, width: 1920, height: 1080, rng: createRng(1), seed: 1, reducedMotion: true, ...over };
}

function mount(s: SaverSpec, ctx: SaverContext = saverCtx()) {
  const inst = compileSaver(s).mount(ctx);
  if (inst instanceof Promise) throw new Error('sync mount expected');
  return inst;
}

describe('SpecInstance — field raster', () => {
  it('rasters at a 96 px short side (long side by aspect), draws it scaled to the canvas, and never fills the ground with a colour', () => {
    const inst = mount(spec({ background: field() }));
    expect(rec.imageDataDims).toEqual([[Math.round((96 * 1920) / 1080), 96]]);
    expect(rec.drawImages).toEqual([{ smoothing: false, w: 1920, h: 1080 }]);
    // No solid/gradient ground: the only fills are entity draws (rects), none with a background colour.
    expect(rec.fills).not.toContain('#05050a');
    inst.dispose();
  });

  it('a static field is sampled ONCE per mount, however many frames are painted', () => {
    const inst = mount(spec({ background: field() }));
    for (const t of [0, 16, 500, 4000, 60000, 3]) inst.renderFrame!(t, 1);
    expect(rec.putImageData).toBe(1);
    expect(rec.drawImages).toHaveLength(7); // constructor paint + 6 frames
    inst.dispose();
  });

  it('a drifting field is resampled only when t crosses a 100 ms bucket', () => {
    const inst = mount(spec({ background: field({ drift: { period: 20000, amount: 0.3 } }) }));
    expect(rec.putImageData).toBe(1); // t = 0 at construction
    inst.renderFrame!(16, 1);
    inst.renderFrame!(99, 1);
    expect(rec.putImageData).toBe(1); // same bucket
    inst.renderFrame!(100, 1);
    expect(rec.putImageData).toBe(2);
    inst.renderFrame!(150, 1);
    inst.renderFrame!(199, 1);
    expect(rec.putImageData).toBe(2);
    inst.renderFrame!(1234, 1);
    expect(rec.putImageData).toBe(3);
    inst.renderFrame!(1234, 1); // same frame again: cached
    expect(rec.putImageData).toBe(3);
    inst.dispose();
  });

  it('a resize re-rasters at the new aspect; a steered knob re-rasters on the next frame', () => {
    const inst = mount(spec({ background: field() }));
    inst.resize(1080, 1080);
    expect(rec.imageDataDims.at(-1)).toEqual([96, 96]);
    const before = rec.putImageData;
    inst.applyTrack!({ deltas: [{ t: 0, path: 'background.scale', value: 3, dur: 0 }] } as never);
    expect(rec.putImageData).toBeGreaterThan(before); // paused: the steer paints immediately at the new scale
    inst.dispose();
  });

  it('quantised bands draw nearest-neighbour; quantize: 0 draws smoothed', () => {
    const hard = mount(spec({ background: field({ quantize: 4 }) }));
    expect(rec.drawImages[0]!.smoothing).toBe(false);
    hard.dispose();
    const soft = mount(spec({ background: field({ quantize: 0 }) }));
    expect(rec.drawImages.at(-1)!.smoothing).toBe(true);
    soft.dispose();
    // The smoothing flag is restored after the draw so entity draws are unaffected.
    expect((rec.ctx as unknown as { imageSmoothingEnabled: boolean }).imageSmoothingEnabled).toBe(true);
  });

  it("the 'basic' and 'minimal' tiers raster at a 48 px short side; other tiers and absent at 96", () => {
    for (const tier of ['basic', 'minimal'] as const) {
      rec = recordingContext();
      HTMLCanvasElement.prototype.getContext = (() => rec.ctx) as unknown as HTMLCanvasElement['getContext'];
      const inst = mount(spec({ background: field() }), saverCtx({ capabilityTier: tier }));
      expect(rec.imageDataDims[0]).toEqual([Math.round((48 * 1920) / 1080), 48]);
      inst.dispose();
    }
    for (const tier of ['standard', 'high', undefined] as const) {
      rec = recordingContext();
      HTMLCanvasElement.prototype.getContext = (() => rec.ctx) as unknown as HTMLCanvasElement['getContext'];
      const inst = mount(spec({ background: field() }), saverCtx(tier ? { capabilityTier: tier } : {}));
      expect(rec.imageDataDims[0]![1]).toBe(96);
      inst.dispose();
    }
  });

  it('the raster pixels are the sampler, cell for cell', () => {
    // Capture the ImageData the renderer filled and compare a few cells to fieldRgbAt at the cell centre.
    let filled: { width: number; height: number; data: Uint8ClampedArray } | null = null;
    (rec.ctx.putImageData as unknown as { mockImplementation: (f: (img: never) => void) => void }).mockImplementation((img: never) => { filled = img; rec.putImageData++; });
    const s = spec({ background: field({ octaves: 2, warp: 0.3 }), seed: 21 });
    const inst = mount(s);
    const img = filled as unknown as { width: number; height: number; data: Uint8ClampedArray };
    const short = 1080;
    for (const [c, r] of [[0, 0], [17, 5], [100, 95], [img.width - 1, img.height - 1]] as const) {
      const rgb = fieldRgbAt(((c + 0.5) * 1920) / img.width / short, ((r + 0.5) * 1080) / img.height / short, 0, s.background as FieldBackground, 21);
      const i = (r * img.width + c) * 4;
      expect([img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]).toEqual([...rgb, 255]);
    }
    inst.dispose();
  });

  it('solid and gradient backgrounds never touch the raster path', () => {
    const solid = mount(spec({ background: { type: 'solid', color: '#102030' } }));
    const grad = mount(spec({ background: { type: 'gradient', stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#ffffff' }] } }));
    expect(rec.imageDataDims).toEqual([]);
    expect(rec.drawImages).toEqual([]);
    expect(rec.fills).toContain('#102030');
    solid.dispose();
    grad.dispose();
  });

  it('dispose drops the raster', () => {
    const inst = mount(spec({ background: field() }));
    expect((inst as unknown as { field: unknown }).field).not.toBeNull();
    inst.dispose();
    expect((inst as unknown as { field: unknown }).field).toBeNull();
  });
});
