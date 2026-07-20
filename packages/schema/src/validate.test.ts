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
    expect(validateSpec(base())).toEqual({ valid: true, errors: [], warnings: [] });
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
    expect(validateSpec(ok)).toEqual({ valid: true, errors: [], warnings: [] });
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

const warnCodes = (spec: unknown): string[] => (validateSpec(spec).warnings ?? []).map((w) => w.code);
const warnPaths = (spec: unknown): string[] => (validateSpec(spec).warnings ?? []).map((w) => w.path);

describe('validateSpec warnings', () => {
  it('warns on unknown top-level properties', () => {
    const spec = { ...base(), foo: 42, bar: 'hi' };
    expect(warnCodes(spec)).toContain('unknown-property');
    expect(warnPaths(spec)).toContain('foo');
    expect(warnPaths(spec)).toContain('bar');
  });

  it('warns on unknown background properties', () => {
    const spec = { ...base(), background: { type: 'solid', color: '#000', depth: 5 } };
    expect(warnCodes(spec)).toContain('unknown-property');
    expect(warnPaths(spec)).toContain('background.depth');
  });

  it('warns on unknown gradient background properties', () => {
    const spec = { ...base(), background: { type: 'gradient', stops: [{ at: 0, color: '#000' }, { at: 1, color: '#fff' }], angle: 45 } };
    expect(warnCodes(spec)).toContain('unknown-property');
    expect(warnPaths(spec)).toContain('background.angle');
  });

  it('warns when layer uses id instead of key', () => {
    const spec = { ...base(), layers: [{ ...base().layers[0], id: 'stars' }] };
    const warnings = validateSpec(spec).warnings ?? [];
    const idWarn = warnings.find((w) => w.path === 'layers[0].id');
    expect(idWarn).toBeDefined();
    expect(idWarn!.code).toBe('misplaced-property');
    expect(idWarn!.message).toContain('key');
  });

  it('warns when layer uses depth', () => {
    const spec = { ...base(), layers: [{ ...base().layers[0], depth: 3 }] };
    const warnings = validateSpec(spec).warnings ?? [];
    const depthWarn = warnings.find((w) => w.path === 'layers[0].depth');
    expect(depthWarn).toBeDefined();
    expect(depthWarn!.message).toContain('not yet supported');
  });

  it('warns on unknown layer properties', () => {
    const spec = { ...base(), layers: [{ ...base().layers[0], opacity: 0.5 }] };
    expect(warnCodes(spec)).toContain('unknown-property');
    expect(warnPaths(spec)).toContain('layers[0].opacity');
  });

  it('warns when layer-level props are placed inside sprite', () => {
    const spec = {
      ...base(),
      layers: [{ count: 10, sprite: { kind: 'emoji', glyphs: ['🐟'], blend: 'lighter', trail: { length: 500 } }, size: [30, 60], motion: { type: 'drift', speed: [30, 90] } }],
    };
    const warnings = validateSpec(spec).warnings ?? [];
    const blendWarn = warnings.find((w) => w.path === 'layers[0].sprite.blend');
    expect(blendWarn).toBeDefined();
    expect(blendWarn!.code).toBe('misplaced-property');
    expect(blendWarn!.message).toContain('move it up one level');
    const trailWarn = warnings.find((w) => w.path === 'layers[0].sprite.trail');
    expect(trailWarn).toBeDefined();
    expect(trailWarn!.code).toBe('misplaced-property');
  });

  it('warns on unknown sprite properties', () => {
    const spec = {
      ...base(),
      layers: [{ count: 5, sprite: { kind: 'emoji', glyphs: ['🐟'], color: '#fff' }, size: [30, 60], motion: { type: 'drift', speed: [30, 90] } }],
    };
    expect(warnCodes(spec)).toContain('unknown-property');
    expect(warnPaths(spec)).toContain('layers[0].sprite.color');
  });

  it('warns on unknown motion properties', () => {
    const spec = {
      ...base(),
      layers: [{ count: 10, sprite: { kind: 'emoji', glyphs: ['🐟'] }, size: [30, 60], motion: { type: 'drift', speed: [30, 90], depth: 2, wobble: true } }],
    };
    expect(warnCodes(spec)).toContain('unknown-property');
    expect(warnPaths(spec)).toContain('layers[0].motion.depth');
    expect(warnPaths(spec)).toContain('layers[0].motion.wobble');
  });

  it('warns on near-zero drift speed', () => {
    const spec = {
      ...base(),
      layers: [{ count: 10, sprite: { kind: 'emoji', glyphs: ['🐟'] }, size: [30, 60], motion: { type: 'drift', speed: [0, 0.5] } }],
    };
    expect(warnCodes(spec)).toContain('near-zero-speed');
  });

  it('warns on near-zero rise speed', () => {
    const spec = {
      ...base(),
      layers: [{ count: 10, sprite: { kind: 'emoji', glyphs: ['🐟'] }, size: [30, 60], motion: { type: 'rise', speed: [0.1, 0.5] } }],
    };
    expect(warnCodes(spec)).toContain('near-zero-speed');
  });

  it('warns on near-zero bounce speed', () => {
    const spec = {
      ...base(),
      layers: [{ count: 10, sprite: { kind: 'emoji', glyphs: ['🐟'] }, size: [30, 60], motion: { type: 'bounce', speed: [0.2, 0.8] } }],
    };
    expect(warnCodes(spec)).toContain('near-zero-speed');
  });

  it('warns on near-zero orbit speed', () => {
    const spec = {
      ...base(),
      layers: [{ count: 10, sprite: { kind: 'circle', radius: [2, 6], color: '#fff' }, motion: { type: 'orbit', speed: [0.1, 0.5], radius: [50, 100] } }],
    };
    expect(warnCodes(spec)).toContain('near-zero-speed');
  });

  it('does not warn on near-zero speed in viewport units', () => {
    const spec = {
      ...base(),
      units: 'viewport' as const,
      layers: [{ count: 10, sprite: { kind: 'emoji', glyphs: ['🐟'] }, size: [10, 20], motion: { type: 'drift', speed: [0.01, 0.05] } }],
    };
    expect(warnCodes(spec)).not.toContain('near-zero-speed');
  });

  it('does not warn on well-formed spec', () => {
    expect(validateSpec(base()).warnings).toEqual([]);
  });
});
