import { describe, it, expect } from 'vitest';
import { createRng } from '@idle-screens/core';
import { buildEntities } from './simulate';
import { barBox, barFraction, featherAlphas, pathLength, polygonArea, polygonFill, polygonPoints, strokeSamples, strokeTaper } from './shapes';
import { dominanceRanking, luminanceGrid, perceiveScene } from './perceive';
import type { LayerSpec, SaverSpec } from './types';

const base = (layers: LayerSpec[]): SaverSpec => ({
  schemaVersion: 1,
  id: 'shapes',
  label: 'Shapes',
  units: 'px',
  background: { type: 'solid', color: '#000000' },
  layers,
});

describe('polygon geometry', () => {
  it('a regular n-gon points up, has n vertices and the textbook area', () => {
    const pts = polygonPoints({ kind: 'polygon', radius: [10, 10], color: '#fff', sides: 6 }, 10);
    expect(pts).toHaveLength(6);
    expect(pts[0]!.x).toBeCloseTo(0, 9);
    expect(pts[0]!.y).toBeCloseTo(-10, 9);
    expect(polygonArea(pts)).toBeCloseTo((6 / 2) * 100 * Math.sin((2 * Math.PI) / 6), 9);
  });

  it('defaults to six sides, and custom points scale by the radius', () => {
    expect(polygonPoints({ kind: 'polygon', radius: [1, 1], color: '#fff' }, 5)).toHaveLength(6);
    const tri = polygonPoints({ kind: 'polygon', radius: [1, 1], color: '#fff', points: [[-1, 1], [0, -1], [1, 1]] }, 20);
    expect(tri).toEqual([{ x: -20, y: 20 }, { x: 0, y: -20 }, { x: 20, y: 20 }]);
    expect(polygonArea(tri)).toBeCloseTo(800, 9);
  });

  it('fill ratio: a square fills 2/π of its disc; more sides approach 1', () => {
    expect(polygonFill({ kind: 'polygon', radius: [1, 1], color: '#fff', sides: 4 }, 10)).toBeCloseTo(2 / Math.PI, 6);
    expect(polygonFill({ kind: 'polygon', radius: [1, 1], color: '#fff', sides: 12 }, 10)).toBeGreaterThan(0.95);
  });
});

describe('stroke geometry', () => {
  const S = (extra: Partial<Extract<LayerSpec['sprite'], { kind: 'stroke' }>> = {}) =>
    ({ kind: 'stroke', length: [10, 10], points: [[-1, 0], [0, -1], [1, 0]], color: '#fff', ...extra }) as Extract<LayerSpec['sprite'], { kind: 'stroke' }>;

  it('samples pass through the control points at both ends and scale to the half-size', () => {
    const pts = strokeSamples(S(), 50);
    expect(pts).toHaveLength(24);
    expect(pts[0]).toEqual({ x: -50, y: 0 });
    expect(pts[23]!.x).toBeCloseTo(50, 9);
    expect(pts[23]!.y).toBeCloseTo(0, 9);
  });

  it('a two-point stroke is straight whatever the curve mode', () => {
    for (const curve of ['smooth', 'linear'] as const) {
      const straight = strokeSamples(S({ points: [[-1, 0], [1, 0]], curve }), 50);
      for (const p of straight) expect(p.y).toBeCloseTo(0, 9);
      expect(pathLength(straight)).toBeCloseTo(100, 9);
    }
  });

  it('a 24-point smooth stroke still gets interior samples per segment (it is a curve, not its control polyline)', () => {
    const pts = Array.from({ length: 24 }, (_, i) => [-1 + (2 * i) / 23, i % 2 ? 0.5 : -0.5] as [number, number]);
    const samples = strokeSamples(S({ points: pts }), 100);
    expect(samples.length).toBeGreaterThanOrEqual(23 * 6 + 1);
    // Midway between two alternating control points the spline overshoots the straight chord.
    const mid = samples[3]!; // inside the first segment
    expect(Math.abs(mid.y)).toBeLessThan(50);
  });

  it('taper is thin at both ends, full in the middle, and never zero', () => {
    expect(strokeTaper(0)).toBeCloseTo(0.15, 9);
    expect(strokeTaper(0.5)).toBeCloseTo(1, 9);
    expect(strokeTaper(1)).toBeCloseTo(0.15, 9);
  });
});

describe('feather alphas', () => {
  it('composite to a linear ramp under source-over and sum to one under additive blends', () => {
    const so = featherAlphas(6, false);
    let composited = 0;
    so.forEach((a, k) => {
      composited = 1 - (1 - composited) * (1 - a);
      expect(composited).toBeCloseTo((k + 1) / 6, 9);
    });
    const add = featherAlphas(6, true);
    expect(add.reduce((s, a) => s + a, 0)).toBeCloseTo(1, 9);
  });
});

