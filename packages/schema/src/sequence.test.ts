// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createRng, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { resolveSegment, segmentStart } from './sequence';
import { validateSequence } from './validate';
import { compileSaver, compileSequence, type SequenceMountContext } from './compile';
import { lerpSpec } from './steer';
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

  it("accepts sync: 'mount' | 'epoch' and rejects anything else (1b)", () => {
    expect(validateSequence(seq()).valid).toBe(true);
    expect(validateSequence(seq({ sync: 'mount' })).valid).toBe(true);
    expect(validateSequence(seq({ sync: 'epoch' })).valid).toBe(true);
    const bad = validateSequence({ ...seq(), sync: 'server' });
    expect(bad.valid).toBe(false);
    expect(bad.errors.some((e) => e.path === 'sync')).toBe(true);
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

  /**
   * F11 — sequences used to mount with no rAF loop (black canvas). Stub the
   * browser clock so we can assert the parent self-drives and that pause/resume
   * never starts a second (child) loop.
   */
  function stubRafQueue() {
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    });
    const caf = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
      pending.delete(Number(id));
    });
    const tick = (now: number) => {
      const batch = [...pending.entries()];
      for (const [id, cb] of batch) {
        pending.delete(id);
        cb(now);
      }
    };
    const restore = () => {
      raf.mockRestore();
      caf.mockRestore();
    };
    return { pending, tick, restore };
  }

  it('self-drives via rAF after mount (F11 — not black)', () => {
    const { pending, tick, restore } = stubRafQueue();
    mockCtx.fillRect = vi.fn();
    const inst = mountSync(compileSequence(seq()));

    expect(pending.size).toBe(1);
    expect(mockCtx.fillRect).not.toHaveBeenCalled();

    tick(16);
    expect(mockCtx.fillRect).toHaveBeenCalled();
    // Loop reschedules itself — still exactly one outstanding frame.
    expect(pending.size).toBe(1);

    inst.dispose();
    expect(pending.size).toBe(0);
    restore();
  });

  it('keeps a single parent rAF across pause/resume (no child double-drive)', () => {
    const { pending, tick, restore } = stubRafQueue();
    const inst = mountSync(compileSequence(seq()));

    tick(16); // ensure a child SpecInstance exists
    expect(pending.size).toBe(1);

    inst.setPaused(true);
    expect(pending.size).toBe(0);

    inst.setPaused(false);
    // Regression: forwarding pause=false to children started a second rAF.
    expect(pending.size).toBe(1);

    tick(100);
    expect(pending.size).toBe(1);

    inst.dispose();
    expect(pending.size).toBe(0);
    restore();
  });

  it('reducedMotion paints one frame and does not schedule rAF', () => {
    const { pending, restore } = stubRafQueue();
    mockCtx.fillRect = vi.fn();
    const inst = mountSync(compileSequence(seq()), saverCtx({ reducedMotion: true }));

    expect(pending.size).toBe(0);
    expect(mockCtx.fillRect).toHaveBeenCalled();

    inst.dispose();
    restore();
  });

  it('does not throw on resize', () => {
    const inst = mountSync(compileSequence(seq()));
    inst.renderFrame!(2000, 1);
    inst.resize(1920, 1080, 2);
    inst.dispose();
  });

  /**
   * Children are created lazily, so a resize must outlive the children that
   * exist when it arrives. Both halves of the bug: a viewer that mounts in an
   * unpainted tab (0×0) resizes before the first frame ever runs, and a
   * segment cut after any resize used to remount at the stale mount-time size
   * (the live symptom: a permanent 1×1 canvas).
   */
  it('resize before the first frame reaches the lazily-created child', () => {
    const { restore } = stubRafQueue();
    const host = document.createElement('div');
    const inst = mountSync(compileSequence(seq()), saverCtx({ host, width: 0, height: 0 }));

    inst.resize(1920, 1080);
    inst.renderFrame!(0, 1);

    const canvas = host.querySelector('canvas')!;
    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1080);
    inst.dispose();
    restore();
  });

  it('a segment switch after resize keeps the new size (and dpr)', () => {
    const host = document.createElement('div');
    const inst = mountSync(compileSequence(seq()), saverCtx({ host }));
    inst.renderFrame!(0, 1); // child for segment a, mounted at 640×400

    inst.resize(1920, 1080, 2);
    inst.renderFrame!(6000, 1); // segment b — a brand-new child

    const canvas = host.querySelector('canvas')!;
    expect(canvas.width).toBe(3840); // 1920 × dpr 2
    expect(canvas.height).toBe(2160);
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

  // morph-nothing-morphable — structural twins whose only differences are
  // values lerpSpec steps (textBlock.text above all). Warning, never error.
  const caption = (text: string, color: string): SaverSpec => ({
    schemaVersion: 1,
    id: 'caption',
    label: 'Caption',
    background: { type: 'solid', color: '#101010' },
    layers: [{
      count: 1,
      sprite: { kind: 'textBlock', text, maxWidth: 0.6, fontSize: 0.04, color },
      motion: { type: 'static' },
      position: { x: 0.2, y: 0.2 },
    }],
  });

  it('warns morph-nothing-morphable for text-only twins', () => {
    const r = validateSequence(morphSeq({
      segments: [
        { key: 'a', scene: caption('Act I', '#e6e8ef'), duration: 5000, transition: { type: 'morph', dur: 1000 } },
        { key: 'b', scene: caption('Act II', '#e6e8ef'), duration: 5000 },
      ],
    }));
    expect(r.valid).toBe(true);
    const w = (r.warnings ?? []).filter((x) => x.code === 'morph-nothing-morphable');
    expect(w).toHaveLength(1);
    expect(w[0]!.path).toBe('segments[0].transition');
    expect((r.warnings ?? []).filter((x) => x.code === 'morph-structural-mismatch')).toHaveLength(0);
  });

  it('is silent for colour twins (the colour glides, so the morph is visible)', () => {
    const r = validateSequence(morphSeq({
      segments: [
        { key: 'a', scene: caption('Act I', '#e6e8ef'), duration: 5000, transition: { type: 'morph', dur: 1000 } },
        { key: 'b', scene: caption('Act II', '#101010'), duration: 5000 },
      ],
    }));
    expect((r.warnings ?? []).filter((x) => x.code === 'morph-nothing-morphable')).toHaveLength(0);
  });

  it('is silent for a cut between text-only twins', () => {
    const r = validateSequence(morphSeq({
      segments: [
        { key: 'a', scene: caption('Act I', '#e6e8ef'), duration: 5000, transition: { type: 'cut' } },
        { key: 'b', scene: caption('Act II', '#e6e8ef'), duration: 5000 },
      ],
    }));
    expect((r.warnings ?? []).filter((x) => x.code === 'morph-nothing-morphable')).toHaveLength(0);
  });

  it('is silent for identical twins (a no-op morph is continuity, not a cut)', () => {
    const r = validateSequence(morphSeq({
      segments: [
        { key: 'a', scene: caption('Act I', '#e6e8ef'), duration: 5000, transition: { type: 'morph', dur: 1000 } },
        { key: 'b', scene: caption('Act I', '#e6e8ef'), duration: 5000 },
      ],
    }));
    expect((r.warnings ?? []).filter((x) => x.code === 'morph-nothing-morphable')).toHaveLength(0);
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

  it('preserves paint steering after a completed morph', () => {
    const inst = mountSync(compileSequence(morphSeq()));
    inst.renderFrame!(7000, 1);
    inst.applyTrack!({
      program: 'test',
      seed: 1,
      deltas: [{ t: 7000, path: 'background.color', value: '#ff0000', ease: 'step', dur: 0 }],
    });

    const activeSpec = (): SaverSpec => {
      const state = inst as unknown as { activeIndex: number; children: Array<{ effSpec: SaverSpec } | null> };
      return state.children[state.activeIndex]!.effSpec;
    };
    expect(activeSpec().background).toEqual({ type: 'solid', color: '#ff0000' });

    inst.renderFrame!(7016, 1);
    expect(activeSpec().background).toEqual({ type: 'solid', color: '#ff0000' });
    inst.dispose();
  });
});

// ---------------------------------------------------------------------------
// Track retention — a steer lands on the segment that owns the path.
//
// Children are created lazily and disposed at every boundary, so before this
// a steer forwarded to the active child alone died with it, and a steer to a
// path only a later segment owns (`bars.sprite.values` while the title slide was up)
// landed nowhere. Plan Phase 2.1, viewer half (idle-mono
// docs/ambient-presentation-implementation-plan.md).
// ---------------------------------------------------------------------------

describe('SequenceInstance — retained track', () => {
  const BARS: SaverSpec = {
    schemaVersion: 1,
    id: 'bars',
    label: 'Bars',
    layers: [{
      key: 'bars',
      count: 3,
      sprite: { kind: 'bar', values: [10, 20, 30], max: 100, length: 0.5, thickness: 0.02, color: '#17e8c8' },
      motion: { type: 'static' },
      position: { x: 0.3, y: 0.3 },
      layout: { type: 'list', gap: 0.1 },
    }],
  };
  /** Segments 0 and 1 are title cards without `bars`; segment 2 owns it. */
  const barsSeq = (): IdleSequence => seq({
    segments: [
      { key: 'a', scene: SCENE, duration: 5000 },
      { key: 'b', scene: SCENE, duration: 3000 },
      { key: 'c', scene: BARS, duration: 4000 },
    ],
  });
  const childSpec = (inst: SaverInstance, index: number): SaverSpec | undefined =>
    (inst as unknown as { children: Array<{ effSpec: SaverSpec } | null> }).children[index]?.effSpec;
  const barValues = (spec: SaverSpec | undefined): unknown => (spec?.layers[0]?.sprite as { values?: unknown } | undefined)?.values;
  const steer = (inst: SaverInstance, path: string, value: unknown): void =>
    inst.applyTrack!({ program: 'test', seed: 1, deltas: [{ t: 0, path, value, ease: 'step', dur: 0 }] } as never);

  it('a steer to a path only a later segment owns lands there when the timer reaches it', () => {
    const inst = mountSync(compileSequence(barsSeq()));
    inst.renderFrame!(1000, 1); // segment 0 — no `bars` layer here
    steer(inst, 'bars.sprite.values', [90, 80, 70]);
    expect(childSpec(inst, 0)!.layers).toEqual(SCENE.layers); // dropped on the child that does not own the key
    inst.renderFrame!(9000, 1); // segment 2, created now
    expect(activeIndexOf(inst)).toBe(2);
    expect(barValues(childSpec(inst, 2))).toEqual([90, 80, 70]);
    inst.dispose();
  });

  it('… and when the clicker jumps to it in the same track', () => {
    const inst = mountSync(compileSequence(barsSeq()));
    inst.renderFrame!(1000, 1);
    inst.applyTrack!({
      program: 'test',
      seed: 1,
      deltas: [
        { t: 0, path: 'bars.sprite.values', value: [5, 6, 7], ease: 'step', dur: 0 },
        { t: 0, path: 'sequence.segment', value: 2, ease: 'step' },
      ],
    } as never);
    expect(activeIndexOf(inst)).toBe(2);
    expect(barValues(childSpec(inst, 2))).toEqual([5, 6, 7]);
    inst.dispose();
  });

  it('survives leaving and re-entering the segment (the child is rebuilt from the retained set)', () => {
    const inst = mountSync(compileSequence(barsSeq()));
    inst.renderFrame!(9000, 1);
    steer(inst, 'bars.sprite.values', [1, 2, 3]);
    expect(barValues(childSpec(inst, 2))).toEqual([1, 2, 3]); // active child: applied on this call
    steerTo(inst, 0);
    expect(childSpec(inst, 2)).toBeUndefined(); // disposed on the switch
    steerTo(inst, 2);
    expect(barValues(childSpec(inst, 2))).toEqual([1, 2, 3]);
    inst.dispose();
  });

  it('last wins per path across calls; a delta invalid for a child is skipped without taking the rest down', () => {
    const inst = mountSync(compileSequence(barsSeq()));
    inst.renderFrame!(1000, 1);
    steer(inst, 'bars.sprite.values', [1, 1, 1]);
    steer(inst, 'bars.sprite.values', [2, 2, 2]);
    steer(inst, 'layers.0.count', 5000); // resolves on every segment, valid on none (entity cap)
    inst.renderFrame!(9000, 1);
    expect(barValues(childSpec(inst, 2))).toEqual([2, 2, 2]);
    expect(childSpec(inst, 2)!.layers[0]!.count).toBe(3);
    inst.dispose();
  });

  it('a steer to a path the active child owns still applies immediately', () => {
    const inst = mountSync(compileSequence(morphSeq()));
    inst.renderFrame!(1000, 1);
    steer(inst, 'background.color', '#ff0000');
    expect(childSpec(inst, 0)!.background).toEqual({ type: 'solid', color: '#ff0000' });
    inst.dispose();
  });

  it('a steered colour rides through a morph instead of vanishing for `dur` (both lerp endpoints carry the track)', () => {
    const inst = mountSync(compileSequence(morphSeq()));
    inst.renderFrame!(1000, 1);
    steer(inst, 'background.color', '#ff0000');
    inst.renderFrame!(5500, 1); // mid-morph: hotSwapPaint(lerp(A, B, k)) on the chain root
    expect(childSpec(inst, 0)!.background).toEqual({ type: 'solid', color: '#ff0000' });
    inst.renderFrame!(7000, 1); // morph finalised: segment 1's child is created fresh from the root scene
    expect(activeIndexOf(inst)).toBe(1);
    expect(childSpec(inst, 1)!.background).toEqual({ type: 'solid', color: '#ff0000' });
    inst.dispose();
  });

  it('no track ⇒ the children render the untouched scene objects (byte-identical path)', () => {
    // No sequence seed, so childScene hands the child the stored scene itself.
    const inst = mountSync(compileSequence({ ...barsSeq(), seed: undefined }));
    inst.renderFrame!(1000, 1);
    expect(childSpec(inst, 0)).toBe(SCENE);
    inst.renderFrame!(9000, 1);
    expect(childSpec(inst, 2)).toBe(BARS);
    inst.dispose();
  });

  it('a steer that arrives while a morph is already in progress takes effect immediately, not on the next natural frame', () => {
    // Regression: the chain-root child (the one actually rendering mid-morph)
    // is never keyed at children[activeIndex], so forwarding a plain
    // child.applyTrack() there was silently a no-op. Without an explicit
    // re-render, the retained delta would sit un-painted until some other
    // caller happened to render the next frame.
    const inst = mountSync(compileSequence(morphSeq()));
    inst.renderFrame!(5500, 1); // mid-morph: hotSwapPaint(lerp(A, B, k)) already blending toward B
    expect(childSpec(inst, 0)!.background).not.toEqual({ type: 'solid', color: '#ff0000' });
    steer(inst, 'background.color', '#ff0000'); // no further renderFrame call follows
    // Both lerp endpoints now carry the same steered colour, so the lerp is a
    // no-op regardless of progress k — the value is exact, not merely closer.
    expect(childSpec(inst, 0)!.background).toEqual({ type: 'solid', color: '#ff0000' });
    inst.dispose();
  });
});

// ---------------------------------------------------------------------------
// Discrete advance — the clicker.
//
// These began life as characterization tests pinning two gaps (a steer that
// reverted on the next frame, an `advance` field no runtime read). They now pin
// the behaviour a deck needs: the segment steer holds, and `advance: 'input'`
// waits for the presenter. See idle-mono docs/timeline-and-presentations.md
// (registry #3 presentations, #43 input advance).
// ---------------------------------------------------------------------------

/** SequenceInstance keeps the resolved segment in a private field. */
function activeIndexOf(inst: SaverInstance): number {
  return (inst as unknown as { activeIndex: number }).activeIndex;
}

function steerTo(inst: SaverInstance, segment: number): void {
  inst.applyTrack!({ program: 'test', seed: 1, deltas: [{ t: 0, path: 'sequence.segment', value: segment, ease: 'step' }] });
}

describe('SequenceInstance — sequence.segment steering is sticky', () => {
  it('applyTrack switches the active segment', () => {
    const inst = mountSync(compileSequence(seq()));
    inst.renderFrame!(1000, 1);
    expect(activeIndexOf(inst)).toBe(0);

    steerTo(inst, 2);
    expect(activeIndexOf(inst)).toBe(2);
    inst.dispose();
  });

  it('and the next frame keeps it there — the steer moves the clock, not the frame', () => {
    const inst = mountSync(compileSequence(seq()));
    inst.renderFrame!(1000, 1);
    steerTo(inst, 2);
    expect(activeIndexOf(inst)).toBe(2);

    // One rAF tick later, and many after that: the wall clock keeps ticking
    // but the displaced timeline resolves to the steered segment.
    inst.renderFrame!(1016, 1);
    expect(activeIndexOf(inst)).toBe(2);
    inst.renderFrame!(3000, 1);
    expect(activeIndexOf(inst)).toBe(2);
    inst.dispose();
  });

  it('the steered segment starts from its own localT 0 and then runs on the timer', () => {
    // c (index 2) is 4000 ms. Steered into at wall 1000 ⇒ it ends at wall 5000
    // and, with no durationless tail, the sequence holds on its last segment.
    const inst = mountSync(compileSequence(seq()));
    inst.renderFrame!(1000, 1);
    steerTo(inst, 2);
    inst.renderFrame!(4999, 1);
    expect(activeIndexOf(inst)).toBe(2);

    // Steering BACK to a is honoured too, and the timer advances from there.
    steerTo(inst, 0);
    expect(activeIndexOf(inst)).toBe(0);
    inst.renderFrame!(4999 + 4999, 1); // 4999 ms into a (5000 ms long)
    expect(activeIndexOf(inst)).toBe(0);
    inst.renderFrame!(4999 + 5000, 1); // a's boundary → b
    expect(activeIndexOf(inst)).toBe(1);
    inst.dispose();
  });

  it("a steer past an 'input' hold releases it; steering back re-arms it", () => {
    const held = seq({
      segments: [
        { key: 'a', scene: SCENE, duration: 5000, advance: 'input' },
        { key: 'b', scene: SCENE, duration: 3000 },
        { key: 'c', scene: SCENE, duration: 4000 },
      ],
    });
    const inst = mountSync(compileSequence(held));
    inst.renderFrame!(9000, 1);
    expect(activeIndexOf(inst)).toBe(0); // held on a, waiting for the presenter

    steerTo(inst, 1); // click
    expect(activeIndexOf(inst)).toBe(1);
    inst.renderFrame!(9000 + 3000, 1); // b ran its 3000 ms → c on the timer
    expect(activeIndexOf(inst)).toBe(2);

    steerTo(inst, 0); // back to the first slide: its hold is armed again
    inst.renderFrame!(12000 + 9000, 1);
    expect(activeIndexOf(inst)).toBe(0);
    inst.dispose();
  });
});

describe("resolveSegment — advance: 'input' holds until released", () => {
  const withInput = () =>
    seq({
      segments: [
        { key: 'a', scene: SCENE, duration: 5000, advance: 'input' },
        { key: 'b', scene: SCENE, duration: 3000 },
      ],
    });

  it("advance: 'input' holds the segment past its duration", () => {
    const s = withInput();
    expect(validateSequence(s).valid).toBe(true);
    const r = resolveSegment(s, 6000);
    expect(r.index).toBe(0);
    expect(r.held).toBe(true);
    // The held scene keeps animating — its clock is not frozen at `duration`.
    expect(r.localT).toBe(6000);
  });

  it('is not held while still inside its duration', () => {
    expect(resolveSegment(withInput(), 2500)).toEqual({ index: 0, localT: 2500, startT: 0 });
  });

  it('a release below the segment lets the timer through', () => {
    const r = resolveSegment(withInput(), 6000, { releasedBelow: 1 });
    expect(r).toEqual({ index: 1, localT: 1000, startT: 5000 });
  });

  it("'auto' and 'either' advance on the timer", () => {
    for (const advance of ['auto', 'either'] as const) {
      const s = seq({
        segments: [
          { key: 'a', scene: SCENE, duration: 5000, advance },
          { key: 'b', scene: SCENE, duration: 3000 },
        ],
      });
      expect(resolveSegment(s, 6000)).toEqual({ index: 1, localT: 1000, startT: 5000 });
    }
  });

  it("an 'input' hold in a loop blocks the wrap, and a fresh lap re-arms every hold", () => {
    const s = seq({
      loop: true,
      segments: [
        { key: 'a', scene: SCENE, duration: 5000 },
        { key: 'b', scene: SCENE, duration: 3000, advance: 'input' },
      ],
    });
    // Unreleased: the lap cannot complete; b holds.
    expect(resolveSegment(s, 9000)).toMatchObject({ index: 1, held: true, localT: 4000 });
    // Released (the presenter clicked past b): the timeline wraps, and on
    // the new lap b is armed again.
    expect(resolveSegment(s, 9000, { releasedBelow: 2 })).toEqual({ index: 0, localT: 1000, startT: 0 });
    // Lap 3 (T ≥ 2×totalTimed): modulo, not one-lap subtract. 17000 % 8000 = 1000.
    expect(resolveSegment(s, 17000, { releasedBelow: 2 })).toEqual({ index: 0, localT: 1000, startT: 0 });
    // Fresh lap re-arms holds. 8500 is 500 ms into lap 2, still before b's hold.
    expect(resolveSegment(s, 8500, { releasedBelow: 0 })).toMatchObject({ index: 1, held: true, localT: 3500 });
  });

  it("advance: 'input' on the final durationless segment changes nothing — it already holds", () => {
    const withAdvance = seq({
      segments: [
        { key: 'a', scene: SCENE, duration: 5000 },
        { key: 'b', scene: SCENE, advance: 'input' },
      ],
    });
    const without = seq({
      segments: [
        { key: 'a', scene: SCENE, duration: 5000 },
        { key: 'b', scene: SCENE },
      ],
    });
    expect(resolveSegment(withAdvance, 9000)).toEqual(resolveSegment(without, 9000));
  });
});

describe('segmentStart', () => {
  it('is the prefix sum of the durations before the segment', () => {
    const s = seq();
    expect(segmentStart(s, 0)).toBe(0);
    expect(segmentStart(s, 1)).toBe(5000);
    expect(segmentStart(s, 2)).toBe(8000);
    expect(segmentStart(s, 99)).toBe(8000); // clamped to the last segment
  });
});

// ---------------------------------------------------------------------------
// Phase 0 pins — today's behaviour, asserted so the change that flips each one
// is handed a red test that names it. See idle-mono
// docs/ambient-presentation-implementation-plan.md ("Phase 0 — pin and
// report"). Every test here is green BECAUSE the current behaviour is present.
// ---------------------------------------------------------------------------

describe('Phase 0 pins — current sequence-clock, morph and track semantics', () => {
  /** A single hard circle drifting right, never wrapping — one `ctx.arc` per frame. */
  const DRIFT_SCENE: SaverSpec = {
    schemaVersion: 1,
    id: 'drift-pin',
    label: 'Drift pin',
    seed: 11,
    background: { type: 'solid', color: '#101010' },
    layers: [{
      count: 1,
      sprite: { kind: 'circle', radius: [0.02, 0.02], color: '#ffffff' },
      motion: { type: 'drift', speed: [0.05, 0.05], angle: 0 },
      wrap: false,
    }],
  };

  /**
   * Position of the circle painted for frame T. A freshly created child paints
   * a construction frame at t = 0 first (SpecInstance renders once when it
   * mounts paused), so the frame asked for is always the LAST arc call.
   */
  function arcAt(inst: SaverInstance, T: number): { x: number; y: number } {
    vi.mocked(mockCtx.arc).mockClear();
    inst.renderFrame!(T, 1);
    const calls = vi.mocked(mockCtx.arc).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [x, y] = calls[calls.length - 1] as unknown as [number, number];
    return { x, y };
  }

  const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

  it('segment boundary rewinds the child clock (pin for #58 — a bed on the global clock)', () => {
    // Today: the incoming child renders at its own localT, which restarts at 0
    // on every boundary, so an entity shared by two segments jumps back to its
    // T=0 position. #58 adds an opt-in `bed` that keeps running through the
    // boundary; the segments themselves must keep this behaviour (absent field
    // ⇒ byte-identical), so this pin stays green after #58 lands — only a
    // sibling test on the `bed` path asserts the inverse.
    const duration = 5000;
    const s = seq({
      segments: [
        { key: 'a', scene: DRIFT_SCENE, duration },
        { key: 'b', scene: DRIFT_SCENE, duration },
      ],
    });
    const inst = mountSync(compileSequence(s));

    const before = arcAt(inst, duration - 10);
    const after = arcAt(inst, duration + 10);
    const twentyMsTravel = dist(arcAt(inst, duration - 30), before);

    // The jump across the boundary dwarfs 20 ms of drift…
    expect(twentyMsTravel).toBeGreaterThan(0);
    expect(dist(before, after)).toBeGreaterThan(20 * twentyMsTravel);
    // …because the incoming segment is rendering at localT = 10 ms, exactly
    // where segment 0 was at T = 10 ms.
    const atStart = arcAt(inst, 10);
    expect(after.x).toBeCloseTo(atStart.x, 6);
    expect(after.y).toBeCloseTo(atStart.y, 6);
    inst.dispose();
  });

  it('morph steps textBlock.text at k > 0 while colours take the midpoint (pin for #45 — text cross-fade)', () => {
    // Today: lerpSpec interpolates numbers and hex colours; every other value
    // (strings, so `textBlock.text`) switches to the target on the first morph
    // frame. #45 adds an opt-in `transition.text: 'crossfade'`; the default
    // (`step`) keeps this behaviour.
    const block = (text: string, color: string): SaverSpec => ({
      schemaVersion: 1,
      id: 'text-pin',
      label: 'Text pin',
      seed: 1,
      background: { type: 'solid', color },
      layers: [{
        count: 1,
        sprite: { kind: 'textBlock', text, maxWidth: 0.6, fontSize: 0.04, color },
        motion: { type: 'static' },
        position: { x: 0.2, y: 0.2 },
      }],
    });
    const a = block('Alpha', '#000000');
    const b = block('Omega', '#ffffff');

    const mid = lerpSpec(a, b, 0.5);
    const sprite = mid.layers[0]!.sprite as { text: string; color: string };
    expect(sprite.text).toBe('Omega');
    expect(sprite.color).toBe('#808080');
    expect((mid.background as { color: string }).color).toBe('#808080');

    // k = 0 is the only frame that still shows the outgoing string.
    const start = lerpSpec(a, b, 0);
    expect((start.layers[0]!.sprite as { text: string }).text).toBe('Alpha');
    const early = lerpSpec(a, b, 0.001);
    expect((early.layers[0]!.sprite as { text: string }).text).toBe('Omega');
  });

  it('applyTrack applies all deltas as one glide regardless of delta.t (pin for #60 — timed release)', () => {
    // Today: SpecInstance.applyTrack folds every delta last-wins into ONE
    // target and glides over max(dur); `delta.t` is never read — it is the
    // steer's wall-clock stamp, not a schedule. Timed release (#60 server half,
    // an `after` field or DO-side release) must not change this: an engine
    // that scheduled by `t` would defer every existing live steer by minutes.
    const scene: SaverSpec = {
      schemaVersion: 1,
      id: 'track-pin',
      label: 'Track pin',
      seed: 3,
      background: { type: 'solid', color: '#000000' },
      layers: [{
        count: 4,
        sprite: { kind: 'circle', radius: [0.02, 0.02], color: '#000000' },
        motion: { type: 'static' },
      }],
    };
    const plugin = compileSaver(scene);
    const mounted = plugin.mount(saverCtx());
    if (mounted instanceof Promise) throw new Error('Expected synchronous mount');
    const inst = mounted;

    inst.applyTrack!({
      program: 'pin',
      seed: 3,
      deltas: [
        { t: 0, path: 'background.color', value: '#ffffff', ease: 'smooth', dur: 1000 },
        { t: 60_000, path: 'layers.0.sprite.color', value: '#ffffff', ease: 'smooth', dur: 200 },
      ],
    });

    type Glide = { from: SaverSpec; to: SaverSpec; startT: number; dur: number } | null;
    const state = inst as unknown as { transition: Glide; effSpec: SaverSpec };
    expect(state.transition).not.toBeNull();
    const glide = state.transition!;
    // One transition, whose target carries BOTH deltas — the t: 60 000 one is
    // not held back.
    expect((glide.to.background as { color: string }).color).toBe('#ffffff');
    expect((glide.to.layers[0]!.sprite as { color: string }).color).toBe('#ffffff');
    expect(glide.dur).toBe(1000); // max(dur), not per-delta
    expect(glide.startT).toBe(0); // the clock now, not delta.t

    // Half-way through the single glide both values are mid-flight together.
    inst.renderFrame!(500, 3);
    const bg = (state.effSpec.background as { color: string }).color;
    const fg = (state.effSpec.layers[0]!.sprite as { color: string }).color;
    expect(bg).toBe('#808080');
    expect(fg).toBe('#808080');
    inst.dispose();
  });
});

// ---------------------------------------------------------------------------
// sync: 'epoch' — the sequence clock seeded from the host (1b)
// ---------------------------------------------------------------------------

describe("sync: 'epoch' seeds the sequence clock from sequenceBaseT (1b)", () => {
  const BG = ['#111111', '#222222', '#333333'];

  /** A solid background per segment plus a self-typing block: 10 graphemes at 5/s, so the painted prefix reads out localT. */
  function typingScene(i: number): SaverSpec {
    return {
      schemaVersion: 1,
      id: `typing-${i}`,
      label: `Typing ${i}`,
      background: { type: 'solid', color: BG[i]! },
      layers: [{
        key: 'h',
        count: 1,
        sprite: { kind: 'textBlock', text: 'ABCDEFGHIJ', maxWidth: 0.9, fontSize: 0.05, color: '#e6e8ef', reveal: { speed: 5 } },
        motion: { type: 'static' },
        position: { x: 0.1, y: 0.1 },
      }],
    } as SaverSpec;
  }

  function epochSeq(overrides: Partial<IdleSequence> = {}, seg0: Partial<IdleSequence['segments'][number]> = {}): IdleSequence {
    return {
      format: 'idle-sequence',
      schemaVersion: 1,
      id: 'epoch-test',
      label: 'Epoch Test',
      seed: 1,
      loop: false,
      segments: [
        { key: 'a', scene: typingScene(0), duration: 4000, ...seg0 },
        { key: 'b', scene: typingScene(1), duration: 4000 },
        { key: 'c', scene: typingScene(2), duration: 4000 },
      ],
      ...overrides,
    };
  }

  /** The host's mount context carrying the shared clock — typed as a host would type it. */
  function epochCtx(sequenceBaseT: number, overrides: Partial<SaverContext> = {}): SequenceMountContext {
    return { ...saverCtx(overrides), sequenceBaseT };
  }

  /** Swap in a context that records every fillStyle (backgrounds) and fillText (typed prefix). */
  function recordingCtx() {
    const fills: string[] = [];
    const texts: string[] = [];
    const ctx = stub2dContext();
    let _fs = '';
    Object.defineProperty(ctx, 'fillStyle', {
      get: () => _fs,
      set: (v: string) => { _fs = v; if (typeof v === 'string') fills.push(v); },
    });
    (ctx as { fillText: unknown }).fillText = vi.fn((t: string) => texts.push(t));
    HTMLCanvasElement.prototype.getContext = (() => ctx) as any;
    return { fills, texts, reset: () => { fills.length = 0; texts.length = 0; } };
  }

  it('renders segment 1 at localT 1000 for baseT 5000 on a 3×4000 ms sequence', () => {
    const rec = recordingCtx();
    const inst = mountSync(compileSequence(epochSeq({ sync: 'epoch' })), epochCtx(5000, { reducedMotion: true }));
    expect(rec.fills).toContain(BG[1]);
    expect(rec.fills).not.toContain(BG[0]);
    // 5 graphemes/s × 1 s = 'ABCDE' — the clock is 1000 ms into segment 1.
    expect(rec.texts).toEqual(['ABCDE']);
    inst.dispose();
  });

  it('the rAF loop starts at baseT, not 0', () => {
    const rec = recordingCtx();
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => { const id = nextId++; pending.set(id, cb); return id; });
    const caf = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => { pending.delete(Number(id)); });
    const inst = mountSync(compileSequence(epochSeq({ sync: 'epoch' })), epochCtx(5000));
    const tick = (now: number) => { for (const [id, cb] of [...pending.entries()]) { pending.delete(id); cb(now); } };
    tick(16); // first frame: lastT = 16 − 16 + 5000
    expect(rec.fills).toContain(BG[1]);
    expect(rec.texts).toEqual(['ABCDE']);
    rec.reset();
    tick(3016); // lastT 8000 → segment 2, localT 0 → nothing typed yet
    expect(rec.fills).toContain(BG[2]);
    expect(rec.texts).toEqual([]);
    inst.dispose();
    raf.mockRestore();
    caf.mockRestore();
  });

  it("absent sync (and explicit 'mount') ignores sequenceBaseT — T starts at 0 as today", () => {
    for (const sync of [undefined, 'mount'] as const) {
      const rec = recordingCtx();
      const inst = mountSync(compileSequence(epochSeq(sync ? { sync } : {})), epochCtx(5000, { reducedMotion: true }));
      expect(rec.fills).toContain(BG[0]);
      expect(rec.fills).not.toContain(BG[1]);
      expect(rec.texts).toEqual([]); // localT 0 — nothing typed
      inst.dispose();
    }
  });

  it("'epoch' without a sequenceBaseT starts at 0 (a host that does not pass it loses nothing)", () => {
    const rec = recordingCtx();
    const inst = mountSync(compileSequence(epochSeq({ sync: 'epoch' })), saverCtx({ reducedMotion: true }));
    expect(rec.fills).toContain(BG[0]);
    expect(rec.texts).toEqual([]);
    inst.dispose();
  });

  it("a late joiner past an unreleased advance: 'input' hold lands ON the held segment", () => {
    const rec = recordingCtx();
    // Segment 0 holds for the presenter; the room's clock is already 5000 ms
    // in. The hold is armed for this viewer too (releasedBelow 0), so it must
    // show segment 0 — still animating at localT 5000 — not segment 1.
    const inst = mountSync(compileSequence(epochSeq({ sync: 'epoch' }, { advance: 'input' })), epochCtx(5000, { reducedMotion: true }));
    expect(rec.fills).toContain(BG[0]);
    expect(rec.fills).not.toContain(BG[1]);
    expect(rec.texts).toEqual(['ABCDEFGHIJ']); // localT 5000 → fully typed
    // The clicker releases it from the seeded clock: segment 1 begins at its own localT 0.
    rec.reset();
    inst.applyTrack!({ deltas: [{ t: 0, path: 'sequence.segment', value: 1 }] } as never);
    expect(rec.fills).toContain(BG[1]);
    expect(rec.texts).toEqual([]);
    inst.dispose();
  });

  it('a sequence.segment steer after an epoch mount lands at the target segment start', () => {
    const rec = recordingCtx();
    const inst = mountSync(compileSequence(epochSeq({ sync: 'epoch' })), epochCtx(5000, { reducedMotion: true }));
    rec.reset();
    inst.applyTrack!({ deltas: [{ t: 0, path: 'sequence.segment', value: 2 }] } as never);
    expect(rec.fills).toContain(BG[2]);
    expect(rec.texts).toEqual([]); // localT 0
    inst.dispose();
  });
});
