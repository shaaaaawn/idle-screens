import { describe, expect, it } from 'vitest';
import { flattenPath, polygonArea, polygonPoints } from './shapes';
import { validateSpec } from './validate';

const spec = (path: string) => ({
  schemaVersion: 1, id: 'p', label: 'p', background: { type: 'solid', color: '#000000' },
  layers: [{ count: 1, sprite: { kind: 'polygon', radius: [0.3, 0.3], color: '#ffffff', path } as Record<string, unknown>, motion: { type: 'static' } }],
});
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
});
