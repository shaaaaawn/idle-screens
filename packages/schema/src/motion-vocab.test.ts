import { describe, it, expect } from 'vitest';
import { drawSpan, strokeDrawnAt, strokeOutline, pathLength, pathParts, partInkArea, strokeDrawnSamples, strokeSamples, trimLines, trimPolyline } from './shapes';
import { validateSpec } from './validate';
import { luminanceGrid } from './perceive';
import { createRng } from '@idle-screens/core';
import { buildEntities, lifeAlphaAt, lifeStaggerAt, rotationAt, textBlockText } from './simulate';
import { periodWithoutTimeline, scenePeriod } from './period';
import { adviseSequence, adviseSpec } from './advise';
import { validateSequence } from './validate';
import { wipeMask } from './compile';
import { textSprites } from './perceive';
import { easeGlide, easeSmooth, steerablePaths, structuralSignature, textStringsDiffer } from './steer';
import { resolveTimelineAt } from './timeline';
import type { LayerSpec, SaverSpec } from './types';

const scene = (layers: LayerSpec[], extra: Partial<SaverSpec> = {}): SaverSpec => ({
  schemaVersion: 1,
  id: 'vocab',
  label: 'Vocab',
  background: { type: 'solid', color: '#000000' },
  layers,
  ...extra,
});

const line = (draw?: { start?: number; end?: number }): LayerSpec => ({
  count: 1,
  position: { x: 0.5, y: 0.5 },
  motion: { type: 'static' },
  sprite: {
    kind: 'stroke',
    length: [0.8, 0.8],
    points: [[-1, 0], [1, 0]],
    curve: 'linear',
    width: 0.02,
    color: '#ffffff',
    ...(draw ? { draw } : {}),
  },
});

describe('draw-on (stroke.draw / path stroke.draw)', () => {
  it('drawSpan is null for the whole line and clamps otherwise', () => {
    expect(drawSpan(undefined)).toBeNull();
    expect(drawSpan({})).toBeNull();
    expect(drawSpan({ start: 0, end: 1 })).toBeNull();
    expect(drawSpan({ end: 0.4 })).toEqual([0, 0.4]);
    expect(drawSpan({ start: 0.2 })).toEqual([0.2, 1]);
  });

  it('trimPolyline cuts by arc length with interpolated endpoints', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    const half = trimPolyline(pts, 0, 0.5);
    expect(half).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const mid = trimPolyline(pts, 0.25, 0.75);
    expect(mid[0]).toEqual({ x: 5, y: 0 });
    expect(mid[mid.length - 1]).toEqual({ x: 10, y: 5 });
    expect(pathLength(mid)).toBeCloseTo(10, 6);
    expect(trimPolyline(pts, 0.6, 0.6)).toEqual([]);
    expect(trimPolyline(pts, 0.8, 0.2)).toEqual([]);
  });

  it('trimLines runs through subpaths in order and opens a cut ring', () => {
    const lines = [
      { points: [[0, 0], [1, 0]] as Array<[number, number]>, closed: false },
      { points: [[0, 1], [1, 1], [1, 2], [0, 2]] as Array<[number, number]>, closed: true },
    ];
    // Total length 1 + 4 = 5: end 0.2 is the whole first line, nothing of the ring.
    expect(trimLines(lines, 0, 0.2)).toEqual([lines[0]]);
    const more = trimLines(lines, 0, 0.6);
    expect(more).toHaveLength(2);
    expect(more[1]!.closed).toBe(false);
    expect(trimLines(lines, 0, 1)).toEqual(lines);
  });

  it('a stroke sprite paints its draw span; ink scales with it', () => {
    const full = strokeSamples(line().sprite as never, 100);
    const half = strokeDrawnSamples(line({ end: 0.5 }).sprite as never, 100);
    expect(pathLength(half)).toBeCloseTo(pathLength(full) / 2, 3);
    const lit = (s: SaverSpec): number => luminanceGrid(s, { viewport: { width: 960, height: 540 } }).coverage;
    const a = lit(scene([line()]));
    const b = lit(scene([line({ end: 0.5 })]));
    const c = lit(scene([line({ end: 0 })]));
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(a);
    expect(c).toBe(0);
  });

  it('a tapered mark keeps its width as it is revealed (the taper belongs to the whole mark)', () => {
    const sprite = line({ end: 0.5 }).sprite as never;
    const drawn = strokeDrawnSamples(sprite, 100);
    const at = strokeDrawnAt(sprite, 100, drawn)!;
    expect(at[0]).toBeCloseTo(0, 6);
    expect(at[at.length - 1]).toBeCloseTo(0.5, 2); // half the mark: the far end is mid-brush, not the thin tip
    expect(strokeDrawnAt(line().sprite as never, 100, drawn)).toBeUndefined(); // no draw: unchanged index taper
    // The revealed half's outline is the first half of the full mark's, not a re-tapered whole.
    const full = strokeOutline(strokeSamples(line().sprite as never, 100), 10);
    const widthAt = (o: Array<{ x: number; y: number }>, x: number): number => {
      const near = o.filter((p) => Math.abs(p.x - x) < 1);
      return Math.max(...near.map((p) => p.y)) - Math.min(...near.map((p) => p.y));
    };
    const part = strokeOutline(drawn, 10, true, at);
    expect(widthAt(part, -40)).toBeCloseTo(widthAt(full, -40), 0);
  });

  it('a path stroke paints its draw span (ink area)', () => {
    const sprite = {
      kind: 'polygon' as const,
      radius: [0.3, 0.3] as [number, number],
      color: '#ffffff',
      path: 'M -1 0 L 1 0',
      fill: false,
      stroke: { color: '#ffffff', width: 0.02, draw: { end: 0.25 } },
    };
    const part = pathParts(sprite)[0]!;
    const whole = partInkArea({ ...part, stroke: { ...part.stroke!, draw: undefined } }, 100, 100, 100).stroke;
    const quarter = partInkArea(part, 100, 100, 100).stroke;
    expect(quarter).toBeCloseTo(whole / 4, 3);
  });

  it('validates, is paint (outside the structural signature) and is steerable', () => {
    expect(validateSpec(scene([line({ start: 0, end: 0.5 })])).valid).toBe(true);
    const bad = validateSpec(scene([line({ end: 2 })]));
    expect(bad.valid).toBe(false);
    expect(bad.errors.some((e) => e.path.endsWith('draw.end'))).toBe(true);
    // An unknown field is a forward-compatible warning, like everywhere else: the known span still draws.
    const future = validateSpec(scene([line({ end: 0.5, stop: 1 } as never)]));
    expect(future.valid).toBe(true);
    expect(future.warnings?.some((w) => w.code === 'unknown-property' && w.path.endsWith('draw.stop'))).toBe(true);
    expect(structuralSignature(scene([line({ end: 0.1 })]))).toBe(structuralSignature(scene([line({ end: 0.9 })])));
    expect(steerablePaths(scene([line({ end: 0 })]))).toContain('layers.0.sprite.draw.end');
  });
});

