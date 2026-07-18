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

  it('validates alpha, blend, region, and soft-circle fields', () => {
    const layer = base().layers[0];
    expect(paths({ ...base(), layers: [{ ...layer, alpha: [0.2, 1.4] }] })).toContain('layers[0].alpha');
    expect(paths({ ...base(), layers: [{ ...layer, blend: 'multiply' as never }] })).toContain('layers[0].blend');
    expect(paths({ ...base(), layers: [{ ...layer, region: { y: [0.5, 1.2] } }] })).toContain('layers[0].region.y');
    const ok = { ...base(), layers: [{ ...layer, alpha: [0.3, 0.9] as [number, number], blend: 'lighter' as const, region: { x: [0, 0.5] as [number, number] } }] };
    expect(validateSpec(ok)).toEqual({ valid: true, errors: [] });
    const soft = { ...base(), layers: [{ count: 5, sprite: { kind: 'circle', radius: [2, 6], color: '#fff', soft: true }, motion: { type: 'rise', speed: [10, 20] } }] };
    expect(validateSpec(soft).valid).toBe(true);
  });

  it('enforces pulse flash-safety caps (amp ceiling, period floor)', () => {
    const layer = base().layers[0];
    expect(paths({ ...base(), layers: [{ ...layer, pulse: { amp: 0.8, period: 2000 } }] })).toContain('layers[0].pulse.amp');
    expect(paths({ ...base(), layers: [{ ...layer, pulse: { amp: 0.3, period: 200 } }] })).toContain('layers[0].pulse.period');
    expect(validateSpec({ ...base(), layers: [{ ...layer, pulse: { amp: 0.3, period: 2000 } }] }).valid).toBe(true);
  });

  it('validates units enum', () => {
    expect(validateSpec({ ...base(), units: 'px' }).valid).toBe(true);
    expect(paths({ ...base(), units: 'rem' })).toContain('units');
  });

  it('caps speed in viewport units (4000/1080 ≈ 3.7 vu/s)', () => {
    const s = { ...base(), units: 'viewport' as const, layers: [{ count: 5, sprite: { kind: 'emoji' as const, glyphs: ['🐟'] }, size: [10, 20], motion: { type: 'drift' as const, speed: [0, 3] } }] };
    expect(validateSpec(s).valid).toBe(true);
    const fast = { ...s, layers: [{ ...s.layers[0], motion: { type: 'drift' as const, speed: [0, 50] } }] };
    expect(paths(fast)).toContain('layers[0].motion.speed');
  });

  it('rejects links.k > maxLinksK (8)', () => {
    const layer = { count: 20, sprite: { kind: 'circle' as const, radius: [2, 6], color: '#fff' }, motion: { type: 'drift' as const, speed: [10, 20] }, links: { k: 10, maxDist: 100 } };
    expect(paths({ ...base(), layers: [layer] })).toContain('layers[0].links.k');
    const ok = { ...layer, links: { k: 8, maxDist: 100 } };
    expect(validateSpec({ ...base(), layers: [ok] }).valid).toBe(true);
  });

  it('rejects links on high-count layers', () => {
    const layer = { count: 250, sprite: { kind: 'circle' as const, radius: [1, 2], color: '#fff' }, motion: { type: 'static' as const }, links: { k: 2, maxDist: 50 } };
    expect(validateSpec({ ...base(), layers: [layer] }).errors.some((e) => /links/.test(e.path))).toBe(true);
  });

  it('validates circle colors[] hex values', () => {
    const ok = { ...base(), layers: [{ count: 5, sprite: { kind: 'circle' as const, radius: [2, 6], color: '#fff', colors: ['#ff0000', '#00ff00'] }, motion: { type: 'static' as const } }] };
    expect(validateSpec(ok).valid).toBe(true);
    const bad = { ...base(), layers: [{ count: 5, sprite: { kind: 'circle' as const, radius: [2, 6], color: '#fff', colors: ['red'] }, motion: { type: 'static' as const } }] };
    expect(paths(bad)).toContain('layers[0].sprite.colors[0]');
  });

  it('rejects cycle.period below flash-safety floor', () => {
    const layer = { count: 5, sprite: { kind: 'emoji' as const, glyphs: ['🐟', '🐠'], cycle: { period: 200 } }, size: [20, 30], motion: { type: 'static' as const } };
    expect(paths({ ...base(), layers: [layer] })).toContain('layers[0].sprite.cycle.period');
    const ok = { ...layer, sprite: { ...layer.sprite, cycle: { period: 1000 } } };
    expect(validateSpec({ ...base(), layers: [ok] }).valid).toBe(true);
  });

  it('assertValidSpec throws on invalid, returns the spec on valid', () => {
    expect(() => assertValidSpec({ schemaVersion: 1 })).toThrow(/invalid saver spec/);
    expect(assertValidSpec(base()).id).toBe('demo');
  });
});
