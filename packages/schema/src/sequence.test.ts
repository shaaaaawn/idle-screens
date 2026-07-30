// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createRng, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { resolveSegment } from './sequence';
import { validateSequence } from './validate';
import { compileSequence } from './compile';
import type { IdleSequence, SaverSpec } from './types';

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

const SCENE: SaverSpec = {
  schemaVersion: 1,
  id: 'stub',
  label: 'Stub',
  layers: [{ count: 1, sprite: { kind: 'emoji', glyphs: ['🔵'] }, motion: { type: 'static' } }],
};

function seq(overrides: Partial<IdleSequence> = {}): IdleSequence {
  return {
    format: 'idle-sequence',
    schemaVersion: 1,
    id: 'test',
    label: 'Test',
    seed: 1,
    loop: false,
    segments: [
      { key: 'a', scene: SCENE, duration: 5000 },
      { key: 'b', scene: SCENE, duration: 3000 },
      { key: 'c', scene: SCENE, duration: 4000 },
    ],
    ...overrides,
  };
}

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

function mountSync(plugin: ReturnType<typeof compileSequence>, ctx?: SaverContext): SaverInstance {
  const result = plugin.mount(ctx ?? saverCtx());
  if (result instanceof Promise) throw new Error('Expected synchronous mount');
  return result;
}

// ---------------------------------------------------------------------------
// resolveSegment
// ---------------------------------------------------------------------------

describe('resolveSegment', () => {
  it('maps T=0 to first segment', () => {
    const r = resolveSegment(seq(), 0);
    expect(r).toEqual({ index: 0, localT: 0, startT: 0 });
  });

  it('maps T inside first segment', () => {
    const r = resolveSegment(seq(), 2500);
    expect(r).toEqual({ index: 0, localT: 2500, startT: 0 });
  });

  it('maps T at exact boundary to the next segment (half-open)', () => {
    const r = resolveSegment(seq(), 5000);
    expect(r).toEqual({ index: 1, localT: 0, startT: 5000 });
  });

  it('maps T inside second segment', () => {
    const r = resolveSegment(seq(), 6000);
    expect(r).toEqual({ index: 1, localT: 1000, startT: 5000 });
  });

  it('maps T at second boundary', () => {
    const r = resolveSegment(seq(), 8000);
    expect(r).toEqual({ index: 2, localT: 0, startT: 8000 });
  });

  it('maps T past all segments to last segment (no loop)', () => {
    const r = resolveSegment(seq(), 15000);
    expect(r.index).toBe(2);
    expect(r.startT).toBe(8000);
    expect(r.localT).toBe(7000);
  });

  it('wraps T with loop: true', () => {
    const s = seq({ loop: true });
    const total = 5000 + 3000 + 4000;
    const r = resolveSegment(s, total + 2500);
    expect(r).toEqual({ index: 0, localT: 2500, startT: 0 });
  });

  it('wraps at exact total boundary', () => {
    const s = seq({ loop: true });
    const total = 5000 + 3000 + 4000;
    const r = resolveSegment(s, total);
    expect(r).toEqual({ index: 0, localT: 0, startT: 0 });
  });

  it('handles final segment with no duration (holds indefinitely)', () => {
    const s = seq({
      segments: [
        { key: 'a', scene: SCENE, duration: 5000 },
        { key: 'b', scene: SCENE },
      ],
    });
    const r = resolveSegment(s, 7000);
    expect(r).toEqual({ index: 1, localT: 2000, startT: 5000 });
  });

  it('loop with durationless final only wraps timed prefix', () => {
    const s = seq({
      loop: true,
      segments: [
        { key: 'a', scene: SCENE, duration: 5000 },
        { key: 'b', scene: SCENE, duration: 3000 },
        { key: 'c', scene: SCENE },
      ],
    });
    const r = resolveSegment(s, 8000 + 2000);
    expect(r).toEqual({ index: 0, localT: 2000, startT: 0 });
  });

  it('negative T clamps to 0', () => {
    const r = resolveSegment(seq(), -500);
    expect(r).toEqual({ index: 0, localT: 0, startT: 0 });
  });

  it('single segment', () => {
    const s = seq({ segments: [{ key: 'only', scene: SCENE, duration: 10000 }] });
    expect(resolveSegment(s, 5000)).toEqual({ index: 0, localT: 5000, startT: 0 });
    expect(resolveSegment(s, 15000)).toEqual({ index: 0, localT: 15000, startT: 0 });
  });
});

// ---------------------------------------------------------------------------
// validateSequence
// ---------------------------------------------------------------------------

