// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRng, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { compileSaver, manifestFor } from './compile';
import type { SaverSpec } from './types';
import {
  SNOWFALL_SPEC,
  AQUARIUM_SPEC,
  RAIN_SPEC,
  EXAMPLE_SPECS,
} from './examples';

// ---------------------------------------------------------------------------
// Canvas 2d mock — happy-dom does not provide a real canvas context.
// ---------------------------------------------------------------------------

function stubGradient() {
  return { addColorStop: vi.fn() };
}

function stub2dContext(): CanvasRenderingContext2D {
  return {
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((s: string) => ({ width: s.length * 8 })),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    createLinearGradient: vi.fn(() => stubGradient()),
    createRadialGradient: vi.fn(() => stubGradient()),
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
    lineWidth: 1,
    lineCap: 'butt',
  } as unknown as CanvasRenderingContext2D;
}

let mockCtx: CanvasRenderingContext2D;
let origGetContext: HTMLCanvasElement['getContext'];

beforeEach(() => {
  mockCtx = stub2dContext();
  origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => mockCtx) as any;
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function saverCtx(overrides: Partial<SaverContext> = {}): SaverContext {
  return {
    host: document.createElement('div'),
    dpr: 1,
    width: 640,
    height: 400,
    rng: createRng(42),
    seed: 42,
    reducedMotion: false,
    ...overrides,
  };
}

/** Build a minimal valid spec with a given total entity count. */
function specWithCount(count: number): SaverSpec {
  return {
    schemaVersion: 1,
    id: 'test',
    label: 'Test',
    units: 'px',
    layers: [
      {
        count,
        sprite: { kind: 'circle', radius: [3, 6], color: '#ffffff' },
        motion: { type: 'static' },
      },
    ],
  };
}

/** Synchronously mount a plugin (SpecInstance.mount is always sync). */
function mountSync(plugin: ReturnType<typeof compileSaver>, ctx?: SaverContext): SaverInstance {
  const result = plugin.mount(ctx ?? saverCtx());
  // compileSaver's mount is synchronous, but the interface allows Promise.
  if (result instanceof Promise) throw new Error('Expected synchronous mount');
  return result;
}

// ---------------------------------------------------------------------------
// compileSaver — valid specs
// ---------------------------------------------------------------------------

describe('compileSaver', () => {
  it('compiles SNOWFALL_SPEC and returns a SaverPlugin with correct manifest fields', () => {
    const plugin = compileSaver(SNOWFALL_SPEC);
    expect(plugin.manifest.id).toBe('snowfall');
    expect(plugin.manifest.label).toBe('Snowfall');
    expect(plugin.manifest.workerReady).toBe(true);
    expect(plugin.manifest.minBackend).toBe('canvas2d');
    expect(plugin.manifest.passthrough).toBe(false);
    expect(plugin.manifest.a11y?.flashSafe).toBe(true);
    expect(typeof plugin.mount).toBe('function');
    expect(plugin.spec).toBe(SNOWFALL_SPEC);
  });

  it('the compiled plugin mounts and returns a SaverInstance with the expected methods', () => {
    const plugin = compileSaver(SNOWFALL_SPEC);
    const inst = mountSync(plugin);
    expect(typeof inst.setPaused).toBe('function');
    expect(typeof inst.resize).toBe('function');
    expect(typeof inst.dispose).toBe('function');
    expect(typeof inst.renderFrame).toBe('function');
    inst.dispose();
  });

  it('mount -> renderFrame -> dispose lifecycle works without error', () => {
    const plugin = compileSaver(SNOWFALL_SPEC);
    const inst = mountSync(plugin);
    expect(() => inst.renderFrame!(0, 42)).not.toThrow();
    expect(() => inst.renderFrame!(1000, 42)).not.toThrow();
    expect(() => inst.renderFrame!(5000, 42)).not.toThrow();
    expect(() => inst.dispose()).not.toThrow();
  });

  it('mount -> setPaused(true) -> setPaused(false) -> dispose works', () => {
    const plugin = compileSaver(SNOWFALL_SPEC);
    const inst = mountSync(plugin);
    expect(() => inst.setPaused(true)).not.toThrow();
    expect(() => inst.setPaused(false)).not.toThrow();
    expect(() => inst.dispose()).not.toThrow();
  });

  it('mount with reducedMotion renders a single frame and starts paused', () => {
    const plugin = compileSaver(SNOWFALL_SPEC);
    const ctx = saverCtx({ reducedMotion: true });
    const inst = mountSync(plugin, ctx);
    // Constructor renders one frame when reducedMotion is true.
    expect(mockCtx.fillRect).toHaveBeenCalled();
    inst.dispose();
  });

  it('resize rebuilds and re-renders without error', () => {
    const plugin = compileSaver(SNOWFALL_SPEC);
    const inst = mountSync(plugin);
    expect(() => inst.resize(1920, 1080, 2)).not.toThrow();
    expect(() => inst.renderFrame!(0, 42)).not.toThrow();
    inst.dispose();
  });

  it('applyTrack is exposed and callable', () => {
    const plugin = compileSaver(SNOWFALL_SPEC);
    const inst = mountSync(plugin);
    expect(typeof inst.applyTrack).toBe('function');
    // An empty track should not throw.
    expect(() => inst.applyTrack!({ program: 'test', seed: 42, deltas: [] })).not.toThrow();
    inst.dispose();
  });
});

// ---------------------------------------------------------------------------
// manifestFor — derivation
// ---------------------------------------------------------------------------

describe('manifestFor', () => {
  it('returns correct id and label from spec', () => {
    const m = manifestFor(SNOWFALL_SPEC);
    expect(m.id).toBe('snowfall');
    expect(m.label).toBe('Snowfall');
  });

  it('sets workerReady to true', () => {
    expect(manifestFor(SNOWFALL_SPEC).workerReady).toBe(true);
  });

  it('sets minBackend to canvas2d', () => {
    expect(manifestFor(SNOWFALL_SPEC).minBackend).toBe('canvas2d');
  });

  it('sets passthrough to false', () => {
    expect(manifestFor(SNOWFALL_SPEC).passthrough).toBe(false);
  });

  it('flashSafe is true (schema savers are flash-safe by construction)', () => {
    expect(manifestFor(SNOWFALL_SPEC).a11y?.flashSafe).toBe(true);
  });

  it('derives motionIntensity from spec (calm)', () => {
    expect(manifestFor(SNOWFALL_SPEC).motionIntensity).toBe('calm');
  });

  it('defaults motionIntensity to moderate when spec omits it', () => {
    const spec: SaverSpec = { ...specWithCount(10), motionIntensity: undefined };
    expect(manifestFor(spec).motionIntensity).toBe('moderate');
  });

  it('passes through energetic motionIntensity', () => {
    const spec: SaverSpec = { ...specWithCount(10), motionIntensity: 'energetic' };
    expect(manifestFor(spec).motionIntensity).toBe('energetic');
  });

  // costTier boundaries: <30 idle, <150 low, <400 medium, >=400 high
  it('derives costTier idle for count < 30', () => {
    expect(manifestFor(specWithCount(1)).costTier).toBe('idle');
    expect(manifestFor(specWithCount(29)).costTier).toBe('idle');
  });

  it('derives costTier low for count 30..149', () => {
    expect(manifestFor(specWithCount(30)).costTier).toBe('low');
    expect(manifestFor(specWithCount(149)).costTier).toBe('low');
  });

  it('derives costTier medium for count 150..399', () => {
    expect(manifestFor(specWithCount(150)).costTier).toBe('medium');
    expect(manifestFor(specWithCount(399)).costTier).toBe('medium');
  });

  it('derives costTier high for count >= 400', () => {
    // manifestFor does not validate, so count > maxPerLayer is fine here.
    const spec: SaverSpec = {
      schemaVersion: 1,
      id: 'big',
      label: 'Big',
      units: 'px',
      layers: [
        { count: 200, sprite: { kind: 'circle', radius: [1, 2], color: '#fff' }, motion: { type: 'static' } },
        { count: 200, sprite: { kind: 'circle', radius: [1, 2], color: '#fff' }, motion: { type: 'static' } },
      ],
    };
    expect(manifestFor(spec).costTier).toBe('high');
  });

  it('sums counts across multiple layers for costTier', () => {
    // 2 layers of 20 = 40 total -> low (not idle)
    const spec: SaverSpec = {
      schemaVersion: 1,
      id: 'multi',
      label: 'Multi',
      units: 'px',
      layers: [
        { count: 20, sprite: { kind: 'emoji', glyphs: ['*'] }, size: [10, 20], motion: { type: 'static' } },
        { count: 20, sprite: { kind: 'emoji', glyphs: ['*'] }, size: [10, 20], motion: { type: 'static' } },
      ],
    };
    expect(manifestFor(spec).costTier).toBe('low');
  });

  it('derives manifest correctly for real examples', () => {
    // AQUARIUM: 14 + 22 = 36 -> low
    expect(manifestFor(AQUARIUM_SPEC).costTier).toBe('low');
    expect(manifestFor(AQUARIUM_SPEC).motionIntensity).toBe('calm');

    // RAIN: 140 -> low
    expect(manifestFor(RAIN_SPEC).costTier).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('compileSaver error cases', () => {
  it('throws on null', () => {
    expect(() => compileSaver(null)).toThrow(/invalid saver spec/);
  });

  it('throws on non-object', () => {
    expect(() => compileSaver('hello')).toThrow(/invalid saver spec/);
    expect(() => compileSaver(42)).toThrow(/invalid saver spec/);
  });

  it('throws on spec with missing layers', () => {
    expect(() => compileSaver({
      schemaVersion: 1,
      id: 'bad',
      label: 'Bad',
    })).toThrow(/invalid saver spec/);
  });

  it('throws on spec with empty layers array', () => {
    expect(() => compileSaver({
      schemaVersion: 1,
      id: 'bad',
      label: 'Bad',
      layers: [],
    })).toThrow(/invalid saver spec/);
  });

  it('throws on spec with count > 400 (maxPerLayer)', () => {
    expect(() => compileSaver({
      schemaVersion: 1,
      id: 'bad',
      label: 'Bad',
      units: 'px',
      layers: [
        { count: 401, sprite: { kind: 'circle', radius: [1, 2], color: '#fff' }, motion: { type: 'static' } },
      ],
    })).toThrow(/invalid saver spec/);
  });

  it('throws descriptive error mentioning the invalid path', () => {
    try {
      compileSaver({
        schemaVersion: 1,
        id: 'bad',
        label: 'Bad',
        layers: [],
      });
      expect.fail('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('invalid saver spec');
      expect(msg).toContain('layers');
    }
  });

  it('throws on wrong schemaVersion', () => {
    expect(() => compileSaver({
      schemaVersion: 2,
      id: 'bad',
      label: 'Bad',
      layers: [{ count: 1, sprite: { kind: 'emoji', glyphs: ['x'] }, size: [10, 10], motion: { type: 'static' } }],
    })).toThrow(/invalid saver spec/);
  });
});

// ---------------------------------------------------------------------------
// All examples compile
// ---------------------------------------------------------------------------

describe('all example specs compile', () => {
  for (const spec of EXAMPLE_SPECS) {
    it(`${spec.id} compiles without error`, () => {
      const plugin = compileSaver(spec);
      expect(plugin.manifest.id).toBe(spec.id);
      expect(plugin.manifest.label).toBe(spec.label);
      expect(typeof plugin.mount).toBe('function');
    });
  }

  it('all examples mount and dispose without error', () => {
    for (const spec of EXAMPLE_SPECS) {
      const plugin = compileSaver(spec);
      const inst = mountSync(plugin);
      inst.dispose();
    }
  });
});

// ---------------------------------------------------------------------------

describe('font size parsing is not a denial of service', () => {
  // `sprite.font` is authored input — on idlescreens.com any agent that can
  // publish a scene controls it. The size regex used to be `(\d*\.?\d+)px`,
  // where two quantifiers can split one digit run many ways, so a long run
  // that never reaches "px" made the engine retry every split at every start
  // position: 1 000 digits took 600ms, 5 000 took 62 seconds. Bounding the
  // runs makes the work per position constant.
  it('a long hostile digit run compiles in linear time', () => {
    // 2 000, not 50 000, on purpose. Measured against the old regex: 1 000
    // digits = 600ms, 2 000 ≈ 5s, 5 000 = 62s, 50 000 did not finish in ten
    // minutes. A test that HANGS when the bug returns is worse than one that
    // fails — this size is decisively over budget while still terminating.
    const hostile = '9'.repeat(2_000); // no "px" — the worst case for backtracking
    const spec = {
      schemaVersion: 1 as const,
      id: 'redos-probe',
      label: 'ReDoS probe',
      units: 'px' as const,
      layers: [
        {
          key: 'text',
          count: 1,
          sprite: { kind: 'text' as const, strings: ['x'], font: hostile },
          motion: { type: 'static' as const },
        },
      ],
    };

    const started = performance.now();
    const inst = mountSync(compileSaver(spec));
    inst.renderFrame?.(0, 1);
    inst.dispose();
    const elapsed = performance.now() - started;

    // Generous: the old regex needed minutes for this input, the new one is
    // single-digit milliseconds. Anything under a second proves it is not
    // backtracking, without making the test flaky on a loaded CI box.
    expect(elapsed).toBeLessThan(1000);
  });

  it('still reads every CSS size shape it used to', () => {
    // Guards the bounded quantifiers against over-tightening: each of these
    // must still be recognised as carrying an explicit px size.
    for (const font of ['16px', '16.5px', '.5px', '0.5px', 'bold 26px monospace', '12px/1.4 system-ui']) {
      const spec = {
        schemaVersion: 1 as const,
        id: 'font-shape',
        label: 'Font shape',
        units: 'viewport' as const,
        layers: [
          {
            key: 'text',
            count: 1,
            sprite: { kind: 'text' as const, strings: ['x'], font },
            motion: { type: 'static' as const },
          },
        ],
      };
      const inst = mountSync(compileSaver(spec));
      expect(() => inst.renderFrame?.(0, 1), `font "${font}" should compile`).not.toThrow();
      inst.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// textBlock glyphFade drawing (G6)
// ---------------------------------------------------------------------------

describe('textBlock glyphFade drawing', () => {
  function glyphFadeSpec(progress: number, reveal: Record<string, unknown> = {}): SaverSpec {
    return {
      schemaVersion: 1,
      id: 'gf',
      label: 'Glyph fade',
      layers: [
        {
          count: 1,
          sprite: {
            kind: 'textBlock',
            text: 'Hi there',
            maxWidth: 0.9,
            fontSize: 0.05,
            reveal: { mode: 'glyphFade', progress, ...reveal },
          },
          motion: { type: 'static' },
          position: { x: 0.05, y: 0.05 },
        },
      ],
    } as SaverSpec;
  }

  /** Render one frame and record every fillText with the alpha it drew at. */
  function renderAndCollect(spec: SaverSpec): Array<{ text: string; x: number; alpha: number }> {
    const calls: Array<{ text: string; x: number; alpha: number }> = [];
    (mockCtx as { fillText: unknown }).fillText = vi.fn((text: string, x: number) => {
      calls.push({ text, x, alpha: (mockCtx as { globalAlpha: number }).globalAlpha });
    });
    const inst = mountSync(compileSaver(spec));
    inst.renderFrame!(0, 42);
    inst.dispose();
    return calls;
  }

  it('draws nothing at progress 0 and every glyph opaque at progress 1', () => {
    expect(renderAndCollect(glyphFadeSpec(0)).length).toBe(0);
    const full = renderAndCollect(glyphFadeSpec(1));
    expect(full.map((c) => c.text).join('')).toBe('Hi there');
    expect(full.every((c) => c.alpha === 1)).toBe(true);
    // Fully revealed, the whole line is ONE draw call — identical to the
    // no-reveal path, so ligatures and kerning match it exactly (#97).
    expect(full.length).toBe(1);
  });

  it('batches the opaque prefix into one fillText and fades only the tail', () => {
    // fade 0.5 at progress 0.9: glyphs 0–6 have saturated (alpha 1), glyph 7
    // is still fading — so exactly two draws: the batched run, then the tail
    // glyph positioned at the run's advance (mock measureText: 8px/char).
    const calls = renderAndCollect(glyphFadeSpec(0.9, { fade: 0.5 }));
    expect(calls.length).toBe(2);
    expect(calls[0]).toMatchObject({ text: 'Hi ther', alpha: 1 });
    expect(calls[1]!.text).toBe('e');
    expect(calls[1]!.alpha).toBeLessThan(1);
    expect(calls[1]!.x - calls[0]!.x).toBe('Hi ther'.length * 8);
  });

  it('draws a partial reveal glyph-by-glyph with falling alpha', () => {
    const calls = renderAndCollect(glyphFadeSpec(0.3, { fade: 0.5 }));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThan(8); // 'Hi there' = 8 graphemes
    expect('Hi there'.startsWith(calls.map((c) => c.text).join(''))).toBe(true);
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i]!.alpha).toBeLessThanOrEqual(calls[i - 1]!.alpha);
    }
  });

  it('glyph positions come from prefix advances and never shift as alpha ramps', () => {
    // Index-wise call comparison is only valid while no glyph has saturated —
    // once one hits alpha 1 it joins the batched prefix draw (#97). fade 0.5:
    // at 0.25 and 0.45 every drawn glyph is still mid-fade, so both renders
    // are pure per-glyph and positions must be bit-identical.
    const some = renderAndCollect(glyphFadeSpec(0.25, { fade: 0.5 }));
    const more = renderAndCollect(glyphFadeSpec(0.45, { fade: 0.5 }));
    expect(some.length).toBeGreaterThan(0);
    for (let i = 0; i < some.length; i++) {
      expect(more[i]!.text).toBe(some[i]!.text);
      expect(more[i]!.x).toBe(some[i]!.x);
    }
  });
});
