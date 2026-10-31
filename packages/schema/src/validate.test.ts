import { describe, it, expect } from 'vitest';
import { validateSpec, assertValidSpec, ignoredPropertyPaths } from './validate';
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

  it('accepts pulse.amp 0 as no pulse, and names the real range when refusing (X706)', () => {
    const layer = base().layers[0];
    expect(validateSpec({ ...base(), layers: [{ ...layer, pulse: { amp: 0, period: 4000 } }] }).valid).toBe(true);
    for (const amp of [-0.1, 0.6, Number.NaN]) {
      const errs = validateSpec({ ...base(), layers: [{ ...layer, pulse: { amp, period: 4000 } }] }).errors.filter((e) => e.path === 'layers[0].pulse.amp');
      expect(errs.map((e) => e.message)).toEqual(['must be a number from 0 (no pulse) to 0.5']);
    }
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

  describe('links in chain mode (X541)', () => {
    const layer = (links: Record<string, unknown>) => ({
      count: 6, sprite: { kind: 'circle' as const, radius: [0.004, 0.008], color: '#fff' }, motion: { type: 'drift' as const, speed: [0.01, 0.02] }, links,
    });
    const spec = (links: Record<string, unknown>) => ({ ...base(), layers: [layer(links)] });

    it('accepts a chain with neither k nor maxDist — it reads neither', () => {
      expect(validateSpec(spec({ mode: 'chain' })).errors).toEqual([]);
      expect(validateSpec(spec({ mode: 'chain', closed: true, color: '#37e5d7', alpha: 0.8, width: 0.002 })).valid).toBe(true);
    });

    it('requires maxDist on a chain only when falloff is true', () => {
      expect(paths(spec({ mode: 'chain', falloff: true }))).toEqual(['layers[0].links.maxDist']);
      expect(validateSpec(spec({ mode: 'chain', falloff: true })).errors[0]!.message).toMatch(/falloff/);
      expect(validateSpec(spec({ mode: 'chain', falloff: true, maxDist: 0.3 })).valid).toBe(true);
      expect(validateSpec(spec({ mode: 'chain', falloff: false })).valid).toBe(true);
    });

    it('still checks k and maxDist on a chain when they are given', () => {
      expect(paths(spec({ mode: 'chain', k: 10 }))).toEqual(['layers[0].links.k']);
      expect(paths(spec({ mode: 'chain', k: 1.5 }))).toEqual(['layers[0].links.k']);
      expect(paths(spec({ mode: 'chain', maxDist: 0 }))).toEqual(['layers[0].links.maxDist']);
      expect(paths(spec({ mode: 'chain', maxDist: [0.1, 0.2] }))).toEqual(['layers[0].links.maxDist']);
    });

    it('keeps k and maxDist required for nearest and random', () => {
      for (const mode of [undefined, 'nearest', 'random']) {
        expect(paths(spec({ mode, maxDist: 0.3 }))).toEqual(['layers[0].links.k']);
        expect(paths(spec({ mode, k: 2 }))).toEqual(['layers[0].links.maxDist']);
      }
    });
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
    // (`opacity` was this test's example until it became a real paint field.)
    const spec = { ...base(), layers: [{ ...base().layers[0], glow: 0.5 }] };
    expect(warnCodes(spec)).toContain('unknown-property');
    expect(warnPaths(spec)).toContain('layers[0].glow');
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

  it('table needs integer columns; gap must be positive (number, or {x?, y?} on list and table)', () => {
    expect(paths(layer({ layout: { type: 'table', columns: 0 } }))).toContain('layers[0].layout.columns');
    expect(paths(layer({ layout: { type: 'list', gap: 0 } }))).toContain('layers[0].layout.gap');
    // X615: the object form is documented for both data layouts; on a list only `y` moves anything.
    expect(paths(layer({ layout: { type: 'list', gap: { y: 0 } } }))).toContain('layers[0].layout.gap.y');
    expect(validateSpec(layer({ layout: { type: 'list', gap: { x: 1 } } })).valid).toBe(true);
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

describe("validateSpec — text role (#59, plan 1e)", () => {
  const text = (sprite: Record<string, unknown>): SaverSpec => ({
    ...base(),
    layers: [{ count: 1, sprite: { kind: 'text', strings: ['hello'], ...sprite } as never, motion: { type: 'static' } }],
  });
  const block = (sprite: Record<string, unknown>): SaverSpec => ({
    ...base(),
    units: 'viewport',
    layers: [{ count: 1, sprite: { kind: 'textBlock', text: 'hello', maxWidth: 0.5, fontSize: 0.04, ...sprite } as never, motion: { type: 'static' }, position: { x: 0.2, y: 0.2 } }],
  });

  it("accepts role: 'read' | 'atmosphere' on text and textBlock as a known key", () => {
    for (const role of ['read', 'atmosphere']) {
      expect(validateSpec(text({ role }))).toEqual({ valid: true, errors: [], warnings: [] });
      expect(validateSpec(block({ role }))).toEqual({ valid: true, errors: [], warnings: [] });
    }
  });

  it('rejects any other role', () => {
    expect(paths(text({ role: 'shout' }))).toContain('layers[0].sprite.role');
    expect(paths(block({ role: 1 }))).toContain('layers[0].sprite.role');
  });
});

describe('validateSpec — onboarding messages (cold-start papercuts, 2026-09-25)', () => {
  const msg = (spec: unknown, path: string): string | undefined => validateSpec(spec).errors.find((e) => e.path === path)?.message;
  /** The message without the received-value hint (F142), for the checks that are about the wording before it. */
  const unit = (spec: unknown, path: string): string | undefined => msg(spec, path)?.split(' — got ')[0];
  const one = (sprite: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    schemaVersion: 1, id: 'o', label: 'O',
    layers: [{ count: 3, sprite, motion: { type: 'drift', speed: [0.01, 0.02] }, ...extra }],
  });

  it('range messages name viewport fractions under the default units, px only under units: "px"', () => {
    const vp = one({ kind: 'circle', radius: [0, 0.01], color: '#ffffff' });
    expect(unit(vp, 'layers[0].sprite.radius')).toBe('must be a [min,max] range of positive fractions of min(width, height)');
    const px = { ...vp, units: 'px' };
    expect(unit(px, 'layers[0].sprite.radius')).toBe('must be a [min,max] range of positive px');
    // every range-of-size site goes through the same helper
    expect(unit(one({ kind: 'streak', length: 3, color: '#ffffff' }), 'layers[0].sprite.length')).not.toMatch(/px/);
    expect(unit(one({ kind: 'rect', width: 3, color: '#ffffff' }), 'layers[0].sprite.width')).not.toMatch(/px/);
    expect(unit(one({ kind: 'polygon', radius: 3, color: '#ffffff' }), 'layers[0].sprite.radius')).toBe('must be a [min,max] range of positive fractions of min(width, height) (circumradius)');
    expect(unit({ ...one({ kind: 'polygon', radius: 3, color: '#ffffff' }), units: 'px' }, 'layers[0].sprite.radius')).toBe('must be a [min,max] range of positive px (circumradius)');
    expect(unit(one({ kind: 'stroke', length: 3, points: [[0, 0], [1, 1]], color: '#ffffff' }), 'layers[0].sprite.length')).toMatch(/fractions of min\(width, height\) \(the mark's bounding size\)$/);
    expect(unit(one({ kind: 'emoji', glyphs: ['x'] }, { size: [-1, 1] }), 'layers[0].size')).not.toMatch(/px/);
    const orbit = { schemaVersion: 1, id: 'o', label: 'O', layers: [{ count: 1, sprite: { kind: 'circle', radius: [0.01, 0.02], color: '#ffffff' }, motion: { type: 'orbit', speed: [10, 20], radius: 0.1 } }] };
    expect(unit(orbit, 'layers[0].motion.radius')).toBe('must be a [min,max] range of positive fractions of min(width, height)');
  });

  it('a [min,max] range on a scalar-only size says so instead of "must be > 0"', () => {
    const range = 'must be a single number > 0, not a [min,max] range';
    expect(unit(one({ kind: 'streak', length: [0.01, 0.02], color: '#ffffff', width: [0.003, 0.006] }), 'layers[0].sprite.width')).toBe(range);
    expect(unit(one({ kind: 'ring', radius: [0.01, 0.02], color: '#ffffff', width: [1, 2] }), 'layers[0].sprite.width')).toBe(range);
    expect(unit(one({ kind: 'stroke', length: [0.01, 0.02], points: [[0, 0], [1, 1]], color: '#ffffff', width: [1, 2] }), 'layers[0].sprite.width')).toBe(range);
    const bar = one({ kind: 'bar', values: [1, 2, 3], length: [0.1, 0.2], thickness: [0.01, 0.02], max: [1, 2], color: '#ffffff' });
    expect(unit(bar, 'layers[0].sprite.length')).toBe(range);
    expect(unit(bar, 'layers[0].sprite.thickness')).toBe(range);
    expect(unit(bar, 'layers[0].sprite.max')).toBe(range);
    expect(unit(one({ kind: 'text', strings: ['a'], maxWidth: [1, 2] }), 'layers[0].sprite.maxWidth')).toBe(range);
    const links = one({ kind: 'circle', radius: [0.01, 0.02], color: '#ffffff' }, { links: { k: 2, maxDist: [0.1, 0.2], width: [1, 2] } });
    expect(unit(links, 'layers[0].links.maxDist')).toBe(range);
    expect(unit(links, 'layers[0].links.width')).toBe(range);
    const band = { ...one({ kind: 'circle', radius: [0.01, 0.02], color: '#ffffff' }), background: { type: 'gradient', stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#111111' }], band: { color: '#222222', height: [0.1, 0.2] } } };
    expect(unit(band, 'background.band.height')).toBe(range);
    const tb = { schemaVersion: 1, id: 'o', label: 'O', layers: [{ count: 1, sprite: { kind: 'textBlock', text: 'hi', maxWidth: [0.3, 0.5], fontSize: [0.03, 0.04] }, motion: { type: 'static' }, position: { x: 0.2, y: 0.2 } }] };
    expect(unit(tb, 'layers[0].sprite.maxWidth')).toBe('must be a single number (viewport fraction), not a [min,max] range');
    expect(unit(tb, 'layers[0].sprite.fontSize')).toBe('must be a single number (viewport fraction), not a [min,max] range');
  });

  it('a non-positive scalar keeps its original message', () => {
    expect(msg(one({ kind: 'streak', length: [0.01, 0.02], color: '#ffffff', width: 0 }), 'layers[0].sprite.width')).toBe('must be > 0');
    expect(msg(one({ kind: 'bar', values: [1], length: -1, thickness: 0.01, color: '#ffffff' }), 'layers[0].sprite.length')).toBe('must be > 0 (full-scale bar length)');
    expect(msg(one({ kind: 'text', strings: ['a'], maxWidth: 0 }), 'layers[0].sprite.maxWidth')).toBe('must be a positive number');
    expect(validateSpec(one({ kind: 'streak', length: [0.01, 0.02], color: '#ffffff', width: 0.004 })).valid).toBe(true);
  });
});

describe('ignoredPropertyPaths', () => {
  it('lists unknown and misplaced properties as dot-paths, without mutating the spec', () => {
    const spec = {
      schemaVersion: 1, id: 'i', label: 'I',
      background: { type: 'gradient', angle: 180, stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#111111' }] },
      layers: [{ count: 2, sprite: { kind: 'circle', radius: [0.01, 0.02], colors: ['#ff0000'], blend: 'lighter' }, motion: { type: 'static', wobble: 3 } }],
    };
    const before = JSON.stringify(spec);
    expect(ignoredPropertyPaths(spec).sort()).toEqual(['background.angle', 'layers.0.motion.wobble', 'layers.0.sprite.blend']);
    expect(JSON.stringify(spec)).toBe(before); // validateSpec would have written sprite.color
    expect(ignoredPropertyPaths(null)).toEqual([]);
  });
});

describe('validateSpec — Screen Test cold-read messages (F141, F142, F148)', () => {
  const spec = (sprite: Record<string, unknown>, extra: Record<string, unknown> = {}, top: Record<string, unknown> = {}): Record<string, unknown> => ({
    schemaVersion: 1, id: 's', label: 'S', ...top,
    layers: [{ count: 3, sprite, motion: { type: 'drift', speed: [0.01, 0.02] }, ...extra }],
  });
  const msg = (s: unknown, path: string): string | undefined => validateSpec(s).errors.find((e) => e.path === path)?.message;
  const unknown = (s: unknown): string[] => (validateSpec(s).warnings ?? []).filter((w) => w.code === 'unknown-property').map((w) => w.path);
  const circle = { kind: 'circle', radius: [0.01, 0.02], color: '#ffffff' };
  const leaf = 'M 0 -1 L 1 0 L 0 1 L -1 0 Z';

  describe('F142: the error echoes the value and the fix', () => {
    it('a scalar where a range belongs (was: "must be a [min,max] range of positive …" alone)', () => {
      expect(msg(spec({ kind: 'circle', radius: 0.018, color: '#ffffff' }), 'layers[0].sprite.radius'))
        .toBe('must be a [min,max] range of positive fractions of min(width, height) — got 0.018; write [0.018, 0.018]');
      expect(msg(spec({ kind: 'polygon', radius: 0.02, color: '#ffffff' }), 'layers[0].sprite.radius')).toMatch(/\(circumradius\) — got 0\.02; write \[0\.02, 0\.02\]$/);
      expect(msg(spec({ kind: 'rect', width: 0.055, aspect: 0.22, color: '#ffffff' }), 'layers[0].sprite.width')).toMatch(/ — got 0\.055; write \[0\.055, 0\.055\]$/);
      expect(msg(spec({ kind: 'rect', width: [0.05, 0.06], aspect: 0.22, color: '#ffffff' }), 'layers[0].sprite.aspect'))
        .toBe('must be a [min,max] range of positive height/width ratios — got 0.22; write [0.22, 0.22]');
      expect(msg(spec({ kind: 'stroke', length: 0.1, points: [[0, 0], [1, 1]], color: '#ffffff' }), 'layers[0].sprite.length')).toMatch(/ — got 0\.1; write \[0\.1, 0\.1\]$/);
      expect(msg({ ...spec(circle), layers: [{ count: 3, sprite: circle, motion: { type: 'drift', speed: 0.02 } }] }, 'layers[0].motion.speed'))
        .toBe('must be a [min,max] range — got 0.02; write [0.02, 0.02]');
      expect(msg(spec(circle, { alpha: 0.6 }), 'layers[0].alpha')).toBe('must be a [min,max] range within 0..1 — got 0.6; write [0.6, 0.6]');
      expect(msg(spec(circle, { size: 2 }), 'layers[0].size')).toMatch(/ — got 2; write \[2, 2\]$/);
    });

    it('does not suggest [v, v] when v itself is out of bounds', () => {
      expect(msg(spec(circle, { alpha: 1.4 }), 'layers[0].alpha')).toBe('must be a [min,max] range within 0..1 — got 1.4; a range is two numbers, [min, max]');
      expect(msg(spec({ kind: 'circle', radius: 0, color: '#ffffff' }), 'layers[0].sprite.radius')).toMatch(/ — got 0; a range is two numbers, \[min, max\]$/);
    });

    it('region.x / region.y written as {min, max} (was: "must be a [min,max] range within 0..1")', () => {
      expect(msg(spec(circle, { region: { x: { min: 0.2, max: 0.8 } } }), 'layers[0].region.x'))
        .toBe('must be a [min,max] range within 0..1 — got {min, max}; write [0.2, 0.8]');
    });

    it('a reversed range names the order', () => {
      expect(msg(spec({ kind: 'circle', radius: [0.02, 0.01], color: '#ffffff' }), 'layers[0].sprite.radius')).toMatch(/ — got \[0\.02, 0\.01\]; the smaller number comes first: write \[0\.01, 0\.02\]$/);
    });

    it('a range where one number belongs (was: "must be a single number > 0, not a [min,max] range")', () => {
      expect(msg(spec({ kind: 'streak', length: [0.01, 0.02], width: [0.0012, 0.002], color: '#ffffff' }), 'layers[0].sprite.width'))
        .toBe("must be a single number > 0, not a [min,max] range — got [0.0012, 0.002]; a streak's `width` is one number");
      expect(msg(spec({ kind: 'stroke', length: [0.01, 0.02], points: [[0, 0], [1, 1]], width: [1, 2], color: '#ffffff' }), 'layers[0].sprite.width')).toMatch(/a stroke's `width` is one number$/);
      // A path stroke's width had no range branch: "must be > 0 and <= 0.5 …" alone.
      expect(msg(spec({ kind: 'polygon', radius: [0.1, 0.1], color: '#ffffff', path: leaf, stroke: { color: '#000000', width: [0.01, 0.02] } }), 'layers[0].sprite.stroke.width'))
        .toMatch(/^must be > 0 and <= 0\.5 .* — got \[0\.01, 0\.02\]; `stroke\.width` is one number$/);
      expect(msg(spec(circle, { pulse: { amp: [0.1, 0.2], period: 4000 } }), 'layers[0].pulse.amp')).toMatch(/ — got \[0\.1, 0\.2\]; `pulse\.amp` is one number$/);
    });

    it('leaves pair-shaped and well-formed messages alone, and coerces nothing', () => {
      // `origin` takes a pair: no "one number" hint.
      expect(msg(spec({ kind: 'polygon', radius: [0.1, 0.1], color: '#ffffff', path: leaf, origin: [3, 3] }), 'layers[0].sprite.origin')).not.toMatch(/one number/);
      expect(msg(spec({ kind: 'streak', length: [0.01, 0.02], color: '#ffffff', width: 0 }), 'layers[0].sprite.width')).toBe('must be > 0');
      const scalar = spec({ kind: 'circle', radius: 0.018, color: '#ffffff' });
      expect(validateSpec(scalar).valid).toBe(false);
      expect(((scalar.layers as Array<Record<string, Record<string, unknown>>>)[0]!.sprite!).radius).toBe(0.018);
    });

    it('a keyed value is hinted once, by the applied scene', () => {
      const s = spec(circle, { key: 'dots', alpha: [0.5, 0.5] }, { timeline: { keys: [{ t: 0, path: 'dots.alpha', value: 0.7 }] } });
      const m = validateSpec(s).errors[0]?.message ?? '';
      expect(m).toContain('got 0.7; write [0.7, 0.7]');
      expect(m.split(' — got ').length).toBe(2);
    });
  });

  describe('F141: a missing colour is reported as missing', () => {
    it('a polygon whose parts carry the paint (was: "must be a hex colour like #0a3a52")', () => {
      const parts = spec({ kind: 'polygon', radius: [0.1, 0.1], parts: [{ path: leaf, color: '#ff0000' }] });
      expect(msg(parts, 'layers[0].sprite.color')).toBe('`color` is required (or a `colors` palette); parts without their own colour inherit it, and a gradient or stroke does not stand in for it');
      const gradient = spec({ kind: 'polygon', radius: [0.1, 0.1], path: leaf, gradient: { type: 'linear', from: [0, -1], to: [0, 1], stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#ffffff' }] } });
      expect(msg(gradient, 'layers[0].sprite.color')).toMatch(/^`color` is required \(or a `colors` palette\)/);
    });

    it('other sprites and strokes, and a `colors` palette still stands in for it', () => {
      expect(msg(spec({ kind: 'circle', radius: [0.01, 0.02] }), 'layers[0].sprite.color')).toBe('`color` is required (or a `colors` palette)');
      expect(msg(spec({ kind: 'polygon', radius: [0.1, 0.1], color: '#ffffff', path: leaf, stroke: { width: 0.01 } }), 'layers[0].sprite.stroke.color'))
        .toBe('`color` is required on a stroke (a hex colour like #0a3a52); a stroke does not inherit the entity colour');
      expect(validateSpec(spec({ kind: 'polygon', radius: [0.1, 0.1], colors: ['#ff0000'], parts: [{ path: leaf }] })).valid).toBe(true);
    });

    it('keeps the format error for a present but malformed colour', () => {
      expect(msg(spec({ kind: 'circle', radius: [0.01, 0.02], color: 'red' }), 'layers[0].sprite.color')).toBe('must be a hex colour like #0a3a52');
      expect(msg(spec({ kind: 'polygon', radius: [0.1, 0.1], color: '#ffffff', path: leaf, stroke: { color: 'black', width: 0.01 } }), 'layers[0].sprite.stroke.color')).toBe('must be a hex colour like #0a3a52');
    });
  });

  describe('F148 (X761): unknown keys inside nested paint objects warn', () => {
    const grad = { type: 'linear', from: [0, -1], to: [0, 1], stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#ffffff' }] };
    it('sprite and part strokes, path gradients and their stops (were silent)', () => {
      const s = spec({ kind: 'polygon', radius: [0.1, 0.1], color: '#ffffff', parts: [
        { path: leaf, stroke: { color: '#000000', width: 0.01, dash: [2, 2] } },
        { path: leaf, gradient: { ...grad, angle: 30, stops: [{ at: 0, color: '#000000', offset: 1 }, { at: 1, color: '#ffffff' }] } },
      ] });
      expect(unknown(s)).toEqual(['layers[0].sprite.parts[0].stroke.dash', 'layers[0].sprite.parts[1].gradient.angle', 'layers[0].sprite.parts[1].gradient.stops[0].offset']);
      expect(validateSpec(s).valid).toBe(true);
      expect(unknown(spec({ kind: 'polygon', radius: [0.1, 0.1], color: '#ffffff', path: leaf, stroke: { color: '#000000', width: 0.01, dash: [2, 2] } }))).toEqual(['layers[0].sprite.stroke.dash']);
      // A radial gradient has no `from`: the renderer never reads it.
      expect(unknown(spec({ kind: 'polygon', radius: [0.1, 0.1], color: '#ffffff', path: leaf, gradient: { type: 'radial', center: [0, 0], radius: 1, from: [0, 0], stops: grad.stops } }))).toEqual(['layers[0].sprite.gradient.from']);
    });

    it('background stops, band and drift', () => {
      const bg = { type: 'gradient', stops: [{ at: 0, color: '#000000', opacity: 0.5 }, { at: 1, color: '#111111' }], band: { color: '#222222', height: 0.1, blur: 2 }, drift: { period: 20000, speed: 1 } };
      expect(unknown(spec(circle, {}, { background: bg }))).toEqual(['background.stops[0].opacity', 'background.drift.speed', 'background.band.blur']);
    });

    it('known keys stay quiet', () => {
      const s = spec({ kind: 'polygon', radius: [0.1, 0.1], color: '#ffffff', path: leaf, gradient: { ...grad, units: 'part', stops: [{ at: 0, color: '#000000', opacity: 0.4 }, { at: 1, color: '#ffffff' }] }, stroke: { color: '#000000', width: 0.01, opacity: 0.5, join: 'round', cap: 'round', draw: { end: 0.5 } } });
      expect(unknown(s)).toEqual([]);
    });
  });
});