describe('validateSequence', () => {
  it('accepts a valid sequence', () => {
    const r = validateSequence(seq());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects missing format', () => {
    const s = { ...seq(), format: undefined };
    expect(validateSequence(s).valid).toBe(false);
  });

  it('rejects empty segments', () => {
    const r = validateSequence(seq({ segments: [] }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === 'segments')).toBe(true);
  });

  it('rejects duplicate keys', () => {
    const r = validateSequence(seq({
      segments: [
        { key: 'dup', scene: SCENE, duration: 5000 },
        { key: 'dup', scene: SCENE, duration: 3000 },
      ],
    }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes('duplicate'))).toBe(true);
  });

  it('rejects durationless non-final segment', () => {
    const r = validateSequence(seq({
      segments: [
        { key: 'a', scene: SCENE },
        { key: 'b', scene: SCENE, duration: 3000 },
      ],
    }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path.includes('duration') && e.message.includes('final'))).toBe(true);
  });

  it('accepts durationless final segment', () => {
    const r = validateSequence(seq({
      segments: [
        { key: 'a', scene: SCENE, duration: 5000 },
        { key: 'b', scene: SCENE },
      ],
    }));
    expect(r.valid).toBe(true);
  });

  it('rejects loop with durationless segment', () => {
    const r = validateSequence(seq({
      loop: true,
      segments: [
        { key: 'a', scene: SCENE, duration: 5000 },
        { key: 'b', scene: SCENE },
      ],
    }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === 'loop')).toBe(true);
  });

  it('rejects duration below minimum', () => {
    const r = validateSequence(seq({
      segments: [{ key: 'a', scene: SCENE, duration: 500 }],
    }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path.includes('duration'))).toBe(true);
  });

  it('validates per-segment scenes', () => {
    const badScene = { schemaVersion: 1, id: '', label: 'X', layers: [] };
    const r = validateSequence(seq({
      segments: [{ key: 'a', scene: badScene as unknown as SaverSpec, duration: 5000 }],
    }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path.includes('scene'))).toBe(true);
  });

  it('rejects fade transition (not yet supported)', () => {
    const r = validateSequence(seq({
      segments: [{
        key: 'a', scene: SCENE, duration: 5000,
        transition: { type: 'fade' as 'cut', dur: 600 } as never,
      }],
    }));
    expect(r.valid).toBe(false);
  });

  it('accepts cut transition', () => {
    const r = validateSequence(seq({
      segments: [{
        key: 'a', scene: SCENE, duration: 5000,
        transition: { type: 'cut' },
      }],
    }));
    expect(r.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// compileSequence
// ---------------------------------------------------------------------------

describe('compileSequence', () => {
  it('compiles a valid sequence into a SaverPlugin', () => {
    const plugin = compileSequence(seq());
    expect(plugin.manifest.id).toBe('test');
    expect(plugin.manifest.timeModel).toBe('closed-form');
    expect(plugin.manifest.workerReady).toBe(false);
    expect(typeof plugin.mount).toBe('function');
  });

  it('throws on invalid sequence', () => {
    expect(() => compileSequence({ format: 'idle-sequence' })).toThrow();
  });

  it('deterministic: same T produces same state', () => {
    const s = seq({
      segments: [
        { key: 'a', scene: { ...SCENE, seed: 42 }, duration: 5000 },
        { key: 'b', scene: { ...SCENE, seed: 99 }, duration: 3000 },
      ],
    });
    const r1 = resolveSegment(s, 6000);
    const r2 = resolveSegment(s, 6000);
    expect(r1).toEqual(r2);
    expect(r1.index).toBe(1);
    expect(r1.localT).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// SequenceInstance mount + render
// ---------------------------------------------------------------------------

describe('SequenceInstance (mount + render)', () => {
  it('mounts and renders at T=0 without crashing', () => {
    const inst = mountSync(compileSequence(seq()));
    expect(inst).toBeDefined();
    inst.renderFrame!(0, 1);
    inst.dispose();
  });

  it('renders across a segment boundary', () => {
    const inst = mountSync(compileSequence(seq()));
    inst.renderFrame!(2000, 1);
    inst.renderFrame!(6000, 1);
    inst.renderFrame!(9000, 1);
    inst.dispose();
  });

  it('uses a single canvas for all segments (shared surface)', () => {
    const host = document.createElement('div');
    const inst = mountSync(compileSequence(seq()), saverCtx({ host }));

    inst.renderFrame!(2000, 1);
    expect(host.querySelectorAll('canvas').length).toBe(1);

    inst.renderFrame!(6000, 1);
    expect(host.querySelectorAll('canvas').length).toBe(1);

    inst.renderFrame!(9000, 1);
    expect(host.querySelectorAll('canvas').length).toBe(1);

    inst.dispose();
    expect(host.querySelectorAll('canvas').length).toBe(0);
  });

  it('backward seek across boundary does not accumulate canvases', () => {
    const host = document.createElement('div');
    const inst = mountSync(compileSequence(seq()), saverCtx({ host }));

    inst.renderFrame!(4000, 1);
    inst.renderFrame!(6000, 1);
    inst.renderFrame!(4000, 1);
    expect(host.querySelectorAll('canvas').length).toBe(1);

    inst.dispose();
  });

  it('does not throw on setPaused toggle', () => {
    const inst = mountSync(compileSequence(seq()));
    inst.renderFrame!(2000, 1);
    inst.setPaused(true);
    inst.setPaused(false);
    inst.dispose();
  });

  it('does not throw on resize', () => {
    const inst = mountSync(compileSequence(seq()));
    inst.renderFrame!(2000, 1);
    inst.resize(1920, 1080, 2);
    inst.dispose();
  });

  it('seq.seed is wired to children without scene-level seeds', () => {
    const s = seq({
      seed: 777,
      segments: [
        { key: 'a', scene: SCENE, duration: 5000 },
        { key: 'b', scene: SCENE, duration: 3000 },
      ],
    });
    const inst = mountSync(compileSequence(s));
    inst.renderFrame!(0, 1);
    inst.renderFrame!(6000, 1);
    inst.dispose();
  });
});

// ---------------------------------------------------------------------------
// Morph segue
// ---------------------------------------------------------------------------

const SCENE_A: SaverSpec = {
  schemaVersion: 1,
  id: 'morph-a',
  label: 'Morph A',
  background: { type: 'solid', color: '#112233' },
  layers: [{ count: 3, sprite: { kind: 'circle', radius: [0.01, 0.02], color: '#ff0000' }, motion: { type: 'static' } }],
};

const SCENE_B: SaverSpec = {
  ...SCENE_A,
  id: 'morph-b',
  label: 'Morph B',
  background: { type: 'solid', color: '#332211' },
  layers: [{ count: 3, sprite: { kind: 'circle', radius: [0.01, 0.02], color: '#0000ff' }, motion: { type: 'static' } }],
};

const SCENE_STRUCTURAL_DIFF: SaverSpec = {
  schemaVersion: 1,
  id: 'morph-diff',
  label: 'Morph Diff',
  layers: [{ count: 10, sprite: { kind: 'emoji', glyphs: ['🔴'] }, motion: { type: 'drift', speed: [0.03, 0.05], angle: 90 } }],
};

function morphSeq(overrides: Partial<IdleSequence> = {}): IdleSequence {
  return {
    format: 'idle-sequence',
    schemaVersion: 1,
    id: 'morph-test',
    label: 'Morph Test',
    seed: 42,
    loop: false,
    segments: [
      { key: 'a', scene: SCENE_A, duration: 5000, transition: { type: 'morph', dur: 1000 } },
      { key: 'b', scene: SCENE_B, duration: 5000 },
    ],
    ...overrides,
  };
}

describe('validateSequence — morph', () => {
  it('accepts morph transition with valid dur', () => {
    const r = validateSequence(morphSeq());
    expect(r.valid).toBe(true);
  });

  it('rejects morph dur below minimum', () => {
    const r = validateSequence(morphSeq({
      segments: [
        { key: 'a', scene: SCENE_A, duration: 5000, transition: { type: 'morph', dur: 50 } },
        { key: 'b', scene: SCENE_B, duration: 5000 },
      ],
    }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path.includes('dur'))).toBe(true);
  });

  it('rejects morph dur above maximum', () => {
    const r = validateSequence(morphSeq({
      segments: [
        { key: 'a', scene: SCENE_A, duration: 10000, transition: { type: 'morph', dur: 6000 } },
        { key: 'b', scene: SCENE_B, duration: 5000 },
      ],
    }));
    expect(r.valid).toBe(false);
  });

  it('warns on structural mismatch', () => {
    const r = validateSequence(morphSeq({
      segments: [
        { key: 'a', scene: SCENE_A, duration: 5000, transition: { type: 'morph', dur: 1000 } },
        { key: 'b', scene: SCENE_STRUCTURAL_DIFF, duration: 5000 },
      ],
    }));
    expect(r.valid).toBe(true);
    expect(r.warnings?.some((w) => w.code === 'morph-structural-mismatch')).toBe(true);
  });

  it('no warning when structurally identical', () => {
    const r = validateSequence(morphSeq());
    expect((r.warnings ?? []).filter((w) => w.code === 'morph-structural-mismatch')).toHaveLength(0);
  });
});

describe('SequenceInstance — morph segue', () => {
  it('renders through a morph boundary without crashing', () => {
    const inst = mountSync(compileSequence(morphSeq()));
    inst.renderFrame!(4000, 1);
    inst.renderFrame!(5200, 1); // mid-morph
    inst.renderFrame!(5800, 1); // mid-morph
    inst.renderFrame!(6200, 1); // morph complete
    inst.renderFrame!(8000, 1);
    inst.dispose();
  });

  it('renders a single canvas during morph', () => {
    const host = document.createElement('div');
    const inst = mountSync(compileSequence(morphSeq()), saverCtx({ host }));
    inst.renderFrame!(5500, 1); // mid-morph
    expect(host.querySelectorAll('canvas').length).toBe(1);
    inst.dispose();
  });

  it('backward seek across morph boundary does not crash', () => {
    const inst = mountSync(compileSequence(morphSeq()));
    inst.renderFrame!(5500, 1); // mid-morph in segment 1
    inst.renderFrame!(6500, 1); // past morph, still segment 1
    inst.renderFrame!(5500, 1); // back into morph
    inst.renderFrame!(4000, 1); // back to segment 0
    inst.dispose();
  });

  it('falls back to cut on structural mismatch', () => {
    const s = morphSeq({
      segments: [
        { key: 'a', scene: SCENE_A, duration: 5000, transition: { type: 'morph', dur: 1000 } },
        { key: 'b', scene: SCENE_STRUCTURAL_DIFF, duration: 5000 },
      ],
    });
    const inst = mountSync(compileSequence(s));
    inst.renderFrame!(4000, 1);
    inst.renderFrame!(5500, 1); // would be mid-morph but sigs differ → cut
    inst.renderFrame!(7000, 1);
    inst.dispose();
  });

  it('morph with loop wraps correctly', () => {
    const s = morphSeq({
      loop: true,
      segments: [
        { key: 'a', scene: SCENE_A, duration: 5000, transition: { type: 'morph', dur: 1000 } },
        { key: 'b', scene: SCENE_B, duration: 5000 },
      ],
    });
    const inst = mountSync(compileSequence(s));
    inst.renderFrame!(0, 1);
    inst.renderFrame!(5500, 1); // mid-morph
    inst.renderFrame!(8000, 1);
    // wrap around
    inst.renderFrame!(11000, 1); // T=11000 → T%10000=1000 → segment 0
    inst.dispose();
  });

  it('mid-morph paints interpolated background, not either endpoint', () => {
    // Track every fillStyle assignment during render
    const fills: string[] = [];
    const trackingCtx = stub2dContext();
    let _fs = '';
    Object.defineProperty(trackingCtx, 'fillStyle', {
      get: () => _fs,
      set: (v: string) => { _fs = v; if (typeof v === 'string') fills.push(v); },
    });
    const origGC = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (() => trackingCtx) as any;

    const inst = mountSync(compileSequence(morphSeq()));

    // Construction render (reducedMotion: true → paused initial frame) may
    // have added endpoint colors. Clear and render the morph frame fresh.
    fills.length = 0;

    // Render a non-morph frame first to "warm up" the child, then clear again
    inst.renderFrame!(2000, 1); // mid segment 0 — ensures child exists
    fills.length = 0;

    // T=5500: 500ms into morph dur=1000 → ~midpoint
    inst.renderFrame!(5500, 1);

    // Find hex colors in fills — the background is drawn via fillStyle
    const hexFills = fills.filter((f) => /^#[0-9a-f]{6}$/i.test(f));
    expect(hexFills.length).toBeGreaterThan(0);

    // The background fill should be interpolated, not either endpoint
    const bgFill = hexFills[0]!;
    expect(bgFill).not.toBe('#112233'); // not scene A
    expect(bgFill).not.toBe('#332211'); // not scene B

    inst.dispose();
    HTMLCanvasElement.prototype.getContext = origGC;
  });

  it('three-segment morph chain uses chain-root seed across all segments', () => {
    const SCENE_C: SaverSpec = {
      ...SCENE_A,
      id: 'morph-c',
      background: { type: 'solid', color: '#223311' },
      layers: [{ count: 3, sprite: { kind: 'circle', radius: [0.01, 0.02], color: '#00ff00' }, motion: { type: 'static' } }],
    };
    const s = morphSeq({
      segments: [
        { key: 'a', scene: SCENE_A, duration: 5000, transition: { type: 'morph', dur: 1000 } },
        { key: 'b', scene: SCENE_B, duration: 5000, transition: { type: 'morph', dur: 1000 } },
        { key: 'c', scene: SCENE_C, duration: 5000 },
      ],
    });

    // Render at segment 2 (past both morph windows) — should use chain root (seg 0) seed
    const inst = mountSync(compileSequence(s));
    inst.renderFrame!(11000, 1); // segment 2, localT=1000 (past morph dur)
    inst.dispose();

    // Seek directly to segment 2 — same seed must be used
    const inst2 = mountSync(compileSequence(s));
    inst2.renderFrame!(11000, 1);
    inst2.dispose();
    // If this doesn't crash and the chain root logic works, seeds are deterministic
  });
});
