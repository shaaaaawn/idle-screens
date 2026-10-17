import { describe, expect, it } from 'vitest';
import { MAX_PATH_POINTS, MAX_SCENE_PATH_POINTS, flattenPath, pathPointCount, pathStrokeQuads, polygonArea, polygonPoints } from './shapes';
import { spriteLuma } from './luma';
import { validateSpec } from './validate';

const spec = (path: string) => ({
  schemaVersion: 1, id: 'p', label: 'p', background: { type: 'solid', color: '#000000' },
  layers: [{ count: 1, sprite: { kind: 'polygon', radius: [0.3, 0.3], color: '#ffffff', path } as Record<string, unknown>, motion: { type: 'static' } }],
});
/** Nonzero winding of the flattened ring at (x, y): what the canvas fills. */
const winding = (d: string, x: number, y: number, rule: 'auto' | 'nonzero' | 'evenodd' = 'auto') => {
  const r = flattenPath(d, rule).points;
  let w = 0;
  for (let i = 0; i < r.length; i++) {
    const [ax, ay] = r[i]!, [bx, by] = r[(i + 1) % r.length]!;
    if (ay <= y && by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) w++;
    else if (ay > y && by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) w--;
  }
  return w;
};
const area = (d: string) => polygonArea(flattenPath(d).points.map(([x, y]) => ({ x, y })));

