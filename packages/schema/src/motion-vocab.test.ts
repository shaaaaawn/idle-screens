import { describe, it, expect } from 'vitest';
import { drawSpan, pathLength, pathParts, partInkArea, strokeDrawnSamples, strokeSamples, trimLines, trimPolyline } from './shapes';
import { validateSpec } from './validate';
import { luminanceGrid } from './perceive';
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