describe('named glide eases (in / out / spring)', () => {
  it('every ease is monotone 0 → 1 and stays inside its endpoints', () => {
    for (const e of ['step', 'linear', 'smooth', 'in', 'out', 'spring', undefined, 'bogus']) {
      let prev = -Infinity;
      for (let i = 0; i <= 100; i++) {
        const v = easeGlide(e, i / 100);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
      expect(easeGlide(e, 1)).toBe(1);
      expect(easeGlide(e, 0)).toBe(0);
    }
  });

  it('in starts slow, out and spring start fast', () => {
    expect(easeGlide('in', 0.2)).toBeLessThan(easeGlide('smooth', 0.2));
    expect(easeGlide('out', 0.2)).toBeGreaterThan(easeGlide('smooth', 0.2));
    expect(easeGlide('spring', 0.2)).toBeGreaterThan(easeGlide('linear', 0.2));
    expect(easeGlide('spring', 0.9)).toBeGreaterThan(0.99);
    expect(easeGlide(undefined, 0.3)).toBe(easeSmooth(0.3));
  });

  it('timeline keys accept and apply the new eases', () => {
    const s = scene([{ ...line(), key: 'l', opacity: 0 }], {
      timeline: { keys: [{ t: 0, path: 'l.opacity', value: 1, dur: 1000, ease: 'out' }] },
    });
    expect(validateSpec(s).valid).toBe(true);
    const at = resolveTimelineAt(s, 200).layers[0]!.opacity!;
    expect(at).toBeCloseTo(easeGlide('out', 0.2), 6);
    const bad = validateSpec(scene([{ ...line(), key: 'l', opacity: 0 }], {
      timeline: { keys: [{ t: 0, path: 'l.opacity', value: 1, ease: 'bounce' as never }] },
    }));
    expect(bad.valid).toBe(false);
  });
});

describe('foreign-vocabulary hints', () => {
  const msg = (spec: unknown, path: string): string | undefined =>
    validateSpec(spec).warnings?.find((w) => w.path === path)?.message;

  it('names what to write instead, keeping the unknown-property code', () => {
    const s = scene([{ ...line(), delay: 500 } as never], { duration: 9000 } as never);
    const r = validateSpec(s);
    const w = r.warnings?.find((x) => x.path === 'layers[0].delay');
    expect(w?.code).toBe('unknown-property');
    expect(w?.message).toContain('life.enter');
    expect(msg(s, 'duration')).toContain('timeline');
    const k = scene([{ ...line(), key: 'l', opacity: 0 }], {
      timeline: { keys: [{ t: 0, path: 'l.opacity', value: 1, duration: 500 } as never] },
    });
    expect(msg(k, 'timeline.keys[0].duration')).toContain('`dur`');
  });

  it('leaves a plain unknown field as it was', () => {
    expect(msg(scene([{ ...line(), zorp: 1 } as never]), 'layers[0].zorp')).toBe("unknown layer property 'zorp' — will be ignored");
  });
});

describe('rock — a swing about the resting angle', () => {
  const rocking = (extra: Partial<LayerSpec> = {}): LayerSpec => ({
    count: 3,
    motion: { type: 'static' },
    sprite: { kind: 'rect', width: [0.05, 0.05], color: '#ffffff' },
    rock: { amp: 10, period: 4000 },
    ...extra,
  });

  it('swings within ±amp of rest, on a seeded phase, and repeats every period', () => {
    const es = buildEntities(rocking({ rotate: 30 }), createRng(7), 1000, 1000, 1000);
    const rest = (30 * Math.PI) / 180;
    const amp = (10 * Math.PI) / 180;
    for (const e of es) {
      for (let t = 0; t < 8000; t += 250) {
        const a = rotationAt(e, t);
        expect(Math.abs(a - rest)).toBeLessThanOrEqual(amp + 1e-9);
        expect(rotationAt(e, t + 4000)).toBeCloseTo(a, 9);
      }
    }
    const phases = new Set(es.map((e) => e.rock!.phase.toFixed(6)));
    expect(phases.size).toBe(3);
  });

  it('a clock locks every entity to one phase', () => {
    const es = buildEntities(rocking({ clock: { phase: 0.25 } }), createRng(7), 1000, 1000, 1000);
    expect(new Set(es.map((e) => e.rock!.phase)).size).toBe(1);
  });

  it('draws only when declared, after the layer: declaring it re-seats nothing else in the layer', () => {
    const noRock: LayerSpec = { ...rocking(), rock: undefined };
    const a = buildEntities(noRock, createRng(3), 1000, 1000, 1000);
    const b = buildEntities(rocking(), createRng(3), 1000, 1000, 1000);
    expect(b.map(({ rock: _x, ...rest }) => rest)).toEqual(a);
  });

  it('validates its bounds and is structural', () => {
    expect(validateSpec(scene([rocking()])).valid).toBe(true);
    expect(validateSpec(scene([rocking({ rock: { amp: 90, period: 4000 } })])).valid).toBe(false);
    expect(validateSpec(scene([rocking({ rock: { amp: 10, period: 200 } })])).valid).toBe(false);
    expect(validateSpec(scene([rocking({ rock: { amp: 10, period: 1500 }, clock: { rate: 2 } })])).valid).toBe(false);
    expect(structuralSignature(scene([rocking()]))).not.toBe(structuralSignature(scene([rocking({ rock: { amp: 12, period: 4000 } })])));
  });
});

describe('life.stagger — entities enter one after another', () => {
  const row = (stagger?: number): LayerSpec => ({
    count: 4,
    layout: { type: 'list', gap: 0.1 },
    position: { x: 0.2, y: 0.2 },
    motion: { type: 'static' },
    sprite: { kind: 'rect', width: [0.05, 0.05], color: '#ffffff' },
    life: { enter: 1000, fade: 500, ...(stagger !== undefined ? { stagger } : {}) },
  });

  it('shifts entity i by i × stagger, enter and exit alike', () => {
    const life = { enter: 1000, exit: 5000, fade: 500, stagger: 300 };
    expect(lifeAlphaAt(life, 900)).toBe(0);
    expect(lifeAlphaAt(life, 1000)).toBe(1); // the gate opens with the first entity
    expect(lifeStaggerAt(life, 1250, 0)).toBeCloseTo(0.5, 9);
    expect(lifeStaggerAt(life, 1250, 1)).toBe(0);
    expect(lifeStaggerAt(life, 1550, 1)).toBeCloseTo(0.5, 9);
    expect(lifeStaggerAt(life, 5300, 1)).toBe(1); // the second exits 300 ms later
    expect(lifeStaggerAt(life, 5300, 0)).toBeLessThan(1);
    expect(lifeStaggerAt({ enter: 1000 }, 1250, 3)).toBe(1); // no stagger: the layer envelope carries it
  });

  it('perception sees the build: fewer entities lit mid-build', () => {
    const lit = (s: SaverSpec, t: number): number => luminanceGrid(s, { viewport: { width: 960, height: 540 }, t }).coverage;
    const together = lit(scene([row()]), 1600);
    const staggered = lit(scene([row(400)]), 1600);
    expect(staggered).toBeGreaterThan(0);
    expect(staggered).toBeLessThan(together);
    expect(lit(scene([row(400)]), 4000)).toBeCloseTo(together, 6);
  });

  it('validates and stays paint', () => {
    expect(validateSpec(scene([row(250)])).valid).toBe(true);
    expect(validateSpec(scene([row(-1)])).valid).toBe(false);
    expect(structuralSignature(scene([row(100)]))).toBe(structuralSignature(scene([row(900)])));
  });
});

describe('scenePeriod and the loop-seam advisory', () => {
  const pulsing = (period: number): LayerSpec => ({
    count: 5,
    motion: { type: 'static' },
    sprite: { kind: 'circle', radius: [0.01, 0.02], color: '#ffffff' },
    pulse: { amp: 0.2, period },
  });

  it('is the LCM of the periodic parts, 0 when static, null when anything never repeats', () => {
    expect(scenePeriod(scene([pulsing(4000), { ...pulsing(6000), rock: { amp: 5, period: 3000 } }])).period).toBe(12000);
    expect(scenePeriod(scene([{ ...line() }])).period).toBe(0);
    const drift = scenePeriod(scene([{ ...pulsing(4000), motion: { type: 'drift', speed: [0.01, 0.02] } }]));
    expect(drift.period).toBeNull();
    expect(drift.reasons.join(' ')).toContain('drift');
  });

  // An asymmetric shard: its spin shows, and repeats only once a full turn.
  const shard = { kind: 'polygon', radius: [0.01, 0.02], color: '#ffffff', points: [[0, -1], [0.5, 0.5], [-0.9, 0.4]] } as LayerSpec['sprite'];

  it('combines parts that repeat between whole milliseconds exactly, never by rounding', () => {
    const spinning = (spin: number): LayerSpec => ({ ...pulsing(4000), spin, sprite: shard });
    expect(scenePeriod(scene([spinning(90)])).period).toBe(4000); // 360000 / 90
    // spin 7 laps every 51428.57… ms; seven laps (360000 ms) are 90 pulses: that is the period.
    expect(scenePeriod(scene([spinning(7)])).period).toBe(360000);
    // Alone it has no whole-ms repeat at all.
    const alone = scenePeriod(scene([{ ...pulsing(0), pulse: undefined, spin: 7, sprite: shard } as LayerSpec]));
    expect(alone.period).toBeNull();
    expect(alone.reasons.join(' ')).toContain('whole number of milliseconds');
    // A 1000 ms pulse at clock rate 0.3 repeats every 3333⅓ ms: three of them fit a 10 s lap.
    const slow = (duration: number): SaverSpec => scene([{ ...pulsing(1000), key: 'p', opacity: 1, clock: { rate: 0.3 } }], { timeline: { loop: true, duration, keys: [{ t: 0, path: 'p.opacity', value: 0.5 }] } });
    expect(scenePeriod(slow(10000)).period).toBe(10000);
    expect(adviseSpec(slow(10000), { width: 960, height: 540 }).map((w) => w.code)).not.toContain('loop-seam');
  });

  it('repeats a drifting field only on whole 100 ms raster buckets', () => {
    const field = (period: number): SaverSpec => scene([], { background: { type: 'field', scale: 2, bands: ['#000000', '#ffffff'], drift: { amount: 0.5, period } } as never });
    expect(scenePeriod(field(10050)).period).toBe(20100);
    expect(scenePeriod(field(10000)).period).toBe(10000);
  });

  it('takes no period from a still field (drift amount 0), so a looping timeline fits it', () => {
    const still = (extra: Partial<SaverSpec> = {}): SaverSpec =>
      scene([{ ...pulsing(3000), key: 'p', opacity: 1 }], {
        background: { type: 'field', scale: 2, bands: ['#000000', '#ffffff'], drift: { amount: 0, period: 10000 } } as never,
        ...extra,
      });
    expect(scenePeriod(still()).period).toBe(3000);
    const looped = still({ timeline: { loop: true, duration: 6000, keys: [{ t: 0, path: 'p.opacity', value: 0.5 }] } });
    expect(scenePeriod(looped).period).toBe(6000);
    expect(adviseSpec(looped, { width: 960, height: 540 }).map((w) => w.code)).not.toContain('loop-seam');
  });

  it('treats a zero-start fade as a one-shot build, not a static scene', () => {
    expect(scenePeriod(scene([{ ...line(), life: { enter: 0, fade: 1000 } }])).period).toBeNull();
    expect(scenePeriod(scene([{ ...line(), life: { enter: 0, fade: 0 } }])).period).toBe(0);
  });

  it('treats a staggered instant entrance as a one-shot build, whatever the layer count', () => {
    // The drawn count scales with the viewport, so a count of 1 can draw several and a count of 2 just one.
    const dots = (count: number): LayerSpec => ({ ...pulsing(4000), pulse: undefined, count, life: { enter: 0, fade: 0, stagger: 1000 } });
    for (const count of [1, 2, 4]) {
      const r = scenePeriod(scene([dots(count)]));
      expect(r.period).toBeNull();
      expect(r.reasons.join(' ')).toContain('life builds in or out once');
    }
    // Without a stagger the same instant entrance is still static.
    expect(scenePeriod(scene([{ ...dots(4), life: { enter: 0, fade: 0 } }])).period).toBe(0);
  });

  it('is aperiodic when a timeline key moves a period or rate', () => {
    const keyed = (path: string): SaverSpec => scene([{ ...pulsing(4000), key: 'p' }], { timeline: { loop: true, duration: 12000, keys: [{ t: 0, path, value: 2500 }] } });
    const r = scenePeriod(keyed('p.pulse.period'));
    expect(r.period).toBeNull();
    expect(r.reasons.join(' ')).toContain('p.pulse.period');
    expect(scenePeriod(scene([{ ...pulsing(4000), key: 'p', opacity: 1 }], { timeline: { loop: true, duration: 12000, keys: [{ t: 0, path: 'p.opacity', value: 0.5 }] } })).period).toBe(12000);
  });

  it('takes no period from a pulse of amp 0 (X706: it breathes nothing)', () => {
    expect(scenePeriod(scene([{ ...pulsing(4000), pulse: { amp: 0, period: 4000 } }])).period).toBe(0);
  });

  describe('spin repeats at the drawing\'s rotational symmetry (X709)', () => {
    const f = (v: number): number => Number(v.toFixed(4));
    const at = (a: number, r: number): string => `${f(Math.cos(a) * r)} ${f(Math.sin(a) * r)}`;
    /** n thin spokes from the hub, one SVG subpath each; spoke `long` reaches 0.9 instead of 1. */
    const spokes = (n: number, long = -1): string[] =>
      Array.from({ length: n }, (_, i) => {
        const a = (i * 2 * Math.PI) / n;
        return `M ${at(a - 0.04, 0.2)} L ${at(a, i === long ? 0.9 : 1)} L ${at(a + 0.04, 0.2)} Z`;
      });
    const polygon = (extra: Record<string, unknown>): LayerSpec['sprite'] => ({ kind: 'polygon', radius: [0.3, 0.3], color: '#ffffff', ...extra }) as LayerSpec['sprite'];
    const spinner = (sprite: LayerSpec['sprite'], spin: number, lap?: number): SaverSpec =>
      scene([{ key: 'spokes', count: 1, position: { x: 0.5, y: 0.5 }, motion: { type: 'static' }, spin, opacity: 1, sprite }], lap ? { timeline: { loop: true, duration: lap, keys: [{ t: 0, path: 'spokes.opacity', value: 1, dur: 0 }] } } : {});
    const seams = (s: SaverSpec): boolean => adviseSpec(s, { width: 960, height: 540 }).some((w) => w.code === 'loop-seam');
    /** The lap does not hold a whole number of the rest of the scene's repeats (what an exact one-lap export needs). */
    const offLap = (s: SaverSpec): boolean => s.timeline!.duration! % periodWithoutTimeline(s).period! !== 0;

    it('repeats 18 identical spokes every 20° of spin: spin 16 → 1250 ms', () => {
      const r = scenePeriod(spinner(polygon({ path: spokes(18).join(' ') }), 16));
      expect(r.period).toBe(1250);
      expect(r.parts).toEqual(['layers[0] (spokes) spin (18-fold): 1250 ms']);
      // A lap of 5 s holds four repeats; a full turn (22.5 s) does not divide it.
      expect(offLap(spinner(polygon({ path: spokes(18).join(' ') }), 16, 5000))).toBe(false);
      // Spin 25 on the reported 36 s lap: 800 ms repeats fit 45 times, though a full turn (14.4 s) does not.
      expect(offLap(spinner(polygon({ path: spokes(18).join(' ') }), 25, 36000))).toBe(false);
      // At spin 16 a 36 s lap is 28.8 repeats — 16° of turn left over.
      expect(offLap(spinner(polygon({ path: spokes(18).join(' ') }), 16, 36000))).toBe(true);
      // But spin carries on through the wrap, so nothing jumps there: no loop-seam (F145).
      expect(seams(spinner(polygon({ path: spokes(18).join(' ') }), 16, 36000))).toBe(false);
    });

    it('still warns for a drawing that is not symmetric', () => {
      const r = scenePeriod(spinner(polygon({ path: spokes(18, 3).join(' ') }), 16));
      expect(r.period).toBe(22500);
      expect(offLap(spinner(polygon({ path: spokes(18, 3).join(' ') }), 16, 5000))).toBe(true);
      // A triangle facet that is not equilateral has no symmetry either.
      expect(scenePeriod(spinner(polygon({ points: [[0, -1], [0.5, 0.5], [-0.9, 0.4]] }), 16)).period).toBe(22500);
    });

    it('matches each paint on its own: one spoke a different colour breaks the symmetry', () => {
      const all = spokes(18);
      const parts = [{ path: all.filter((_, i) => i !== 5).join(' ') }, { path: all[5]!, color: '#ff0000' }];
      expect(scenePeriod(spinner(polygon({ parts }), 16)).period).toBe(22500);
      // Alternating colours: 9-fold, the period of the colour pattern.
      const alternating = [{ path: all.filter((_, i) => i % 2 === 0).join(' ') }, { path: all.filter((_, i) => i % 2 === 1).join(' '), color: '#ff0000' }];
      expect(scenePeriod(spinner(polygon({ parts: alternating }), 16)).period).toBe(2500);
    });

    it('finds the symmetry of curved arms through the flattener, and of regular n-gons', () => {
      const arms = Array.from({ length: 3 }, (_, i) => {
        const r = (i * 2 * Math.PI) / 3;
        const p = (x: number, y: number): string => `${f(x * Math.cos(r) - y * Math.sin(r))} ${f(x * Math.sin(r) + y * Math.cos(r))}`;
        return `M ${p(0.05, 0)} C ${p(0.5, 0.1)} ${p(0.8, 0.5)} ${p(0.3, 0.95)}`;
      }).join(' ');
      expect(scenePeriod(spinner(polygon({ path: arms, fill: false, stroke: { color: '#ffffff', width: 0.05 } }), 40)).period).toBe(3000);
      expect(scenePeriod(spinner(polygon({ sides: 6 }), 40)).period).toBe(1500);
    });

    it('turns about the drawing\'s origin, and trusts no symmetry it does not model', () => {
      const path = spokes(18).join(' ');
      expect(scenePeriod(spinner(polygon({ path, origin: [0.2, 0] }), 16)).period).toBe(22500);
      expect(scenePeriod(spinner(polygon({ path, stroke: { color: '#ff0000', width: 0.02, draw: { end: 0.5 } } }), 16)).period).toBe(22500);
      expect(scenePeriod(spinner(polygon({ path, gradient: { type: 'linear', from: [-1, 0], to: [1, 0], stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#ffffff' }] } }), 16)).period).toBe(22500);
    });

    it('takes no period from a spinning circle or ring, even at seeded speeds', () => {
      const circle = { kind: 'circle', radius: [0.1, 0.1], color: '#ffffff' } as LayerSpec['sprite'];
      const ring = { kind: 'ring', radius: [0.1, 0.1], color: '#ffffff' } as LayerSpec['sprite'];
      expect(scenePeriod(spinner(circle, 7)).period).toBe(0);
      expect(scenePeriod(scene([{ count: 4, motion: { type: 'static' }, spin: [5, 30], sprite: ring }])).period).toBe(0);
    });
  });

  describe('loop-seam fires only for parts that do not run through the wrap (F145, X725, X823)', () => {
    const vp = { width: 960, height: 540 };
    const codes = (s: SaverSpec): string[] => adviseSpec(s, vp).map((w) => w.code);
    const seam = (s: SaverSpec) => adviseSpec(s, vp).find((w) => w.code === 'loop-seam');
    const tl = (duration: number): SaverSpec['timeline'] => ({ loop: true, duration, keys: [{ t: 0, path: 'p.opacity', value: 0.5 }] });
    /** A 4 s path lap: an entity travelling a route, which a lap off its period cuts mid-route. */
    const route = (duration = 4000): LayerSpec => ({ count: 1, sprite: { kind: 'circle', radius: [0.01, 0.01], color: '#ffffff' }, motion: { type: 'path', duration, points: [[0.2, 0.5], [0.8, 0.5]] } } as LayerSpec);
    const withRoute = (lap?: number, extra: LayerSpec[] = []): SaverSpec => scene([{ ...line(), key: 'p', opacity: 1 }, route(), ...extra], lap ? { timeline: tl(lap) } : {});

    it('raises it for a path lap the timeline does not fit', () => {
      expect(codes(withRoute())).not.toContain('loop-seam');
      expect(codes(withRoute(8000))).not.toContain('loop-seam');
      expect(seam(withRoute(6000))?.message).toBe('the timeline loops every 6000 ms but layers[1] path: 4000 ms repeats every 4000 ms, so the scene only comes round to its first frame every 12000 ms — make the lap a multiple of 4000 ms for one lap to loop');
    });

    it('stays silent when the only periods that disagree are pulse, rock, spin or grow (was: loop-seam)', () => {
      // Pulse 4000 ms on a 6000 ms lap: before F145 this raised loop-seam.
      const pulsed = scene([{ ...pulsing(4000), key: 'p', opacity: 1 }], { timeline: tl(6000) });
      expect(periodWithoutTimeline(pulsed).period).toBe(4000);
      expect(codes(pulsed)).not.toContain('loop-seam');
      // X725: an 1800 ms rock under a 30 s lap.
      expect(codes(scene([{ ...line(), key: 'p', opacity: 1, rock: { amp: 5, period: 1800 } }], { timeline: tl(30000) }))).not.toContain('loop-seam');
      // X823-style: a spin whose full turn is half an hour.
      const shard = { kind: 'polygon', radius: [0.05, 0.05], color: '#ffffff', points: [[0, -1], [0.5, 0.5], [-0.9, 0.4]] } as LayerSpec['sprite'];
      const slowSpin = scene([{ ...line(), key: 'p', opacity: 1 }, { count: 1, position: { x: 0.5, y: 0.5 }, motion: { type: 'static' }, spin: 0.2, sprite: shard }], { timeline: tl(30000) });
      expect(periodWithoutTimeline(slowSpin).period).toBe(1800000);
      expect(codes(slowSpin)).not.toContain('loop-seam');
      expect(codes(scene([{ ...line(), key: 'p', opacity: 1, grow: { amp: 0.1, period: 7000 } }], { timeline: tl(30000) }))).not.toContain('loop-seam');
    });

    it('names only the parts that have to fit, so its fix can be taken', () => {
      // A 4 s route plus a 7 s pulse: the whole scene repeats every 28 s, but only the route has to fit.
      const mixed = withRoute(6000, [{ ...pulsing(7000) }]);
      expect(periodWithoutTimeline(mixed).period).toBe(28000);
      const m = seam(mixed)?.message ?? '';
      expect(m).toContain('make the lap a multiple of 4000 ms');
      expect(m).not.toContain('pulse');
      expect(codes(withRoute(8000, [{ ...pulsing(7000) }]))).not.toContain('loop-seam');
    });
  });
});

describe('wipe transition', () => {
  const seg = (color: string): SaverSpec => scene([{ ...line(), sprite: { ...(line().sprite as object), color } as never }], { background: { type: 'solid', color } });
  const seq = (transition: Record<string, unknown>) => ({
    format: 'idle-sequence' as const,
    schemaVersion: 1 as const,
    id: 'wipes',
    label: 'Wipes',
    loop: true,
    segments: [
      { key: 'a', scene: seg('#102030'), duration: 4000, transition },
      { key: 'b', scene: seg('#f0e0d0'), duration: 4000, transition },
    ],
  });

  it('warns, not errors, on an unknown wipe field', () => {
    const r = validateSequence(seq({ type: 'wipe', dur: 1200, futureOption: true }));
    expect(r.valid).toBe(true);
    expect(r.warnings?.some((w) => w.code === 'unknown-property' && w.path.endsWith('futureOption'))).toBe(true);
  });

  it('validates its edge fields', () => {
    expect(validateSequence(seq({ type: 'wipe', dur: 1200 })).valid).toBe(true);
    expect(validateSequence(seq({ type: 'wipe', dur: 1200, shape: 'circle', origin: { x: 0.2, y: 0.8 }, feather: 0.2 })).valid).toBe(true);
    expect(validateSequence(seq({ type: 'wipe', dur: 1200, shape: 'line', angle: 90 })).valid).toBe(true);
    expect(validateSequence(seq({ type: 'wipe', dur: 50 })).valid).toBe(false);
    expect(validateSequence(seq({ type: 'wipe', dur: 1200, shape: 'star' })).valid).toBe(false);
    expect(validateSequence(seq({ type: 'wipe', dur: 1200, shape: 'line', origin: { x: 0.5, y: 0.5 } })).valid).toBe(false);
    expect(validateSequence(seq({ type: 'wipe', dur: 1200, text: 'dip' })).valid).toBe(false);
  });

  it('counts as a live transition for the advisories (no luminance-jump nag)', () => {
    const codes = adviseSequence(seq({ type: 'wipe', dur: 1200 }) as never).map((w) => w.code);
    expect(codes).not.toContain('boundary-luminance-jump');
    expect(codes).toContain('fade-degrades-on-low-tier');
    expect(adviseSequence(seq({ type: 'cut' }) as never).map((w) => w.code)).toContain('boundary-luminance-jump');
  });

  it('the mask reveals nothing at k = 0 and everything at k = 1', () => {
    const stops: Array<{ kind: string; args: number[] }> = [];
    const fake = {
      createRadialGradient: (...args: number[]) => { stops.push({ kind: 'radial', args }); return { addColorStop: () => undefined }; },
      createLinearGradient: (...args: number[]) => { stops.push({ kind: 'linear', args }); return { addColorStop: () => undefined }; },
    } as unknown as CanvasRenderingContext2D;
    const reach = Math.hypot(50, 50);
    wipeMask(fake, { type: 'wipe', dur: 1000 }, 0, 100, 100);
    wipeMask(fake, { type: 'wipe', dur: 1000 }, 1, 100, 100);
    expect(stops[0]!.args[5]).toBeLessThan(1); // outer radius ~0
    expect(stops[1]!.args[2]).toBeGreaterThanOrEqual(reach - 1e-9); // inner radius clears every corner
    wipeMask(fake, { type: 'wipe', dur: 1000, shape: 'line', angle: 0 }, 1, 100, 100);
    expect(stops[2]!.kind).toBe('linear');
    expect(stops[2]!.args[0]).toBeGreaterThanOrEqual(100); // the trailing edge is past the right side
  });
});

describe('reveal.rise and textBlock.number', () => {
  const block = (extra: Record<string, unknown>): LayerSpec => ({
    count: 1,
    position: { x: 0.5, y: 0.5 },
    motion: { type: 'static' },
    sprite: { kind: 'textBlock', text: '1,200 visitors', maxWidth: 1, fontSize: 0.05, anchor: 'center', ...extra } as never,
  });

  it('formats a counter the same way everywhere', () => {
    expect(textBlockText({ text: 'x', number: { value: 1234567 } })).toBe('1,234,567');
    expect(textBlockText({ text: 'x', number: { value: 1234.5678, decimals: 2, prefix: '$', suffix: ' raised' } })).toBe('$1,234.57 raised');
    expect(textBlockText({ text: 'x', number: { value: 9999, grouping: false } })).toBe('9999');
    expect(textBlockText({ text: 'x', number: { value: -0.004, decimals: 2 } })).toBe('0.00');
    expect(textBlockText({ text: 'x', number: { value: -1500 } })).toBe('-1,500');
    expect(textBlockText({ text: 'plain' })).toBe('plain');
  });

  it('perception reads the formatted number, and value is a steerable paint path', () => {
    const s = scene([block({ number: { value: 42, suffix: ' visitors' } })]);
    expect(validateSpec(s).valid).toBe(true);
    expect(textSprites(s)[0]!.strings).toEqual(['42 visitors']);
    expect(steerablePaths(s)).toContain('layers.0.sprite.number.value');
    expect(structuralSignature(s)).toBe(structuralSignature(scene([block({ number: { value: 9000, suffix: ' visitors' } })])));
    expect(validateSpec(scene([block({ number: { value: 'many' } })])).valid).toBe(false);
    expect(validateSpec(scene([block({ number: { value: 1, decimals: 9 } })])).valid).toBe(false);
  });

  it('a text morph fades a counter only when its label changes, not as its value glides', () => {
    const a = scene([block({ number: { value: 10, suffix: ' visitors' } })]);
    const sameLabel = scene([block({ number: { value: 99, suffix: ' visitors' } })]);
    const newLabel = scene([block({ number: { value: 10, suffix: ' guests' } })]);
    expect(textStringsDiffer(a, sameLabel, 0)).toBe(false);
    expect(textStringsDiffer(a, newLabel, 0)).toBe(true);
    expect(textStringsDiffer(a, scene([block({})]), 0)).toBe(true); // counter -> plain text
  });

  it('rise validates on glyphFade and warns elsewhere', () => {
    expect(validateSpec(scene([block({ reveal: { mode: 'glyphFade', progress: 0.5, rise: 0.4 } })])).valid).toBe(true);
    const r = validateSpec(scene([block({ reveal: { mode: 'typewriter', rise: 0.4 } })]));
    expect(r.valid).toBe(true);
    expect(r.warnings?.some((w) => w.path.endsWith('reveal.rise'))).toBe(true);
    expect(validateSpec(scene([block({ reveal: { mode: 'glyphFade', rise: 3 } })])).valid).toBe(false);
  });
});
