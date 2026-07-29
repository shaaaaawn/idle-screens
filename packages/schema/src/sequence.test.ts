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