describe('polygon.path', () => {
  it('flattens an arc circle to a true disc area', () => {
    expect(flattenPath('M -1 0 A 1 1 0 1 1 1 0 A 1 1 0 1 1 -1 0 Z').error).toBeUndefined();
    const a = area('M -1 0 A 1 1 0 1 1 1 0 A 1 1 0 1 1 -1 0 Z');
    expect(a).toBeGreaterThan(Math.PI * 0.995);
    expect(a).toBeLessThan(Math.PI);
  });
  it('winds an inner subpath as a hole, whichever way it was drawn', () => {
    expect(area('M -1 -1 H 1 V 1 H -1 Z M -0.5 -0.5 H 0.5 V 0.5 H -0.5 Z')).toBeCloseTo(3, 6);
    expect(area('M -1 -1 H 1 V 1 H -1 Z M -0.5 -0.5 V 0.5 H 0.5 V -0.5 Z')).toBeCloseTo(3, 6);
  });
  it('fills an island inside a hole (even nesting depth)', () => {
    const eye = 'M -1 -1 H 1 V 1 H -1 Z M -0.5 -0.5 H 0.5 V 0.5 H -0.5 Z M -0.2 -0.2 H 0.2 V 0.2 H -0.2 Z';
    expect(area(eye)).toBeCloseTo(4 - 1 + 0.16, 6);
  });
  it('merges partly overlapping pieces instead of cutting them (a vein across a vein)', () => {
    // The second square starts INSIDE the first; it must still be solid.
    const d = 'M -1 -1 L 0.4 -1 L 0.4 0.4 L -1 0.4 Z M 0 0 L 1 0 L 1 1 L 0 1 Z';
    for (const [x, y] of [[-0.5, -0.5], [0.2, 0.2], [0.7, 0.7]] as const) expect(winding(d, x, y)).not.toBe(0);
    expect(winding(d, 0.7, -0.5)).toBe(0);
  });
  it('opens a window cut through two overlapping walls (winding −2)', () => {
    const d = 'M -1 -1 L 0.5 -1 L 0.5 1 L -1 1 Z M -0.5 -0.8 L 1 -0.8 L 1 0.8 L -0.5 0.8 Z M -0.1 -0.1 L 0.1 -0.1 L 0.1 0.1 L -0.1 0.1 Z';
    expect(winding(d, 0, 0)).toBe(0);
    expect(winding(d, 0.3, 0.5)).not.toBe(0);
    expect(winding(d, -0.8, 0.9)).not.toBe(0);
  });
  it('opens a window straddling the seam where two walls overlap', () => {
    // Base 0..1 tall, top block overlaps its upper band; the window sits inside the
    // TOP only, but its lower half is also covered by the base.
    const base = 'M -1 0 L 1 0 L 1 1 L -1 1 Z';
    const top = 'M -0.5 -1 L 0.5 -1 L 0.5 0.3 L -0.5 0.3 Z';
    const win = 'M -0.1 -0.1 L 0.1 -0.1 L 0.1 0.2 L -0.1 0.2 Z';
    const d = `${base} ${top} ${win}`;
    expect(winding(d, 0, -0.05)).toBe(0); // top-only part of the window
    expect(winding(d, 0, 0.1)).toBe(0); // overlap part of the window
    expect(winding(d, 0.3, 0.1)).not.toBe(0); // wall beside it
  });
  it('cuts a stroke crossing nested holes exactly once (rings within rings)', () => {
    // Outer disc, hole, island ring, inner hole; a bar crosses all of them.
    // The bar runs past the disc on both ends, so it CROSSES everything (not nested in it).
    const c = (r: number) => `M ${-r} 0 A ${r} ${r} 0 1 1 ${r} 0 A ${r} ${r} 0 1 1 ${-r} 0 Z`;
    const d = `${c(0.85)} ${c(0.7)} ${c(0.45)} ${c(0.35)} M -0.05 -1 L 0.05 -1 L 0.05 1 L -0.05 1 Z`;
    expect(winding(d, 0, 0)).toBe(0); // bar inside the inner hole: cut
    expect(winding(d, 0, -0.6)).toBe(0); // bar inside the outer hole: cut
    expect(winding(d, 0, -0.4)).not.toBe(0); // island ring
    expect(winding(d, 0, -0.78)).not.toBe(0); // outer band
    expect(winding(d, 0, -0.95)).not.toBe(0); // bar outside the disc
  });
  it("fillRule 'nonzero' honours the winding as drawn: a same-way inner shape stays filled", () => {
    const d = 'M -1 -1 L 1 -1 L 1 1 L -1 1 Z M -0.5 -0.5 L 0.5 -0.5 L 0.5 0.5 L -0.5 0.5 Z';
    expect(winding(d, 0, 0, 'auto')).toBe(0);
    expect(winding(d, 0, 0, 'nonzero')).not.toBe(0);
  });
  it("fillRule 'evenodd' is SVG's: overlaps and nested shapes alternate", () => {
    const d = 'M -1 -1 L 1 -1 L 1 1 L -1 1 Z M -0.5 -0.5 L 0.5 -0.5 L 0.5 0.5 L -0.5 0.5 Z';
    expect(Math.abs(winding(d, 0, 0, 'evenodd')) % 2).toBe(0);
    expect(Math.abs(winding(d, 0.8, 0.8, 'evenodd')) % 2).toBe(1);
    const sp = spec(d);
    (sp.layers[0]!.sprite as Record<string, unknown>).fillRule = 'evenodd';
    expect(validateSpec(sp).valid).toBe(true);
    (sp.layers[0]!.sprite as Record<string, unknown>).fillRule = 'odd';
    expect(validateSpec(sp).valid).toBe(false);
  });
  it('finds holes whatever order the subpaths come in', () => {
    const holeFirst = 'M -0.5 -0.5 L 0.5 -0.5 L 0.5 0.5 L -0.5 0.5 Z M -1 -1 L 1 -1 L 1 1 L -1 1 Z';
    expect(winding(holeFirst, 0, 0)).toBe(0);
    expect(winding(holeFirst, 0.8, 0.8)).not.toBe(0);
  });
  it('keeps a separate subpath as its own piece', () => {
    expect(area('M -1 -1 H -0.5 V -0.5 H -1 Z M 0.5 0.5 H 1 V 1 H 0.5 Z')).toBeCloseTo(0.5, 6);
  });
  it('handles relative, smooth and implicit commands', () => {
    const f = flattenPath('m0-.8c.4 0 .8.4.8.8s-.4.8-.8.8-.8-.4-.8-.8.4-.8.8-.8z');
    expect(f.error).toBeUndefined();
    expect(f.points.length).toBeGreaterThan(16);
  });
  it('scales through polygonPoints like points do', () => {
    const pts = polygonPoints({ kind: 'polygon', radius: [1, 1], color: '#fff', path: 'M0 -1 L1 1 L-1 1 Z' }, 10);
    expect(pts).toEqual([{ x: 0, y: -10 }, { x: 10, y: 10 }, { x: -10, y: 10 }]);
  });
  it('validates: accepts a curve, rejects garbage, out-of-box curves and path + points', () => {
    expect(validateSpec(spec('M -0.5 0 C -0.5 -0.9 0.5 -0.9 0.5 0 Z')).valid).toBe(true);
    expect(validateSpec(spec('hello')).valid).toBe(false);
    expect(validateSpec(spec('M -0.9 0 C -0.9 -1.6 0.9 -1.6 0.9 0 Z')).valid).toBe(false);
    const both = spec('M0 -1 L1 1 L-1 1 Z');
    both.layers[0]!.sprite.points = [[0, 0], [1, 0], [0, 1]];
    expect(validateSpec(both).valid).toBe(false);
  });
  it('budgets path points per path and across the scene (points × count)', () => {
    expect(MAX_PATH_POINTS).toBeGreaterThanOrEqual(2048);
    const ring = (n: number) => `M 0.9 0 ${Array.from({ length: n - 1 }, (_, k) => { const a = ((k + 1) / n) * Math.PI * 2 * 7; return `L ${(0.9 * Math.cos(a / 7) * (k % 2 ? 0.5 : 1)).toFixed(4)} ${(0.9 * Math.sin(a / 7) * (k % 2 ? 0.5 : 1)).toFixed(4)}`; }).join(' ')} Z`;
    const star = ring(400); // a 400-point zigzag star: no point is redundant
    expect(flattenPath(star).points.length).toBe(400);
    const many = spec(star);
    many.layers[0]!.count = Math.ceil(MAX_SCENE_PATH_POINTS / 400) + 1;
    (many.layers[0] as Record<string, unknown>).motion = { type: 'drift', speed: [0.01, 0.02] };
    const res = validateSpec(many);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /scene budget/.test(e.message))).toBe(true);
    many.layers[0]!.count = 10;
    expect(validateSpec(many).valid).toBe(true);
  });

  it('keeps every subpath as a line for strokes: open unless closed with Z', () => {
    const f = flattenPath('M -0.5 0 L 0.5 0 M -0.5 0.5 L 0 0.8 L 0.5 0.5 Z');
    expect(f.lines.map((l) => [l.points.length, l.closed])).toEqual([[2, false], [3, true]]);
  });
  it('validates gradient, stroke and fill: false', () => {
    const sp = (extra: Record<string, unknown>, d = 'M -0.5 -0.5 L 0.5 -0.5 L 0.5 0.5 L -0.5 0.5 Z') => {
      const x = spec(d);
      Object.assign(x.layers[0]!.sprite, extra);
      return validateSpec(x);
    };
    const stops = [{ at: 0, color: '#ff0000' }, { at: 1, color: '#0000ff', opacity: 0.5 }];
    expect(sp({ gradient: { type: 'linear', from: [0, -1], to: [0, 1], stops } }).valid).toBe(true);
    expect(sp({ gradient: { type: 'radial', center: [0, 0], radius: 1, focus: [0.2, -0.2], stops } }).valid).toBe(true);
    expect(sp({ gradient: { type: 'conic', stops } }).valid).toBe(false);
    expect(sp({ gradient: { type: 'linear', from: [0, -1], to: [0, 1], stops: [stops[1], stops[0]] } }).valid).toBe(false); // decreasing at
    expect(sp({ stroke: { color: '#ffffff', width: 0.02, join: 'round' } }).valid).toBe(true);
    expect(sp({ stroke: { color: '#ffffff', width: 0 } }).valid).toBe(false);
    expect(sp({ fill: false }).valid).toBe(false); // nothing to draw
    // Line art: an OPEN two-point path is fine without a fill.
    expect(sp({ fill: false, stroke: { color: '#ffffff', width: 0.01 } }, 'M -0.8 0 L 0.8 0').valid).toBe(true);
    expect(sp({}, 'M -0.8 0 L 0.8 0').valid).toBe(false); // filled needs an area
    const noPath = spec('M0 -1 L1 1 L-1 1 Z');
    const s0 = noPath.layers[0]!.sprite as Record<string, unknown>;
    delete s0.path; s0.sides = 5; s0.stroke = { color: '#fff', width: 0.02 };
    expect(validateSpec(noPath).valid).toBe(false);
  });
  it('strokes: one quad per segment, counted in the point budget', () => {
    const s = { kind: 'polygon' as const, radius: [1, 1] as [number, number], color: '#fff', path: 'M -0.5 -0.5 L 0.5 -0.5 L 0.5 0.5 Z', stroke: { color: '#000', width: 0.1 } };
    expect(pathStrokeQuads(s, 10)).toHaveLength(3);
    expect(pathPointCount(s)).toBe(6);
    expect(pathPointCount({ ...s, fill: false })).toBe(3);
  });
  it('perception reads a gradient as its mean stop, a stroke-only path as its stroke', () => {
    const layer = (sprite: Record<string, unknown>) => ({ count: 1, sprite: { kind: 'polygon', radius: [0.3, 0.3], color: '#000000', path: 'M0 -1 L1 1 L-1 1 Z', ...sprite }, motion: { type: 'static' } });
    const e = { colorIndex: 0 } as never;
    const black2white = layer({ gradient: { type: 'linear', from: [0, -1], to: [0, 1], stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#ffffff' }] } });
    expect(spriteLuma(black2white as never, e)).toBeCloseTo(0.5, 2);
    expect(spriteLuma(layer({ fill: false, stroke: { color: '#ffffff', width: 0.05 } }) as never, e)).toBeCloseTo(1, 2);
  });
});
