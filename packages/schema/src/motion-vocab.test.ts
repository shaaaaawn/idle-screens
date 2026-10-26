import { describe, it, expect } from 'vitest';
import { drawSpan, pathLength, pathParts, partInkArea, strokeDrawnSamples, strokeSamples, trimLines, trimPolyline } from './shapes';
import { validateSpec } from './validate';
import { luminanceGrid } from './perceive';
import { createRng } from '@idle-screens/core';
import { buildEntities, lifeAlphaAt, lifeStaggerAt, rotationAt } from './simulate';
import { scenePeriod } from './period';
import { adviseSpec } from './advise';
import { easeGlide, easeSmooth, steerablePaths, structuralSignature } from './steer';
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
    expect(validateSpec(scene([line({ stop: 1 } as never)])).valid).toBe(false);
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
    const { rock: _r, ...noRock } = rocking();
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

  it('fires only when a looping timeline does not fit the rest of the scene', () => {
    const codes = (s: SaverSpec): string[] => adviseSpec(s, { width: 960, height: 540 }).map((w) => w.code);
    const tl = (duration: number): SaverSpec['timeline'] => ({ loop: true, duration, keys: [{ t: 0, path: 'p.opacity', value: 0.5 }] });
    const base = (duration?: number): SaverSpec => scene([{ ...pulsing(4000), key: 'p', opacity: 1 }], duration ? { timeline: tl(duration) } : {});
    expect(codes(base())).not.toContain('loop-seam');
    expect(codes(base(8000))).not.toContain('loop-seam');
    expect(codes(base(6000))).toContain('loop-seam');
  });
});
