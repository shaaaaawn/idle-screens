import { describe, it, expect } from 'vitest';
import { validateSpec, assertValidSpec } from './validate';
import type { SaverSpec } from './types';

const base = (): SaverSpec => ({
  schemaVersion: 1,
  id: 'demo',
  label: 'Demo',
  units: 'px',
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

  it('accepts a declared density and rejects anything outside the enum', () => {
    for (const density of ['sparse', 'normal', 'dense'] as const) {
      expect(validateSpec({ ...base(), density }).valid).toBe(true);
    }
    expect(paths({ ...base(), density: 'empty' })).toContain('density');
    expect(paths({ ...base(), density: 0.1 })).toContain('density');
  });

  it('requires a non-empty layers array', () => {
    expect(paths({ ...base(), layers: [] })).toContain('layers');
  });

  it('validates layer count, sprite and motion', () => {
    expect(paths({ ...base(), layers: [{ ...base().layers[0], count: 0 }] })).toContain('layers[0].count');
    expect(paths({ ...base(), layers: [{ ...base().layers[0], sprite: { kind: 'emoji', glyphs: [] } }] })).toContain('layers[0].sprite.glyphs');
    expect(paths({ ...base(), layers: [{ ...base().layers[0], motion: { type: 'spin' } as never }] })).toContain('layers[0].motion.type');
  });

  it('accepts spin as a scalar or a [min,max] range, rejects out-of-range', () => {
    const withSpin = (spin: unknown): SaverSpec => ({ ...base(), layers: [{ ...base().layers[0]!, spin } as never] });
    expect(validateSpec(withSpin(8)).valid).toBe(true);
    expect(validateSpec(withSpin([6, 14])).valid).toBe(true);
    expect(validateSpec(withSpin([-14, -6])).valid).toBe(true);
    expect(paths(withSpin([6, 9999]))).toContain('layers[0].spin');
    expect(paths(withSpin(9999))).toContain('layers[0].spin');
    expect(paths(withSpin('fast'))).toContain('layers[0].spin');
  });

  it('validates circle + text sprites', () => {
    const circle = { ...base(), layers: [{ count: 5, sprite: { kind: 'circle', radius: [2, 6], color: '#fff' }, motion: { type: 'rise', speed: [10, 20] } }] };
    expect(validateSpec(circle).valid).toBe(true);
    expect(paths({ ...base(), layers: [{ count: 5, sprite: { kind: 'circle', radius: [2, 6], color: 'white' }, motion: { type: 'rise', speed: [10, 20] } }] })).toContain('layers[0].sprite.color');
    expect(paths({ ...base(), layers: [{ count: 1, sprite: { kind: 'text', strings: ['hello'], font: ['24px monospace'] }, motion: { type: 'static' } }] })).toContain('layers[0].sprite.font');
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
    expect(paths({ ...base(), layers: [{ ...layer, blend: 'overlay' as never }] })).toContain('layers[0].blend');
    expect(paths({ ...base(), layers: [{ ...layer, blend: 'multiply' as const }] })).not.toContain('layers[0].blend');
    expect(paths({ ...base(), layers: [{ ...layer, blend: 'screen' as const }] })).not.toContain('layers[0].blend');
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

  it('validates referenceViewport bounds (100..8640)', () => {
    expect(validateSpec({ ...base(), referenceViewport: 100 }).valid).toBe(true);
    expect(validateSpec({ ...base(), referenceViewport: 8640 }).valid).toBe(true);
    expect(paths({ ...base(), referenceViewport: 99 })).toContain('referenceViewport');
    expect(paths({ ...base(), referenceViewport: 8641 })).toContain('referenceViewport');
    expect(paths({ ...base(), referenceViewport: 'huge' as never })).toContain('referenceViewport');
  });

  it('scales the viewport speed cap by a non-default referenceViewport', () => {
    // Default referenceViewport (1080): cap = 4000/1080 ≈ 3.70 vu/s — speed 3 fits.
    const atDefaultCap = {
      ...base(),
      units: 'viewport' as const,
      layers: [{ count: 5, sprite: { kind: 'emoji' as const, glyphs: ['🐟'] }, size: [10, 20], motion: { type: 'drift' as const, speed: [0, 3] } }],
    };
    expect(validateSpec(atDefaultCap).valid).toBe(true);

    // referenceViewport: 2160 halves the cap to ≈1.85 vu/s — the same speed now exceeds it.
    const tighterCap = { ...atDefaultCap, referenceViewport: 2160 };
    expect(paths(tighterCap)).toContain('layers[0].motion.speed');

    // A speed that respects the tighter cap still passes.
    const withinTighterCap = { ...tighterCap, layers: [{ ...tighterCap.layers[0], motion: { type: 'drift' as const, speed: [0, 1] } }] };
    expect(validateSpec(withinTighterCap).valid).toBe(true);
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
    expect(depthWarn!.message).toContain("motion type 'warp'");
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

describe('validateSpec — time structure (#47)', () => {
  const withLayer = (layer: Partial<SaverSpec['layers'][number]>): SaverSpec => ({
    ...base(),
    layers: [{ count: 3, sprite: { kind: 'ring', radius: [4, 8], color: '#4fb3a8' }, motion: { type: 'static' }, ...layer }],
  });

  it('accepts a well-formed emit / clock / ease', () => {
    expect(validateSpec(withLayer({ emit: { every: 12000, life: 5000, jitter: 0, grow: [0.2, 2] } })).valid).toBe(true);
    expect(validateSpec(withLayer({ pulse: { amp: 0.2, period: 2000 }, clock: { phase: 0.5, rate: 2 } })).valid).toBe(true);
    expect(validateSpec(withLayer({ motion: { type: 'rise', speed: [10, 20], ease: { type: 'settle', tau: 1500 } } })).valid).toBe(true);
  });

  it('floors emit.every at 1000 ms and emit.life at 500 ms, and life may not exceed every', () => {
    expect(paths(withLayer({ emit: { every: 500, life: 500 } }))).toContain('layers[0].emit.every');
    expect(paths(withLayer({ emit: { every: 5000, life: 200 } }))).toContain('layers[0].emit.life');
    expect(paths(withLayer({ emit: { every: 2000, life: 3000 } }))).toContain('layers[0].emit.life');
    expect(paths(withLayer({ emit: { every: 2000, life: 1000, jitter: 2 } }))).toContain('layers[0].emit.jitter');
    expect(paths(withLayer({ emit: { every: 2000, life: 1000, grow: [0, 99] } }))).toContain('layers[0].emit.grow');
  });

  it('caps the far side of every bound too', () => {
    expect(paths(withLayer({ emit: { every: 600001, life: 500 } }))).toContain('layers[0].emit.every');
    expect(paths(withLayer({ emit: { every: 2000, life: 1000, grow: [-1, 2] } }))).toContain('layers[0].emit.grow');
    expect(paths(withLayer({ clock: { rate: 0.01 } }))).toContain('layers[0].clock.rate');
    expect(paths(withLayer({ clock: { phase: -0.1 } }))).toContain('layers[0].clock.phase');
    expect(paths(withLayer({ motion: { type: 'drift', speed: [10, 20], ease: { type: 'buoyant', tau: 120001 } } }))).toContain('layers[0].motion.ease.tau');
  });

  it('warns when jitter 0 cannot keep one event at a time, and when emit/clock land inside sprite', () => {
    const overlap = validateSpec(withLayer({ emit: { every: 12000, life: 5000, jitter: 0 } }));
    expect(overlap.valid).toBe(true);
    expect((overlap.warnings ?? []).some((w) => w.code === 'emit-overlap' && w.path === 'layers[0].emit.life')).toBe(true);
    expect((validateSpec(withLayer({ emit: { every: 12000, life: 4000, jitter: 0 } })).warnings ?? []).filter((w) => w.code === 'emit-overlap')).toEqual([]);
    const misplaced = validateSpec(withLayer({ sprite: { kind: 'ring', radius: [4, 8], color: '#4fb3a8', emit: { every: 2000, life: 1000 } } as never }));
    expect((misplaced.warnings ?? []).some((w) => w.code === 'misplaced-property' && w.path === 'layers[0].sprite.emit')).toBe(true);
  });

  it('a clocked layer needs period / rate >= 1000 ms — the whole layer breathes in unison', () => {
    expect(paths(withLayer({ pulse: { amp: 0.2, period: 800 }, clock: {} }))).toContain('layers[0].pulse.period');
    expect(paths(withLayer({ pulse: { amp: 0.2, period: 1500 }, clock: { rate: 2 } }))).toContain('layers[0].pulse.period');
    expect(paths(withLayer({ grow: { amp: 0.2, period: 900 }, clock: {} }))).toContain('layers[0].grow.period');
    expect(validateSpec(withLayer({ pulse: { amp: 0.2, period: 800 } })).valid).toBe(true); // unclocked: 500 floor still applies
    expect(paths(withLayer({ clock: { phase: 1.5 } }))).toContain('layers[0].clock.phase');
    expect(paths(withLayer({ clock: { rate: 9 } }))).toContain('layers[0].clock.rate');
  });

  it('ease needs a known type and a bounded tau, and is a motion property of drift / rise / wander only', () => {
    expect(paths(withLayer({ motion: { type: 'drift', speed: [10, 20], ease: { type: 'bounce', tau: 500 } as never } }))).toContain('layers[0].motion.ease.type');
    expect(paths(withLayer({ motion: { type: 'drift', speed: [10, 20], ease: { type: 'settle', tau: 10 } } }))).toContain('layers[0].motion.ease.tau');
    const onBounce = validateSpec(withLayer({ motion: { type: 'bounce', speed: [10, 20], ease: { type: 'settle', tau: 500 } } as never }));
    expect(onBounce.valid).toBe(true);
    expect((onBounce.warnings ?? []).some((w) => w.path === 'layers[0].motion.ease' && w.code === 'unknown-property')).toBe(true);
  });
});

describe('validateSpec — shape glyphs (#46)', () => {
  const withSprite = (sprite: SaverSpec['layers'][number]['sprite']): SaverSpec => ({
    ...base(),
    layers: [{ count: 3, sprite, motion: { type: 'static' } }],
  });

  it('accepts regular and custom polygons, strokes, and a feathered rect', () => {
    expect(validateSpec(withSprite({ kind: 'polygon', radius: [4, 8], color: '#fff', sides: 3 })).valid).toBe(true);
    expect(validateSpec(withSprite({ kind: 'polygon', radius: [4, 8], color: '#fff', points: [[-1, 1], [0, -1], [1, 1]], soft: true })).valid).toBe(true);
    expect(validateSpec(withSprite({ kind: 'stroke', length: [10, 20], points: [[-1, 0], [0, -0.5], [1, 0]], color: '#fff', width: 2, taper: true, orient: true })).valid).toBe(true);
    expect(validateSpec(withSprite({ kind: 'rect', width: [4, 8], color: '#fff', feather: 0.6 })).valid).toBe(true);
  });

  it('polygon: sides 3..12, sides xor points, points in the unit box', () => {
    expect(paths(withSprite({ kind: 'polygon', radius: [4, 8], color: '#fff', sides: 2 }))).toContain('layers[0].sprite.sides');
    expect(paths(withSprite({ kind: 'polygon', radius: [4, 8], color: '#fff', sides: 13 }))).toContain('layers[0].sprite.sides');
    expect(paths(withSprite({ kind: 'polygon', radius: [4, 8], color: '#fff', sides: 4, points: [[-1, 1], [0, -1], [1, 1]] }))).toContain('layers[0].sprite.sides');
    expect(paths(withSprite({ kind: 'polygon', radius: [4, 8], color: '#fff', points: [[-1, 1], [0, -1]] }))).toContain('layers[0].sprite.points');
    expect(paths(withSprite({ kind: 'polygon', radius: [4, 8], color: '#fff', points: [[-1, 1], [0, -2], [1, 1]] }))).toContain('layers[0].sprite.points[1]');
  });

  it('stroke: points required (2..24), width > 0, curve enum; feather 0..1 on rect', () => {
    expect(paths(withSprite({ kind: 'stroke', length: [10, 20], color: '#fff' } as never))).toContain('layers[0].sprite.points');
    expect(paths(withSprite({ kind: 'stroke', length: [10, 20], points: [[0, 0]], color: '#fff' }))).toContain('layers[0].sprite.points');
    expect(paths(withSprite({ kind: 'stroke', length: [10, 20], points: [[-1, 0], [1, 0]], color: '#fff', width: 0 }))).toContain('layers[0].sprite.width');
    expect(paths(withSprite({ kind: 'stroke', length: [10, 20], points: [[-1, 0], [1, 0]], color: '#fff', curve: 'bezier' as never }))).toContain('layers[0].sprite.curve');
    expect(paths(withSprite({ kind: 'rect', width: [4, 8], color: '#fff', feather: 1.5 }))).toContain('layers[0].sprite.feather');
  });

  it('rejects holes in a sparse points array', () => {
    const sparse: Array<[number, number]> = [];
    sparse[0] = [-1, 0]; sparse[2] = [1, 0]; // index 1 is a hole
    expect(paths(withSprite({ kind: 'stroke', length: [10, 20], points: sparse, color: '#fff' }))).toContain('layers[0].sprite.points[1]');
  });

  it('polygon and stroke take a palette like every shaped sprite', () => {
    expect(validateSpec(withSprite({ kind: 'polygon', radius: [4, 8], color: '#fff', colors: ['#fff', '#f00'], colorWeights: [3, 1] })).valid).toBe(true);
    expect(paths(withSprite({ kind: 'stroke', length: [10, 20], points: [[-1, 0], [1, 0]], color: '#fff', colors: ['#fff'], colorWeights: [1, 2] }))).toContain('layers[0].sprite.colorWeights');
  });
});

describe('validateSpec — data layouts and bars (#49)', () => {
  const layer = (extra: Partial<SaverSpec['layers'][number]>): SaverSpec => ({
    ...base(),
    layers: [{ count: 3, sprite: { kind: 'text', strings: ['a', 'b', 'c'] }, size: [20, 20], motion: { type: 'static' }, ...extra }],
  });

  it('position with count > 1 is allowed as the anchor of a list / table, and only there', () => {
    expect(validateSpec(layer({ position: { x: 0.1, y: 0.1 }, layout: { type: 'list' } })).valid).toBe(true);
    expect(validateSpec(layer({ position: { x: 0.1, y: 0.1 }, layout: { type: 'table', columns: 2 } })).valid).toBe(true);
    expect(paths(layer({ position: { x: 0.1, y: 0.1 } }))).toContain('layers[0].position');
    expect(paths(layer({ position: { x: 0.1, y: 0.1 }, layout: { type: 'grid' } }))).toContain('layers[0].position');
  });

  it('table needs integer columns; gap must be positive (number, or {x, y} for table)', () => {
    expect(paths(layer({ layout: { type: 'table', columns: 0 } }))).toContain('layers[0].layout.columns');
    expect(paths(layer({ layout: { type: 'list', gap: 0 } }))).toContain('layers[0].layout.gap');
    expect(paths(layer({ layout: { type: 'list', gap: { x: 1 } } as never }))).toContain('layers[0].layout.gap');
    expect(validateSpec(layer({ layout: { type: 'table', columns: 2, gap: { x: 0.1, y: 0.05 } } })).valid).toBe(true);
    const odd = validateSpec(layer({ layout: { type: 'table', columns: 2, gap: { x: 0.1, z: 1 } } as never }));
    expect(odd.valid).toBe(true);
    expect((odd.warnings ?? []).some((w) => w.path === 'layers[0].layout.gap.z' && w.code === 'unknown-property')).toBe(true);
    expect(paths(layer({ layout: { type: 'pile' } as never }))).toContain('layers[0].layout');
  });

  it('warns when a list layout has a different number of variants than entities', () => {
    const r = validateSpec(layer({ count: 5, layout: { type: 'list' } }));
    expect(r.valid).toBe(true);
    expect((r.warnings ?? []).some((w) => w.code === 'list-length-mismatch' && w.path === 'layers[0].count')).toBe(true);
    expect((validateSpec(layer({ layout: { type: 'list' } })).warnings ?? []).filter((w) => w.code === 'list-length-mismatch')).toEqual([]);
  });

  it('bar: values, length, thickness, max, direction', () => {
    const bar = (sprite: Record<string, unknown>) => layer({ sprite: { kind: 'bar', values: [1, 2, 3], length: 100, thickness: 8, color: '#fff', ...sprite } as never, layout: { type: 'list' } });
    expect(validateSpec(bar({})).valid).toBe(true);
    expect(paths(bar({ values: [] }))).toContain('layers[0].sprite.values');
    expect(paths(bar({ values: [1, -2, 3] }))).toContain('layers[0].sprite.values');
    expect(paths(bar({ length: 0 }))).toContain('layers[0].sprite.length');
    expect(paths(bar({ thickness: -1 }))).toContain('layers[0].sprite.thickness');
    expect(paths(bar({ max: 0 }))).toContain('layers[0].sprite.max');
    expect(paths(bar({ direction: 'sideways' }))).toContain('layers[0].sprite.direction');
    expect(validateSpec(bar({ direction: 'up', colors: ['#fff', '#f00', '#0f0'] })).valid).toBe(true);
  });
});