describe('shape glyphs in the entity model and perception', () => {
  it('polygon size is the seeded diameter; stroke size is the seeded length; both take the palette pick', () => {
    const poly = buildEntities({ count: 5, sprite: { kind: 'polygon', radius: [10, 10], color: '#fff', colors: ['#fff', '#f00'], sides: 5 }, motion: { type: 'static' } }, createRng(1), 800, 600);
    for (const e of poly) { expect(e.size).toBe(20); expect(e.colorIndex).toBeGreaterThanOrEqual(0); }
    const stroke = buildEntities({ count: 5, sprite: { kind: 'stroke', length: [30, 30], points: [[-1, 0], [1, 0]], color: '#fff' }, motion: { type: 'static' } }, createRng(1), 800, 600);
    for (const e of stroke) expect(e.size).toBe(30);
  });

  it('a polygon registers less light than the disc it is inscribed in, and more sides register more', () => {
    // `coverage` counts lit cells, which the inscribed shapes share; the fill
    // ratio shows up in how much light those cells carry.
    const at = (sprite: LayerSpec['sprite']) => perceiveScene(base([{ count: 1, sprite, motion: { type: 'static' }, position: { x: 0.5, y: 0.5 } }])).meanLuminance;
    const disc = at({ kind: 'circle', radius: [60, 60], color: '#fff' });
    const tri = at({ kind: 'polygon', radius: [60, 60], color: '#fff', sides: 3 });
    const dodeca = at({ kind: 'polygon', radius: [60, 60], color: '#fff', sides: 12 });
    expect(tri).toBeGreaterThan(0);
    expect(tri).toBeLessThan(dodeca);
    expect(dodeca).toBeLessThanOrEqual(disc + 1e-9);
  });

  it('a stroke leaves a continuous line of ink along its path, and a feathered rect weighs less than a hard one', () => {
    const stroke = luminanceGrid(base([{ count: 1, sprite: { kind: 'stroke', length: [400, 400], points: [[-1, 0], [0, -1], [1, 0]], color: '#fff', width: 6 }, motion: { type: 'static' }, position: { x: 0.5, y: 0.5 } }]));
    expect(stroke.coverage).toBeGreaterThan(0);
    // A straight 1600 px stroke across an 80-column grid must light ~every column it crosses, not 24 dots.
    const long = luminanceGrid(base([{ count: 1, sprite: { kind: 'stroke', length: [1600, 1600], points: [[-1, 0], [1, 0]], color: '#fff', width: 40 }, motion: { type: 'static' }, position: { x: 0.5, y: 0.5 } }]));
    const litCells = long.coverage * long.cols * long.rows;
    expect(litCells).toBeGreaterThanOrEqual(60);
    const area = (sprite: LayerSpec['sprite']) => dominanceRanking(base([{ count: 1, sprite, motion: { type: 'static' }, position: { x: 0.5, y: 0.5 } }]))[0]!.factors.area;
    expect(area({ kind: 'rect', width: [200, 200], color: '#fff', feather: 0.8 })).toBeLessThan(area({ kind: 'rect', width: [200, 200], color: '#fff' }));
  });
});

describe('bar geometry', () => {
  const bar = (extra: Record<string, unknown> = {}) => ({ kind: 'bar', values: [50, 100, 0], length: 200, thickness: 10, color: '#fff', ...extra }) as Extract<LayerSpec['sprite'], { kind: 'bar' }>;

  it('fraction is value / max, max defaulting to the largest value, clamped and cycling by index', () => {
    expect(barFraction(bar(), 0)).toBe(0.5);
    expect(barFraction(bar(), 1)).toBe(1);
    expect(barFraction(bar(), 2)).toBe(0);
    expect(barFraction(bar(), 3)).toBe(0.5); // cycles
    expect(barFraction(bar({ max: 200 }), 1)).toBe(0.5);
    expect(barFraction(bar({ values: [300], max: 100 }), 0)).toBe(1); // clamped
    expect(barFraction(bar({ values: [0, 0] }), 0)).toBe(0); // no max → nothing to draw
  });

  it('boxes grow from the origin toward the direction', () => {
    expect(barBox('right', 100, 10)).toEqual({ cx: 50, cy: 0, halfX: 50, halfY: 5 });
    expect(barBox('left', 100, 10)).toEqual({ cx: -50, cy: 0, halfX: 50, halfY: 5 });
    expect(barBox('up', 100, 10)).toEqual({ cx: 0, cy: -50, halfX: 5, halfY: 50 });
    expect(barBox('down', 100, 10)).toEqual({ cx: 0, cy: 50, halfX: 5, halfY: 50 });
  });

  it('perception follows a spinning bar around its anchor', () => {
    // A bar pointing right at t=0; with spin 90 deg/s, after 1 s it points down.
    const spec = (spin: number): SaverSpec => base([{ count: 1, sprite: { kind: 'bar', values: [100], max: 100, length: 300, thickness: 20, color: '#fff' }, motion: { type: 'static' }, position: { x: 0.5, y: 0.5 }, layout: { type: 'list' }, spin }]);
    const still = luminanceGrid(spec(0), { t: 1000 });
    const turned = luminanceGrid(spec(90), { t: 1000 });
    expect(still.centroid!.x).toBeGreaterThan(0.5); // ink to the right of the anchor
    // The spun bar's centroid has left the right-hand half-line; it has swung toward the vertical.
    expect(Math.abs(turned.centroid!.x - 0.5)).toBeLessThan(still.centroid!.x - 0.5);
  });

  it('perception: a fuller bar carries more weight, and values are read at paint time', () => {
    const spec = (values: number[]): SaverSpec => base([{ count: 1, sprite: { kind: 'bar', values, max: 100, length: 400, thickness: 20, color: '#fff' }, motion: { type: 'static' }, position: { x: 0.2, y: 0.5 }, layout: { type: 'list' } }]);
    const half = dominanceRanking(spec([50]))[0]!.factors.area;
    const full = dominanceRanking(spec([100]))[0]!.factors.area;
    expect(full).toBeCloseTo(half * 2, 9);
    expect(luminanceGrid(spec([100])).coverage).toBeGreaterThan(luminanceGrid(spec([25])).coverage);
  });
});
