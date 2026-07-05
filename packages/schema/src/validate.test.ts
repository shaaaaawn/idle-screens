import { describe, it, expect } from 'vitest';
import { validateSpec, assertValidSpec } from './validate';
import type { SaverSpec } from './types';

const base = (): SaverSpec => ({
  schemaVersion: 1,
  id: 'demo',
  label: 'Demo',
  background: { type: 'gradient', stops: [{ at: 0, color: '#0a3a52' }, { at: 1, color: '#02141d' }] },
  layers: [
    { count: 10, sprite: { kind: 'emoji', glyphs: ['🐟'] }, size: [30, 60], motion: { type: 'drift', speed: [30, 90], bidirectional: true }, flip: true },
  ],
});

const paths = (spec: unknown): string[] => validateSpec(spec).errors.map((e) => e.path);

describe('validateSpec', () => {
  it('accepts a well-formed spec', () => {
    expect(validateSpec(base())).toEqual({ valid: true, errors: [] });
  });

  it('rejects a non-object / wrong version', () => {
    expect(validateSpec(null).valid).toBe(false);
    expect(paths({ ...base(), schemaVersion: 2 })).toContain('schemaVersion');
  });

  it('requires id and label', () => {
    expect(paths({ ...base(), id: '' })).toContain('id');
    expect(paths({ ...base(), label: 42 })).toContain('label');
  });

  it('validates hex colours in background', () => {
    expect(paths({ ...base(), background: { type: 'solid', color: 'blue' } })).toContain('background.color');
    expect(validateSpec({ ...base(), background: { type: 'solid', color: '#123' } }).valid).toBe(true);
    expect(paths({ ...base(), background: { type: 'gradient', stops: [{ at: 0, color: '#000' }] } })).toContain('background.stops');
  });

  it('requires a non-empty layers array', () => {
    expect(paths({ ...base(), layers: [] })).toContain('layers');
  });

  it('validates layer count, sprite and motion', () => {
    expect(paths({ ...base(), layers: [{ ...base().layers[0], count: 0 }] })).toContain('layers[0].count');
    expect(paths({ ...base(), layers: [{ ...base().layers[0], sprite: { kind: 'emoji', glyphs: [] } }] })).toContain('layers[0].sprite.glyphs');
    expect(paths({ ...base(), layers: [{ ...base().layers[0], motion: { type: 'spin' } as never }] })).toContain('layers[0].motion.type');
  });

  it('validates circle + text sprites', () => {
    const circle = { ...base(), layers: [{ count: 5, sprite: { kind: 'circle', radius: [2, 6], color: '#fff' }, motion: { type: 'rise', speed: [10, 20] } }] };
    expect(validateSpec(circle).valid).toBe(true);
    expect(paths({ ...base(), layers: [{ count: 5, sprite: { kind: 'circle', radius: [2, 6], color: 'white' }, motion: { type: 'rise', speed: [10, 20] } }] })).toContain('layers[0].sprite.color');
  });

  it('enforces safety/perf caps (per-layer, total, speed)', () => {
    expect(paths({ ...base(), layers: [{ ...base().layers[0], count: 5000 }] })).toContain('layers[0].count');
    const many = { ...base(), layers: Array.from({ length: 3 }, () => ({ ...base().layers[0], count: 300 })) };
    expect(validateSpec(many).errors.some((e) => /total entities/.test(e.message))).toBe(true);
    expect(paths({ ...base(), layers: [{ ...base().layers[0], motion: { type: 'drift', speed: [0, 99999] } }] })).toContain('layers[0].motion.speed');
  });

  it('assertValidSpec throws on invalid, returns the spec on valid', () => {
    expect(() => assertValidSpec({ schemaVersion: 1 })).toThrow(/invalid saver spec/);
    expect(assertValidSpec(base()).id).toBe('demo');
  });
});
