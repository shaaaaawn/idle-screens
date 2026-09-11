// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createRng, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { resolveSegment, segmentStart, sequenceSwapCompatible } from './sequence';
import { validateSequence } from './validate';
import { adviseSequence } from './advise';
import { compileSaver, compileSequence, hasHotSwapSequence, type SequenceMountContext } from './compile';
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
    drawImage: vi.fn(),
    clearRect: vi.fn(),
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

  // Flipped deliberately in plan 1c: this used to assert "rejects fade
  // transition (not yet supported)".
  it('accepts fade transition (1c) and bounds its dur like morph', () => {
    const withDur = (dur: unknown) => validateSequence(seq({
      segments: [{ key: 'a', scene: SCENE, duration: 5000, transition: { type: 'fade', dur } as never }],
    }));
    expect(withDur(600).valid).toBe(true);
    expect(withDur(200).valid).toBe(true);
    expect(withDur(5000).valid).toBe(true);
    for (const bad of [100, 6000, undefined, 'slow']) {
      const r = withDur(bad);
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.path === 'segments[0].transition.dur')).toBe(true);
    }
    const unknown = validateSequence(seq({
      segments: [{ key: 'a', scene: SCENE, duration: 5000, transition: { type: 'dissolve' } as never }],
    }));
    expect(unknown.valid).toBe(false);
    expect(unknown.errors.some((e) => e.path === 'segments[0].transition.type')).toBe(true);
  });

  describe('bed (1d)', () => {
    const BED_OK: SaverSpec = {
      schemaVersion: 1, id: 'bed', label: 'Bed',
      background: { type: 'solid', color: '#0a0a1a' },
      layers: [{ count: 10, sprite: { kind: 'circle', radius: [0.01, 0.02], color: '#ffffff' }, motion: { type: 'drift', speed: [0.05, 0.1], angle: 0 } }],
    };
    it('accepts a valid bed and validates it with validateSpec (errors prefixed bed.)', () => {
      expect(validateSequence(seq({ bed: BED_OK })).valid).toBe(true);
      const bad = validateSequence(seq({ bed: { ...BED_OK, layers: [] } }));
      expect(bad.valid).toBe(false);
      expect(bad.errors.some((e) => e.path === 'bed.layers')).toBe(true);
      const notObj = validateSequence(seq({ bed: 'ground' as never }));
      expect(notObj.valid).toBe(false);
      expect(notObj.errors.some((e) => e.path === 'bed')).toBe(true);
    });

    it('counts bed entities together with the largest segment for the perf cap', () => {
      // Two layers each, under the 400-per-layer cap; only the bed + largest-segment sum is over.
      const big = (count: number): SaverSpec => ({ ...SCENE, layers: [{ ...SCENE.layers[0]!, count }, { ...SCENE.layers[0]!, count: 100 }] });
      const bed = { ...BED_OK, layers: [{ ...BED_OK.layers[0]!, count: 400 }] };
      const ok = validateSequence(seq({ bed, segments: [{ key: 'a', scene: big(300), duration: 5000 }, { key: 'b', scene: big(50), duration: 5000 }] }));
      expect(ok.errors).toEqual([]);
      const over = validateSequence(seq({ bed, segments: [{ key: 'a', scene: big(301), duration: 5000 }, { key: 'b', scene: big(50), duration: 5000 }] }));
      expect(over.valid).toBe(false);
      expect(over.errors.some((e) => e.path === 'bed' && /400 \+ largest segment 401 = 801 exceeds cap 800/.test(e.message))).toBe(true);
      // Each alone is legal — only the pair is over.
      expect(validateSequence(seq({ segments: [{ key: 'a', scene: big(301), duration: 5000 }] })).errors).toEqual([]);
    });

    it('warns bed-hides-segment-background for every segment that declares a background', () => {
      const r = validateSequence(seq({
        bed: BED_OK,
        segments: [
          { key: 'a', scene: { ...SCENE, background: { type: 'solid', color: '#123456' } }, duration: 5000 },
          { key: 'b', scene: SCENE, duration: 5000 },
          { key: 'c', scene: { ...SCENE, background: { type: 'gradient', stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#111111' }] } }, duration: 5000 },
        ],
      }));
      expect(r.valid).toBe(true);
      const w = (r.warnings ?? []).filter((x) => x.code === 'bed-hides-segment-background');
      expect(w.map((x) => x.path)).toEqual(['segments[0].scene.background', 'segments[2].scene.background']);
      // No bed ⇒ no warning, whatever the segments declare.
      const none = validateSequence(seq({ segments: [{ key: 'a', scene: { ...SCENE, background: { type: 'solid', color: '#123456' } }, duration: 5000 }] }));
      expect((none.warnings ?? []).filter((x) => x.code === 'bed-hides-segment-background')).toHaveLength(0);
    });
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

  it('is silent when segments differ only in id/label (never rendered)', () => {
    const r = validateSequence(morphSeq({
      segments: [
        { key: 'a', scene: { ...caption('Act I', '#e6e8ef'), id: 'slide-a', label: 'Slide A' }, duration: 5000, transition: { type: 'morph', dur: 1000 } },
        { key: 'b', scene: { ...caption('Act I', '#e6e8ef'), id: 'slide-b', label: 'Slide B' }, duration: 5000 },
      ],
    }));
    expect((r.warnings ?? []).filter((x) => x.code === 'morph-nothing-morphable')).toHaveLength(0);
  });

  it('is silent when a layer differs only in its addressable key (never rendered)', () => {
    const a = caption('Act I', '#e6e8ef');
    a.layers[0]!.key = 'caption-a';
    const b = caption('Act I', '#e6e8ef');
    b.layers[0]!.key = 'caption-b';
    const r = validateSequence(morphSeq({
      segments: [
        { key: 'a', scene: a, duration: 5000, transition: { type: 'morph', dur: 1000 } },
        { key: 'b', scene: b, duration: 5000 },
      ],
    }));
    expect((r.warnings ?? []).filter((x) => x.code === 'morph-nothing-morphable')).toHaveLength(0);
  });

  it('still fires when a source-only field disappears (a real step, not silently dropped)', () => {
    const withLife = caption('Act I', '#e6e8ef');
    withLife.layers[0]!.life = { enter: 500, fade: 300 };
    const r = validateSequence(morphSeq({
      segments: [
        { key: 'a', scene: withLife, duration: 5000, transition: { type: 'morph', dur: 1000 } },
        { key: 'b', scene: caption('Act I', '#e6e8ef'), duration: 5000 },
      ],
    }));
    // layers[0].life only exists on the outgoing side: still a genuine
    // (non-interpolable) difference, so this must not read as identical twins.
    expect((r.warnings ?? []).filter((x) => x.code === 'morph-nothing-morphable')).toHaveLength(1);
  });

  it('is silent for hex colours that only differ in spelling (case, 3- vs 6-digit)', () => {
    const r = validateSequence(morphSeq({
      segments: [
        { key: 'a', scene: caption('Act I', '#000'), duration: 5000, transition: { type: 'morph', dur: 1000 } },
        { key: 'b', scene: caption('Act I', '#000000'), duration: 5000 },
      ],
    }));
    // Same colour under a different spelling is a no-op, not a difference — the
    // documented contract is that identical (rendered) specs return false.
    expect((r.warnings ?? []).filter((x) => x.code === 'morph-nothing-morphable')).toHaveLength(0);
  });

  it('is silent for a one-step colour glide (rounding must not mask real interpolation)', () => {
    // #000000 -> #010101 differ by 1 per channel: lerpSpec's rounded midpoint
    // lands exactly on the target colour, but the colour still glides.
    const r = validateSequence(morphSeq({
      segments: [
        { key: 'a', scene: caption('Act I', '#000000'), duration: 5000, transition: { type: 'morph', dur: 1000 } },
        { key: 'b', scene: caption('Act I', '#010101'), duration: 5000 },
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
    inst.renderFrame!(5500, 1); // mid-morph (localT 500 < dur 1000): enters the morph state
    inst.renderFrame!(7000, 1); // past the morph window: triggers finalization
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

  it('a structural steer that arrives mid-morph rebuilds the live child instead of leaving stale entities', () => {
    // Regression: the morph branch replaces the whole lerped spec every frame
    // via a paint-only hot-swap that skips SpecInstance.rebuild(). canMorph
    // only guarantees specA/specB share structure BEFORE the retained set is
    // applied — a structural delta (`layers.0.count` here) can validate and
    // change effSpec, but the child's actual built entities (baked at the
    // last rebuild) stay behind unless the swap re-checks structuralSignature.
    const inst = mountSync(compileSequence(morphSeq()));
    inst.renderFrame!(5500, 1); // already mid-morph, chain-root child built at count 3
    const child = (inst as unknown as {
      children: Array<{ effSpec: SaverSpec; layers: Array<{ entities: unknown[] }> } | null>;
    }).children[0]!;
    // Entity count is scaled by viewport (400×640 here, well under the 1080
    // reference), so the built count isn't the raw spec count — 3 scales to
    // 1 entity, 5 scales to 2. What matters is that it MOVES when the fix
    // rebuilds; a stale hot-swap leaves it at 1 regardless of effSpec.count.
    const before = child.layers[0]!.entities.length;
    steer(inst, 'layers.0.count', 5); // reachable only via the morph's own hot-swap, not the plain active-child path
    expect(child.effSpec.layers[0]!.count).toBe(5);
    expect(child.layers[0]!.entities.length).not.toBe(before);
    expect(child.layers[0]!.entities.length).toBe(2);
    inst.dispose();
  });

  it('a freshly created child with retained deltas paints a full warm-up frame, not a ghosted blend of the pre-steer scene', () => {
    // Regression: SpecInstance's own mount does one stray paint at t=0 (it
    // starts paused, like every sequence child) using the PRE-steer spec —
    // applyDeltasNow updates effSpec afterward but (before this fix) left
    // lastRenderT at that stray 0. With `ghosting` on, the child's first
    // real frame then read as "contiguous" with that stray paint and
    // composited over it at partial alpha instead of clearing, briefly
    // showing a ghost of the un-steered scene.
    //
    // The sprite is `circle` (draws via arc/fill, never fillRect) so every
    // fillRect call in this test is unambiguously the background paint —
    // one per paintFrame, in order.
    const GHOST_SCENE: SaverSpec = {
      schemaVersion: 1,
      id: 'ghost',
      label: 'Ghost',
      ghosting: 0.9,
      background: { type: 'solid', color: '#000000' },
      layers: [{ count: 1, sprite: { kind: 'circle', radius: [0.02, 0.02], color: '#ffffff' }, motion: { type: 'static' } }],
    };
    const s = seq({
      segments: [
        { key: 'a', scene: SCENE, duration: 5000 }, // no `background` field — the delta is a no-op here, only retained
        { key: 'b', scene: GHOST_SCENE, duration: 4000 },
      ],
    });
    const inst = mountSync(compileSequence(s));
    inst.renderFrame!(1000, 1); // segment 0
    steer(inst, 'background.color', '#ff0000');
    const bgAlphas: number[] = [];
    (mockCtx as unknown as { fillRect: (...args: number[]) => void }).fillRect = vi.fn(() => {
      bgAlphas.push((mockCtx as unknown as { globalAlpha: number }).globalAlpha);
    });
    inst.renderFrame!(5100, 1); // segment 1 created fresh, localT=100ms — well inside the 250ms contiguity window
    // bgAlphas[0] is the child's own construction-time stray paint (t=0, the
    // pre-steer spec, always a full clear). bgAlphas[1] is the first paint of
    // the real localT=100 frame: it must also be a full-alpha clear (the
    // warm-up's first step), not a `1 - g^k` blend over that stale paint.
    expect(bgAlphas[0]).toBe(1);
    expect(bgAlphas[1]).toBe(1);
    inst.dispose();
  });
});

interface Rec { fills: string[]; drawAlphas: number[]; clears: number; ctx: CanvasRenderingContext2D }
/**
 * One recording context per canvas element, so the shared surface (the one
 * canvas in the host) and a fade's offscreen canvases can be told apart.
 */
function perCanvasContexts(): Map<HTMLCanvasElement, Rec> {
  const recs = new Map<HTMLCanvasElement, Rec>();
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    let rec = recs.get(this);
    if (!rec) {
      const c = stub2dContext();
      const r: Rec = { fills: [], drawAlphas: [], clears: 0, ctx: c };
      let _fs = '';
      Object.defineProperty(c, 'fillStyle', {
        get: () => _fs,
        set: (v: string) => { _fs = v; if (typeof v === 'string') r.fills.push(v); },
      });
      (c as { drawImage: unknown }).drawImage = vi.fn(function (this: { globalAlpha: number }) { r.drawAlphas.push(this.globalAlpha); });
      (c as { clearRect: unknown }).clearRect = vi.fn(() => { r.clears++; });
      recs.set(this, r);
      rec = r;
    }
    return rec.ctx;
  } as never;
  return recs;
}
const fadingOf = (inst: SaverInstance) => (inst as unknown as { fading: { index: number; child: SaverInstance } | null }).fading;
const fadingInOf = (inst: SaverInstance) => (inst as unknown as { fadingIn: { index: number; child: SaverInstance } | null }).fadingIn;
const mainOf = (recs: Map<HTMLCanvasElement, Rec>, host: HTMLElement): Rec => recs.get(host.querySelector('canvas')!)!;
const offscreenOf = (recs: Map<HTMLCanvasElement, Rec>, host: HTMLElement): Rec[] =>
  [...recs.entries()].filter(([c]) => !host.contains(c)).map(([, r]) => r);

// ---------------------------------------------------------------------------
// Fade — the general cross-fade between unlike segments (plan 1c, #45).
// ---------------------------------------------------------------------------

describe('SequenceInstance — fade transition', () => {
  const fadeSeq = (overrides: Partial<IdleSequence> = {}): IdleSequence => morphSeq({
    segments: [
      { key: 'a', scene: SCENE_A, duration: 5000, transition: { type: 'fade', dur: 1000 } },
      { key: 'b', scene: SCENE_STRUCTURAL_DIFF, duration: 5000 },
    ],
    ...overrides,
  });

  const DEFAULT_BG = '#05050a'; // SCENE_STRUCTURAL_DIFF declares no background

  it('renders both segments during the window and composites the outgoing at a decreasing alpha', () => {
    const recs = perCanvasContexts();
    const host = document.createElement('div');
    const inst = mountSync(compileSequence(fadeSeq()), saverCtx({ host }));
    inst.renderFrame!(4000, 1);
    expect(mainOf(recs, host).fills).toContain('#112233');
    expect(fadingOf(inst)).toBeNull();

    inst.renderFrame!(5300, 1); // 300 ms into a 1000 ms fade
    const main = mainOf(recs, host);
    expect(main.fills).toContain(DEFAULT_BG); // incoming on the shared surface
    const off = offscreenOf(recs, host);
    expect(off).toHaveLength(1);
    expect(off[0]!.fills).toContain('#112233'); // outgoing on its own canvas
    expect(host.querySelectorAll('canvas')).toHaveLength(1); // the offscreen canvas is not in the DOM
    expect(main.drawAlphas).toHaveLength(1);
    expect(main.drawAlphas[0]).toBeCloseTo(1 - lerpK(0.3), 5);
    expect(fadingOf(inst)?.index).toBe(0);

    inst.renderFrame!(5800, 1);
    expect(main.drawAlphas).toHaveLength(2);
    expect(main.drawAlphas[1]).toBeCloseTo(1 - lerpK(0.8), 5);
    expect(main.drawAlphas[1]!).toBeLessThan(main.drawAlphas[0]!);

    inst.renderFrame!(6100, 1); // fade over
    expect(fadingOf(inst)).toBeNull();
    expect(main.drawAlphas).toHaveLength(2);
    expect(off[0]!.fills.filter((f) => f === '#112233').length).toBeGreaterThan(0);
    inst.dispose();
  });
  /** easeSmooth, restated so the test does not import the thing it checks. */
  function lerpK(k: number): number { return k * k * (3 - 2 * k); }

  it('the outgoing segment keeps animating at its duration + localT (it does not freeze)', () => {
    perCanvasContexts();
    const inst = mountSync(compileSequence(fadeSeq()));
    inst.renderFrame!(5300, 1);
    const out = fadingOf(inst)!.child;
    const spy = vi.spyOn(out, 'renderFrame');
    inst.renderFrame!(5400, 1);
    expect(spy).toHaveBeenCalledWith(5400, 42); // 5000 (its duration) + 400, the sequence seed
    inst.dispose();
  });

  it('the outgoing child is released when the fade completes and on dispose', () => {
    perCanvasContexts();
    const inst = mountSync(compileSequence(fadeSeq()));
    inst.renderFrame!(5300, 1);
    const out = fadingOf(inst)!.child;
    const disposed = vi.spyOn(out, 'dispose');
    inst.renderFrame!(6000, 1);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(fadingOf(inst)).toBeNull();
    inst.renderFrame!(5300, 1); // seek back into the window: a fresh outgoing child
    const again = vi.spyOn(fadingOf(inst)!.child, 'dispose');
    inst.dispose();
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('the clicker fades too: a sequence.segment steer lands at localT 0 of a fade boundary', () => {
    const recs = perCanvasContexts();
    const host = document.createElement('div');
    const inst = mountSync(compileSequence(fadeSeq()), saverCtx({ host }));
    inst.renderFrame!(1000, 1);
    steerTo(inst, 1);
    expect(fadingOf(inst)?.index).toBe(0);
    expect(mainOf(recs, host).drawAlphas[0]).toBeCloseTo(1, 5); // k = 0 → the outgoing fully covers
    inst.dispose();
  });

  it("under loop: true the last segment's fade is the wrap's transition into segment 0", () => {
    perCanvasContexts();
    const inst = mountSync(compileSequence(fadeSeq({
      loop: true,
      segments: [
        { key: 'a', scene: SCENE_A, duration: 5000 },
        { key: 'b', scene: SCENE_STRUCTURAL_DIFF, duration: 5000, transition: { type: 'fade', dur: 1000 } },
      ],
    })));
    inst.renderFrame!(9000, 1);
    expect(fadingOf(inst)).toBeNull();
    inst.renderFrame!(10300, 1); // lap 2, segment 0, localT 300
    expect(activeIndexOf(inst)).toBe(0);
    expect(fadingOf(inst)?.index).toBe(1);
    inst.renderFrame!(11500, 1);
    expect(fadingOf(inst)).toBeNull();
    inst.dispose();
  });

  it('the retained track reaches the outgoing child', () => {
    const recs = perCanvasContexts();
    const host = document.createElement('div');
    const inst = mountSync(compileSequence(fadeSeq()), saverCtx({ host }));
    inst.renderFrame!(4000, 1);
    inst.applyTrack!({ program: 'test', seed: 1, deltas: [{ t: 0, path: 'background.color', value: '#00ff00', ease: 'step', dur: 0 }] });
    inst.renderFrame!(5300, 1);
    expect(offscreenOf(recs, host)[0]!.fills).toContain('#00ff00');
    inst.dispose();
  });

  it('a live steer mid-fade also reaches the already-fading outgoing child', () => {
    const recs = perCanvasContexts();
    const host = document.createElement('div');
    const inst = mountSync(compileSequence(fadeSeq()), saverCtx({ host }));
    inst.renderFrame!(5300, 1); // 300 ms into the fade — the outgoing child already exists
    expect(fadingOf(inst)).not.toBeNull();
    inst.applyTrack!({ program: 'test', seed: 1, deltas: [{ t: 0, path: 'background.color', value: '#00ff00', ease: 'step', dur: 0 }] });
    expect(offscreenOf(recs, host)[0]!.fills).toContain('#00ff00');
    inst.dispose();
  });

  it("the clicker's steer to segment 0 under loop plays the last segment's wrap fade, not a cut", () => {
    const recs = perCanvasContexts();
    const host = document.createElement('div');
    const inst = mountSync(compileSequence(fadeSeq({
      loop: true,
      segments: [
        { key: 'a', scene: SCENE_A, duration: 5000 },
        { key: 'b', scene: SCENE_STRUCTURAL_DIFF, duration: 5000, transition: { type: 'fade', dur: 1000 } },
      ],
    })), saverCtx({ host }));
    inst.renderFrame!(9000, 1); // segment b, well past any fade window
    steerTo(inst, 0);
    expect(activeIndexOf(inst)).toBe(0);
    expect(fadingOf(inst)?.index).toBe(1); // segment b fading out, per the wrap rule
    expect(mainOf(recs, host).drawAlphas.at(-1)).toBeCloseTo(1, 5); // k = 0 → fully covers
    inst.dispose();
  });

  it("tier gate: 'basic' and 'minimal' play a fade as a cut; 'standard'/'high'/absent fade", () => {
    for (const tier of ['basic', 'minimal'] as const) {
      const recs = perCanvasContexts();
      const host = document.createElement('div');
      const ctx: SequenceMountContext = { ...saverCtx({ host }), capabilityTier: tier };
      const inst = mountSync(compileSequence(fadeSeq()), ctx);
      inst.renderFrame!(4000, 1);
      inst.renderFrame!(5300, 1);
      expect(fadingOf(inst)).toBeNull();
      expect(mainOf(recs, host).drawAlphas).toEqual([]);
      expect(offscreenOf(recs, host)).toEqual([]);
      expect(mainOf(recs, host).fills).toContain(DEFAULT_BG);
      inst.dispose();
    }
    for (const tier of ['standard', 'high', undefined] as const) {
      perCanvasContexts();
      const ctx: SequenceMountContext = { ...saverCtx(), ...(tier ? { capabilityTier: tier } : {}) };
      const inst = mountSync(compileSequence(fadeSeq()), ctx);
      inst.renderFrame!(5300, 1);
      expect(fadingOf(inst)?.index).toBe(0);
      inst.dispose();
    }
  });

  it('cut and morph boundaries never create an outgoing child or composite (their paths are untouched)', () => {
    for (const s of [seq(), morphSeq()]) {
      const recs = perCanvasContexts();
      const host = document.createElement('div');
      const inst = mountSync(compileSequence(s), saverCtx({ host }));
      for (const T of [4000, 5000, 5300, 5800, 6100, 9000]) inst.renderFrame!(T, 1);
      expect(fadingOf(inst)).toBeNull();
      expect(offscreenOf(recs, host)).toEqual([]);
      expect(mainOf(recs, host).drawAlphas).toEqual([]);
      inst.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Bed — a sequence-level scene on the global clock (plan 1d, #58).
// ---------------------------------------------------------------------------

describe('SequenceInstance — bed', () => {
  /** One drifting circle: the only `arc` caller in these sequences (segments draw emoji via fillText). */
  const BED: SaverSpec = {
    schemaVersion: 1, id: 'bed', label: 'Bed',
    background: { type: 'solid', color: '#0a0a1a' },
    layers: [{ key: 'orb', count: 1, sprite: { kind: 'circle', radius: [0.02, 0.02], color: '#ffffff' }, motion: { type: 'drift', speed: [0.1, 0.1], angle: 0 } }],
  };
  const SEG_BG = '#123456';
  const bedSeq = (overrides: Partial<IdleSequence> = {}): IdleSequence => seq({
    bed: BED,
    segments: [
      { key: 'a', scene: { ...SCENE, background: { type: 'solid', color: SEG_BG } }, duration: 5000 },
      { key: 'b', scene: SCENE, duration: 3000 },
      { key: 'c', scene: SCENE, duration: 4000 },
    ],
    ...overrides,
  });
  const bedOf = (inst: SaverInstance) => (inst as unknown as { bed: { effSpec: SaverSpec } | null }).bed;
  const childSpec = (inst: SaverInstance, index: number): SaverSpec | undefined =>
    (inst as unknown as { children: Array<{ effSpec: SaverSpec } | null> }).children[index]?.effSpec;
  const steer = (inst: SaverInstance, path: string, value: unknown): void =>
    inst.applyTrack!({ program: 'test', seed: 1, deltas: [{ t: 0, path, value, ease: 'step', dur: 0 }] } as never);
  /** x of the bed orb in the frame rendered at T (the last arc call). */
  const orbX = (inst: SaverInstance, T: number): number => {
    vi.mocked(mockCtx.arc).mockClear();
    inst.renderFrame!(T, 1);
    const calls = vi.mocked(mockCtx.arc).mock.calls;
    expect(calls.length).toBe(1);
    return calls[0]![0] as number;
  };

  it('absent bed ⇒ no bed instance; segment backgrounds paint as today', () => {
    const rec = (() => { const fills: string[] = []; let _fs = ''; Object.defineProperty(mockCtx, 'fillStyle', { get: () => _fs, set: (v: string) => { _fs = v; if (typeof v === 'string') fills.push(v); } }); return fills; })();
    const inst = mountSync(compileSequence({ ...bedSeq(), bed: undefined }));
    expect(bedOf(inst)).toBeNull();
    inst.renderFrame!(1000, 1);
    expect(rec).toContain(SEG_BG);
    expect(vi.mocked(mockCtx.arc)).not.toHaveBeenCalled();
    inst.dispose();
  });

  it("paints the bed's ground first and never the segment's background", () => {
    const fills: string[] = [];
    let _fs = '';
    Object.defineProperty(mockCtx, 'fillStyle', { get: () => _fs, set: (v: string) => { _fs = v; if (typeof v === 'string') fills.push(v); } });
    const inst = mountSync(compileSequence(bedSeq()));
    expect(bedOf(inst)).not.toBeNull();
    inst.renderFrame!(1000, 1);
    expect(fills[0]).toBe('#0a0a1a'); // the bed's ground, before any ink
    expect(fills).not.toContain(SEG_BG);
    inst.dispose();
  });

  it('a bed drift entity is continuous across a segment boundary (the inverse of the Phase 0 rewind pin)', () => {
    const inst = mountSync(compileSequence(bedSeq()));
    const x0 = orbX(inst, 10); // what a rewound instance would show 10 ms into a segment
    const before = orbX(inst, 4990);
    const after = orbX(inst, 5010);
    expect(activeIndexOf(inst)).toBe(1);
    // 0.1 viewport/s on a 400 px short side = 40 px/s → 0.8 px over 20 ms.
    expect(Math.abs(after - before)).toBeLessThan(2);
    expect(Math.abs(after - x0)).toBeGreaterThan(50);
    inst.dispose();
  });

  it('… and across a sequence.segment steer: the clicker rewinds the segment, not the bed', () => {
    const inst = mountSync(compileSequence(bedSeq()));
    const before = orbX(inst, 4990);
    vi.mocked(mockCtx.arc).mockClear();
    steerTo(inst, 2); // re-renders at renderedT 4990 with the clock displaced for the segments
    expect(activeIndexOf(inst)).toBe(2);
    expect(vi.mocked(mockCtx.arc).mock.calls[0]![0]).toBe(before);
    const after = orbX(inst, 5010);
    expect(activeIndexOf(inst)).toBe(2);
    expect(Math.abs(after - before)).toBeLessThan(2);
    inst.dispose();
  });

  it('bed.<path> steers reach the bed (prefix stripped), by index and by key, and are not retained for segments', () => {
    const inst = mountSync(compileSequence(bedSeq()));
    inst.renderFrame!(1000, 1);
    steer(inst, 'bed.layers.0.sprite.color', '#ff0000');
    expect((bedOf(inst)!.effSpec.layers[0]!.sprite as { color: string }).color).toBe('#ff0000');
    steer(inst, 'bed.orb.sprite.color', '#00ff00');
    expect((bedOf(inst)!.effSpec.layers[0]!.sprite as { color: string }).color).toBe('#00ff00');
    expect(childSpec(inst, 0)!.layers).toEqual(SCENE.layers);
    const retained = (inst as unknown as { retainedDeltas: Map<string, unknown> }).retainedDeltas;
    expect([...retained.keys()]).toEqual([]);
    inst.dispose();
  });

  it('without a bed, bed.* paths still reach the segments (a layer keyed `bed` keeps working)', () => {
    const scene: SaverSpec = { ...SCENE, layers: [{ ...SCENE.layers[0]!, key: 'bed', sprite: { kind: 'emoji', glyphs: ['🔵'] } }] };
    const inst = mountSync(compileSequence(seq({ segments: [{ key: 'a', scene, duration: 5000 }] })));
    inst.renderFrame!(1000, 1);
    steer(inst, 'bed.sprite.glyphs', ['🟢']);
    expect((childSpec(inst, 0)!.layers[0]!.sprite as { glyphs: string[] }).glyphs).toEqual(['🟢']);
    inst.dispose();
  });

  it('a segment\'s ghosting is ignored over a bed (one paint per frame, no warm-up replay)', () => {
    const ghosted: SaverSpec = { ...SCENE, ghosting: 0.9 };
    // A fresh child paints once at construction (t = 0) and once for the frame.
    const withBed = mountSync(compileSequence(bedSeq({ segments: [{ key: 'a', scene: ghosted, duration: 5000 }] })));
    vi.mocked(mockCtx.fillText).mockClear();
    withBed.renderFrame!(3000, 1); // a non-contiguous seek: ghosting would replay up to 53 frames
    expect(vi.mocked(mockCtx.fillText)).toHaveBeenCalledTimes(2);
    withBed.dispose();
    const alone = mountSync(compileSequence(seq({ segments: [{ key: 'a', scene: ghosted, duration: 5000 }] })));
    vi.mocked(mockCtx.fillText).mockClear();
    alone.renderFrame!(3000, 1);
    expect(vi.mocked(mockCtx.fillText).mock.calls.length).toBeGreaterThan(10);
    alone.dispose();
  });

  it("a crossfade morph's chain-root child, freshly mounted mid-morph over a bed, does not double-paint the outgoing words (1f)", () => {
    const withText = (text: string): SaverSpec => ({
      ...SCENE,
      layers: [{ count: 1, sprite: { kind: 'textBlock', text, maxWidth: 0.6, fontSize: 0.05 }, motion: { type: 'static' } }],
    });
    const outgoing = withText('Alpha');
    const incoming = withText('Omega');
    const inst = mountSync(compileSequence(bedSeq({
      segments: [
        { key: 'a', scene: outgoing, duration: 5000, transition: { type: 'morph', dur: 1000, text: 'crossfade' } },
        { key: 'b', scene: incoming, duration: 3000 },
        { key: 'c', scene: incoming, duration: 4000 },
      ],
    })));
    // Land deep in segment 2 first so the morph's chain-root slot (segment 0)
    // is empty — every child but the active one is released on a segment switch.
    inst.renderFrame!(8500, 1);
    vi.mocked(mockCtx.fillText).mockClear();
    // Seek straight into the crossfade window: the chain-root child is
    // constructed for the first time with the morph (and its paint
    // overrides) already active — the regression cubic flagged on #159 is
    // the constructor's own paused-mount paint leaving a stray full-opacity
    // "Alpha" underneath the real, partial-alpha crossfade paint.
    inst.renderFrame!(5500, 1); // localT 500 of dur 1000 -> k = 0.5
    const painted = vi.mocked(mockCtx.fillText).mock.calls.map((c) => c[0]);
    expect(painted.filter((t) => t === 'Alpha')).toHaveLength(1);
    expect(painted.filter((t) => t === 'Omega')).toHaveLength(1);
    inst.dispose();
  });

  it('a fade over a bed puts both segments on canvases of their own: incoming at k, outgoing at 1 − k, each cleared', () => {
    const recs = perCanvasContexts();
    const host = document.createElement('div');
    const inst = mountSync(compileSequence(bedSeq({
      segments: [
        { key: 'a', scene: SCENE, duration: 5000, transition: { type: 'fade', dur: 1000 } },
        { key: 'b', scene: SCENE, duration: 5000 },
      ],
    })), saverCtx({ host }));
    inst.renderFrame!(4000, 1);
    inst.renderFrame!(5300, 1);
    const k = 0.3 * 0.3 * (3 - 0.6);
    const main = mainOf(recs, host);
    expect(main.fills).toContain('#0a0a1a');
    expect(main.drawAlphas).toHaveLength(2);
    expect(main.drawAlphas[0]).toBeCloseTo(k, 5);
    expect(main.drawAlphas[1]).toBeCloseTo(1 - k, 5);
    expect(fadingInOf(inst)?.index).toBe(1);
    expect(fadingOf(inst)?.index).toBe(0);
    const off = offscreenOf(recs, host);
    expect(off).toHaveLength(2);
    for (const o of off) {
      expect(o.clears).toBe(1); // transparent children never clear; their owner does
      expect(o.fills).not.toContain('#0a0a1a');
      expect(o.fills).not.toContain('#05050a');
    }
    inst.renderFrame!(6100, 1);
    expect(fadingInOf(inst)).toBeNull();
    expect(fadingOf(inst)).toBeNull();
    expect(host.querySelectorAll('canvas')).toHaveLength(1);
    inst.dispose();
  });

  it('offscreen fade canvases over a bed get an alpha-enabled context, so a clear is real transparency, not opaque black', () => {
    // A `{ alpha: false }` 2D context can't clear to transparent — clearRect
    // on it fills with opaque black, so drawImage-ing it over the bed at any
    // alpha would paint a black wash instead of just the ink. Only the
    // transparent (bed-fade) offscreen canvases need alpha: true; the shared
    // surface stays alpha: false, matching pre-bed behaviour exactly.
    const calls: Array<{ canvas: HTMLCanvasElement; opts: unknown }> = [];
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, _type: string, opts?: unknown) {
      calls.push({ canvas: this, opts });
      return mockCtx;
    } as never;
    const host = document.createElement('div');
    const inst = mountSync(compileSequence(bedSeq({
      segments: [
        { key: 'a', scene: SCENE, duration: 5000, transition: { type: 'fade', dur: 1000 } },
        { key: 'b', scene: SCENE, duration: 5000 },
      ],
    })), saverCtx({ host }));
    inst.renderFrame!(4000, 1);
    inst.renderFrame!(5300, 1); // mid-fade: both the incoming and outgoing offscreen canvases exist
    // Only a canvas's FIRST getContext call establishes its options in a real
    // browser — later calls (e.g. renderOffscreen's plain getContext('2d'))
    // return the existing context regardless of what they pass.
    const firstCallPerCanvas = new Map<HTMLCanvasElement, unknown>();
    for (const c of calls) if (!firstCallPerCanvas.has(c.canvas)) firstCallPerCanvas.set(c.canvas, c.opts);
    const mainCanvas = host.querySelector('canvas')!;
    expect(firstCallPerCanvas.get(mainCanvas)).toEqual({ alpha: false });
    const offscreenFirstCalls = [...firstCallPerCanvas].filter(([canvas]) => canvas !== mainCanvas);
    expect(offscreenFirstCalls.length).toBeGreaterThan(0);
    for (const [, opts] of offscreenFirstCalls) expect(opts).toEqual({ alpha: true });
    inst.dispose();
    HTMLCanvasElement.prototype.getContext = orig;
  });

  it('costTier counts the bed together with the largest segment', () => {
    const big = (count: number): SaverSpec => ({ ...SCENE, layers: [{ ...SCENE.layers[0]!, count }] });
    const bed = { ...BED, layers: [{ ...BED.layers[0]!, count: 100 }] };
    const segments = [{ key: 'a', scene: big(100), duration: 5000 }, { key: 'b', scene: big(20), duration: 5000 }];
    expect(compileSequence(seq({ segments })).manifest.costTier).toBe('low'); // 100
    expect(compileSequence(seq({ bed, segments })).manifest.costTier).toBe('medium'); // 100 + 100
  });

  it('the bed is disposed with the sequence and resized with it', () => {
    const inst = mountSync(compileSequence(bedSeq()));
    const bed = bedOf(inst) as unknown as SaverInstance;
    const resized = vi.spyOn(bed, 'resize');
    const disposed = vi.spyOn(bed, 'dispose');
    inst.resize(800, 600);
    expect(resized).toHaveBeenCalledWith(800, 600, undefined);
    inst.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
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

// ---------------------------------------------------------------------------
// morph text: 'crossfade' (plan 1f, #45) — opt-in; default `step` is today
// ---------------------------------------------------------------------------

describe("morph text: 'crossfade' (1f)", () => {
  const caption = (text: string, color: string, extra: Partial<SaverSpec> = {}): SaverSpec => ({
    schemaVersion: 1,
    id: 'caption',
    label: 'Caption',
    seed: 3,
    background: { type: 'solid', color: '#05050a' },
    layers: [
      {
        key: 'cap',
        count: 1,
        sprite: { kind: 'textBlock', text, maxWidth: 0.6, fontSize: 0.05, color },
        motion: { type: 'static' },
        position: { x: 0.2, y: 0.2 },
      },
      {
        key: 'tag',
        count: 1,
        sprite: { kind: 'text', strings: [text.toUpperCase()], color, font: 'bold monospace' },
        size: [24, 24],
        motion: { type: 'static' },
        position: { x: 0.5, y: 0.8 },
      },
    ],
    ...extra,
  });
  const twins = (text?: 'step' | 'crossfade', b: SaverSpec = caption('Omega', '#ffffff')): IdleSequence => ({
    format: 'idle-sequence',
    schemaVersion: 1,
    id: 'crossfade',
    label: 'Crossfade',
    loop: false,
    segments: [
      { key: 'a', scene: caption('Alpha', '#000000'), duration: 5000, transition: text ? { type: 'morph', dur: 1000, text } : { type: 'morph', dur: 1000 } },
      { key: 'b', scene: b, duration: 5000 },
    ],
  });

  /** Mount with a context that records every fillText with the alpha it was painted at. */
  function mountRecording(s: IdleSequence) {
    const calls: Array<{ text: string; alpha: number }> = [];
    const ctx = stub2dContext();
    (ctx as unknown as { fillText: unknown }).fillText = vi.fn(function (this: { globalAlpha: number }, text: string) {
      calls.push({ text, alpha: +this.globalAlpha.toFixed(6) });
    });
    (ctx as unknown as { measureText: unknown }).measureText = vi.fn(() => ({ width: 10 }));
    HTMLCanvasElement.prototype.getContext = (() => ctx) as any;
    // Paused mount: no rAF loop, so the only frames painted are the ones
    // the test asks for.
    const inst = mountSync(compileSequence(s), saverCtx({ reducedMotion: true }));
    return { inst, calls };
  }
  const painted = (calls: Array<{ text: string; alpha: number }>, text: string) => calls.filter((c) => c.text === text);

  it("validator: text is 'step' | 'crossfade', on morph only", () => {
    expect(validateSequence(twins('step')).valid).toBe(true);
    expect(validateSequence(twins('crossfade')).valid).toBe(true);
    expect(validateSequence(twins()).valid).toBe(true);
    const bad = twins();
    (bad.segments[0]!.transition as { text?: unknown }).text = 'dissolve';
    expect(validateSequence(bad).errors.map((e) => e.path)).toContain('segments[0].transition.text');
    const onFade = twins();
    (onFade.segments[0] as { transition: unknown }).transition = { type: 'fade', dur: 600, text: 'crossfade' };
    expect(validateSequence(onFade).errors.map((e) => e.path)).toContain('segments[0].transition.text');
  });

  it('absent (or step) ⇒ the frame is what it always was: only the incoming words mid-morph, once each', () => {
    // The sequence baseline pins the entity streams; this pins the paint.
    for (const text of [undefined, 'step'] as const) {
      const { inst, calls } = mountRecording(twins(text));
      calls.length = 0;
      inst.renderFrame!(5500, 1); // k = easeSmooth(0.5) = 0.5
      expect(painted(calls, 'Alpha')).toEqual([]);
      expect(painted(calls, 'ALPHA')).toEqual([]);
      expect(painted(calls, 'Omega')).toHaveLength(1);
      expect(painted(calls, 'OMEGA')).toHaveLength(1);
      expect(painted(calls, 'Omega')[0]!.alpha).toBe(1);
      inst.dispose();
    }
  });

  it('crossfade paints both strings mid-morph at complementary alphas — textBlock and text sprites alike', () => {
    const { inst, calls } = mountRecording(twins('crossfade'));
    calls.length = 0;
    inst.renderFrame!(5500, 1); // localT 500 of dur 1000 → k = 0.5
    expect(painted(calls, 'Alpha')).toEqual([{ text: 'Alpha', alpha: 0.5 }]);
    expect(painted(calls, 'Omega')).toEqual([{ text: 'Omega', alpha: 0.5 }]);
    expect(painted(calls, 'ALPHA')).toEqual([{ text: 'ALPHA', alpha: 0.5 }]);
    expect(painted(calls, 'OMEGA')).toEqual([{ text: 'OMEGA', alpha: 0.5 }]);

    calls.length = 0;
    inst.renderFrame!(5250, 1); // k = easeSmooth(0.25) = 0.15625
    expect(painted(calls, 'Alpha')[0]!.alpha).toBeCloseTo(0.84375, 5);
    expect(painted(calls, 'Omega')[0]!.alpha).toBeCloseTo(0.15625, 5);
    // The outgoing words ride the lerped paint (colour glides as usual) and
    // are drawn before the incoming, so the new words sit on top.
    expect(calls.findIndex((c) => c.text === 'Alpha')).toBeLessThan(calls.findIndex((c) => c.text === 'Omega'));
    inst.dispose();
  });

  it('at k = 0 only the outgoing words; at k = 1 (morph complete) only the incoming, once', () => {
    const { inst, calls } = mountRecording(twins('crossfade'));
    calls.length = 0;
    inst.renderFrame!(5000, 1); // boundary: k = 0
    expect(painted(calls, 'Alpha')).toEqual([{ text: 'Alpha', alpha: 1 }]);
    expect(painted(calls, 'Omega')).toEqual([]);

    // localT = dur → morph over. The first frame past the window finalises
    // the morph and re-mounts segment 1's child from the chain root (a
    // paused mount paints the root scene once at construction, before the
    // real frame overpaints it — pre-existing, and invisible); the frame
    // after that is the steady state this asserts.
    inst.renderFrame!(6000, 1);
    calls.length = 0;
    inst.renderFrame!(6000, 1);
    expect(painted(calls, 'Alpha')).toEqual([]);
    expect(painted(calls, 'Omega')).toEqual([{ text: 'Omega', alpha: 1 }]);
    expect(painted(calls, 'OMEGA')).toEqual([{ text: 'OMEGA', alpha: 1 }]);

    // Seeking back into the window re-arms the crossfade (same re-mount
    // rule: the chain-root child was released when the morph finalised);
    // leaving it clears it.
    inst.renderFrame!(5500, 1);
    calls.length = 0;
    inst.renderFrame!(5500, 1);
    expect(painted(calls, 'Alpha')).toEqual([{ text: 'Alpha', alpha: 0.5 }]);
    expect(painted(calls, 'Omega')).toEqual([{ text: 'Omega', alpha: 0.5 }]);
    inst.renderFrame!(2000, 1); // back in segment 0 (re-mounts its child)
    calls.length = 0;
    inst.renderFrame!(2000, 1);
    expect(painted(calls, 'Alpha')).toEqual([{ text: 'Alpha', alpha: 1 }]);
    expect(painted(calls, 'Omega')).toEqual([]);
    inst.dispose();
  });

  it('crossfade between same-worded twins is a plain morph frame (one draw per text layer)', () => {
    const { inst, calls } = mountRecording(twins('crossfade', caption('Alpha', '#ffffff')));
    calls.length = 0;
    inst.renderFrame!(5500, 1);
    expect(painted(calls, 'Alpha')).toEqual([{ text: 'Alpha', alpha: 1 }]);
    expect(painted(calls, 'ALPHA')).toEqual([{ text: 'ALPHA', alpha: 1 }]);
    inst.dispose();
  });

  it("morph-nothing-morphable is suppressed under crossfade when the words differ, and only then", () => {
    const codes = (s: IdleSequence) => (validateSequence(s).warnings ?? []).map((w) => w.code);
    const same = (text: string) => caption(text, '#000000');
    // Text-only twins: step (explicit or default) reads as a cut → warns.
    expect(codes(twins(undefined, same('Omega')))).toContain('morph-nothing-morphable');
    expect(codes(twins('step', same('Omega')))).toContain('morph-nothing-morphable');
    // Under crossfade the words are the thing that morphs.
    expect(codes(twins('crossfade', same('Omega')))).not.toContain('morph-nothing-morphable');
    // Crossfade with the same words and only a stepped string elsewhere
    // (`font`) still has nothing to morph.
    const fontOnly: SaverSpec = { ...same('Alpha'), layers: same('Alpha').layers.map((l) => ({ ...l, sprite: { ...l.sprite, font: 'serif' } as never })) };
    expect(codes(twins('crossfade', fontOnly))).toContain('morph-nothing-morphable');
    // adviseSequence agrees.
    expect(adviseSequence(twins('crossfade', same('Omega'))).map((w) => w.code)).not.toContain('morph-nothing-morphable');
    expect(adviseSequence(twins('step', same('Omega'))).map((w) => w.code)).toContain('morph-nothing-morphable');
  });
});

// ---------------------------------------------------------------------------
// hotSwapSequence — publish-without-remount (plan 2.6b)
// ---------------------------------------------------------------------------

describe('SequenceInstance — hotSwapSequence', () => {
  /** A slide: one drifting circle (the `arc` caller) under a headline. */
  const slide = (text: string, extra: Partial<SaverSpec> = {}): SaverSpec => ({
    schemaVersion: 1, id: 'slide', label: 'Slide',
    background: { type: 'solid', color: '#05050a' },
    layers: [
      { key: 'dot', count: 1, sprite: { kind: 'circle', radius: [0.02, 0.02], color: '#ffffff' }, motion: { type: 'drift', speed: [0.2, 0.2], angle: 0 } },
      { key: 'h', count: 1, sprite: { kind: 'textBlock', text, maxWidth: 0.6, fontSize: 0.05, color: '#ffffff' }, motion: { type: 'static' }, position: { x: 0.2, y: 0.2 } },
    ],
    ...extra,
  });
  const bed = (color: string): SaverSpec => ({
    schemaVersion: 1, id: 'bed', label: 'Bed',
    background: { type: 'solid', color: '#0a0a1a' },
    layers: [{ key: 'orb', count: 1, sprite: { kind: 'circle', radius: [0.03, 0.03], color }, motion: { type: 'drift', speed: [0.1, 0.1], angle: 90 } }],
  });
  const show = (headline = 'Alpha', bedColor = '#ffffff', extra: Partial<IdleSequence> = {}): IdleSequence => seq({
    bed: bed(bedColor),
    segments: [
      { key: 'a', scene: slide(headline), duration: 5000 },
      { key: 'b', scene: slide('Beta'), duration: 3000, advance: 'input' },
      { key: 'c', scene: slide('Gamma'), duration: 4000, transition: { type: 'morph', dur: 1000 } },
    ],
    ...extra,
  });
  type Priv = { seq: IdleSequence; activeIndex: number; clockOffset: number; releasedBelow: number; renderedT: number; children: Array<{ effSpec: SaverSpec } | null>; bed: { effSpec: SaverSpec } | null };
  const priv = (inst: SaverInstance): Priv => inst as unknown as Priv;
  const headlineOf = (spec: SaverSpec | undefined): unknown => (spec?.layers[1]?.sprite as { text?: unknown } | undefined)?.text;
  const bedColorOf = (inst: SaverInstance): unknown => (priv(inst).bed?.effSpec.layers[0]?.sprite as { color?: unknown } | undefined)?.color;
  /** Where the clock stands: the `(segment, localT)` the next frame resolves to. */
  const where = (inst: SaverInstance) => {
    const p = priv(inst);
    const r = resolveSegment(p.seq, p.renderedT + p.clockOffset, { releasedBelow: p.releasedBelow });
    return { index: r.index, localT: r.localT, held: r.held ?? false };
  };

  /** Paused mount whose context records every fillText string and every arc's (x, y). */
  function mountRecording(s: IdleSequence) {
    const texts: string[] = [];
    const arcs: Array<[number, number]> = [];
    const ctx = stub2dContext();
    (ctx as unknown as { fillText: unknown }).fillText = vi.fn((text: string) => { texts.push(text); });
    (ctx as unknown as { arc: unknown }).arc = vi.fn((x: number, y: number) => { arcs.push([+x.toFixed(6), +y.toFixed(6)]); });
    (ctx as unknown as { measureText: unknown }).measureText = vi.fn(() => ({ width: 10 }));
    HTMLCanvasElement.prototype.getContext = (() => ctx) as any;
    const inst = mountSync(compileSequence(s), saverCtx({ reducedMotion: true }));
    return { inst, texts, arcs };
  }
  const swap = (inst: SaverInstance, next: IdleSequence): boolean => {
    expect(hasHotSwapSequence(inst)).toBe(true);
    if (!hasHotSwapSequence(inst)) throw new Error('unreachable');
    return inst.hotSwapSequence(next);
  };

  it('is typed on the plugin and feature-detectable on the instance; a plain scene has none', () => {
    const plugin = compileSequence(show());
    const inst = plugin.mount(saverCtx({ reducedMotion: true }));
    expect(typeof inst.hotSwapSequence).toBe('function');
    expect(hasHotSwapSequence(inst)).toBe(true);
    inst.dispose();
    const scene = compileSaver(SCENE).mount(saverCtx({ reducedMotion: true })) as SaverInstance;
    expect(hasHotSwapSequence(scene)).toBe(false);
    scene.dispose();
  });

  /**
   * The arcs a never-swapped twin paints at `T + 20` after the same clicker
   * steer and a frame at `T`: what "continuous" means below. Sequential, not
   * side by side — the recorder installs one context per mount, and children
   * are created lazily, so two live recorders would cross-talk.
   */
  function controlArcs(s: IdleSequence, T: number): Array<[number, number]> {
    const control = mountRecording(s);
    steerTo(control.inst, 2);
    control.inst.renderFrame!(T, 1);
    control.arcs.length = 0;
    control.inst.renderFrame!(T + 20, 1);
    control.inst.dispose();
    return control.arcs.slice();
  }

  it('(a) a paint-only republish swaps in place: same (segment, localT), new words painted, entities continuous', () => {
    const T = 990; // renderedT is 0 after the steer below; 990 ms into slide c
    const expectedArcs = controlArcs(show(), T);
    const { inst, texts, arcs } = mountRecording(show());
    // The clicker has released slide b and the show is ~1 s into slide c.
    steerTo(inst, 2);
    inst.renderFrame!(T, 1);
    const before = where(inst);
    expect(before.index).toBe(2);
    const state = { clockOffset: priv(inst).clockOffset, releasedBelow: priv(inst).releasedBelow, renderedT: priv(inst).renderedT, activeIndex: priv(inst).activeIndex };

    const fixed = show('Alpha', '#ff8800', {
      segments: show().segments.map((sg, i) => (i === 2 ? { ...sg, scene: slide('Gamma (fixed)') } : sg)),
    });
    texts.length = 0;
    expect(swap(inst, fixed)).toBe(true);

    // The clock did not move, the hold stays released, the same segment is up.
    expect(where(inst)).toEqual(before);
    expect({ clockOffset: priv(inst).clockOffset, releasedBelow: priv(inst).releasedBelow, renderedT: priv(inst).renderedT, activeIndex: priv(inst).activeIndex }).toEqual(state);
    expect(priv(inst).seq).toBe(fixed);
    // The live child and the bed took their new paint; the paused instance repainted at once.
    expect(headlineOf(priv(inst).children[2]?.effSpec)).toBe('Gamma (fixed)');
    expect(bedColorOf(inst)).toBe('#ff8800');
    expect(texts).toContain('Gamma (fixed)');
    expect(texts).not.toContain('Gamma');

    // 10 ms before and 10 ms after the swap: the bed orb and the slide's dot
    // are exactly where the never-swapped twin has them, and the next frame
    // is still slide c, 20 ms on.
    arcs.length = 0;
    inst.renderFrame!(T + 20, 1);
    expect(arcs).toHaveLength(2);
    expect(arcs).toEqual(expectedArcs);
    expect(where(inst)).toEqual({ ...before, localT: before.localT + 20 });
    inst.dispose();
  });

  it('(b) a structural edit (an extra layer in one segment) returns false and leaves the instance untouched', () => {
    const inst = mountSync(compileSequence(show()));
    inst.renderFrame!(1000, 1);
    const seqBefore = priv(inst).seq;
    const childBefore = priv(inst).children[0]!.effSpec;
    const bedBefore = priv(inst).bed!.effSpec;
    const before = where(inst);
    const grown = show('Alpha', '#ffffff', {
      segments: show().segments.map((sg, i) => (i === 1 ? { ...sg, scene: { ...sg.scene, layers: [...sg.scene.layers, SCENE.layers[0]!] } } : sg)),
    });
    expect(swap(inst, grown)).toBe(false);
    expect(priv(inst).seq).toBe(seqBefore);
    expect(priv(inst).children[0]!.effSpec).toBe(childBefore);
    expect(priv(inst).bed!.effSpec).toBe(bedBefore);
    expect(where(inst)).toEqual(before);
    inst.renderFrame!(1016, 1);
    expect(activeIndexOf(inst)).toBe(0);
    inst.dispose();
  });

  it('(c) swapping in the identical sequence changes nothing a viewer could see', () => {
    const expectedArcs = controlArcs(show(), 2000);
    const { inst, arcs } = mountRecording(show());
    steerTo(inst, 2);
    inst.renderFrame!(2000, 1);
    const twin = JSON.parse(JSON.stringify(show())) as IdleSequence;
    expect(swap(inst, twin)).toBe(true);
    expect(priv(inst).children[2]!.effSpec).toEqual({ ...slide('Gamma'), seed: 3 }); // seq.seed + index, as at mount
    arcs.length = 0;
    inst.renderFrame!(2020, 1);
    expect(arcs).toEqual(expectedArcs);
    inst.dispose();
  });

  it('(d) retained applyTrack deltas survive the swap — on the segments and on the bed', () => {
    const inst = mountSync(compileSequence(show()));
    inst.renderFrame!(1000, 1);
    const steer = (path: string, value: unknown): void =>
      inst.applyTrack!({ program: 'test', seed: 1, deltas: [{ t: 0, path, value, ease: 'step', dur: 0 }] } as never);
    steer('dot.sprite.color', '#00ff00'); // every slide owns `dot`
    steer('bed.orb.sprite.color', '#0000ff');
    expect((priv(inst).children[0]!.effSpec.layers[0]!.sprite as { color: string }).color).toBe('#00ff00');
    expect(bedColorOf(inst)).toBe('#0000ff');

    expect(swap(inst, show('Alpha (fixed)', '#ff8800'))).toBe(true);
    const child = priv(inst).children[0]!.effSpec;
    expect(headlineOf(child)).toBe('Alpha (fixed)'); // the republish landed…
    expect((child.layers[0]!.sprite as { color: string }).color).toBe('#00ff00'); // …and the steer is still on it
    expect(bedColorOf(inst)).toBe('#0000ff'); // the bed steer wins over the republished bed colour
    // A child created after the swap (next slide) is built from the NEW sequence with the same retained set.
    inst.renderFrame!(6000, 1);
    expect(activeIndexOf(inst)).toBe(1);
    expect(headlineOf(priv(inst).children[1]!.effSpec)).toBe('Beta');
    expect((priv(inst).children[1]!.effSpec.layers[0]!.sprite as { color: string }).color).toBe('#00ff00');
    inst.dispose();
  });

  it('mid-fade, both offscreen children take the republished scenes too', () => {
    const fading = show('Alpha', '#ffffff', {
      segments: [
        { key: 'a', scene: slide('Alpha'), duration: 5000, transition: { type: 'fade', dur: 1000 } },
        { key: 'b', scene: slide('Beta'), duration: 5000 },
      ],
    });
    const inst = mountSync(compileSequence(fading));
    inst.renderFrame!(5300, 1); // 300 ms into the fade, over a bed: two offscreen children
    expect(fadingOf(inst)?.index).toBe(0);
    expect(fadingInOf(inst)?.index).toBe(1);
    const fixed: IdleSequence = { ...fading, segments: [
      { ...fading.segments[0]!, scene: slide('Alpha!') },
      { ...fading.segments[1]!, scene: slide('Beta!') },
    ] };
    expect(swap(inst, fixed)).toBe(true);
    expect(headlineOf((fadingOf(inst)!.child as unknown as { effSpec: SaverSpec }).effSpec)).toBe('Alpha!');
    expect(headlineOf((fadingInOf(inst)!.child as unknown as { effSpec: SaverSpec }).effSpec)).toBe('Beta!');
    inst.renderFrame!(5400, 1);
    expect(fadingOf(inst)?.index).toBe(0);
    inst.dispose();
  });

  describe('sequenceSwapCompatible', () => {
    const base = () => show();
    const edit = (i: number, patch: Partial<IdleSequence['segments'][number]>): IdleSequence =>
      show('Alpha', '#ffffff', { segments: show().segments.map((sg, j) => (j === i ? { ...sg, ...patch } : sg)) });

    it('paint, ids, labels and segment keys are free', () => {
      expect(sequenceSwapCompatible(base(), show('Zeta', '#123456'))).toBe(true);
      expect(sequenceSwapCompatible(base(), { ...base(), id: 'other', label: 'Other' })).toBe(true);
      expect(sequenceSwapCompatible(base(), edit(0, { key: 'renamed' }))).toBe(true);
      expect(sequenceSwapCompatible(base(), edit(0, { scene: slide('Alpha', { background: { type: 'solid', color: '#ff0000' } }) }))).toBe(true);
    });

    it('defaults compare equal to their explicit spellings', () => {
      expect(sequenceSwapCompatible(base(), { ...base(), sync: 'mount' })).toBe(true);
      expect(sequenceSwapCompatible(base(), edit(0, { advance: 'auto', transition: { type: 'cut' } }))).toBe(true);
      expect(sequenceSwapCompatible(base(), edit(2, { transition: { type: 'morph', dur: 1000, text: 'step' } }))).toBe(true);
    });

    it('structure, timing, seed, loop, sync and the bed are pinned', () => {
      expect(sequenceSwapCompatible(base(), { ...base(), segments: base().segments.slice(0, 2) })).toBe(false);
      expect(sequenceSwapCompatible(base(), edit(1, { scene: { ...slide('Beta'), layers: [...slide('Beta').layers, SCENE.layers[0]!] } }))).toBe(false);
      expect(sequenceSwapCompatible(base(), edit(0, { duration: 6000 }))).toBe(false);
      expect(sequenceSwapCompatible(base(), edit(1, { advance: 'auto' }))).toBe(false);
      expect(sequenceSwapCompatible(base(), edit(2, { transition: { type: 'fade', dur: 1000 } }))).toBe(false);
      expect(sequenceSwapCompatible(base(), edit(2, { transition: { type: 'morph', dur: 800 } }))).toBe(false);
      expect(sequenceSwapCompatible(base(), edit(2, { transition: { type: 'morph', dur: 1000, text: 'crossfade' } }))).toBe(false);
      expect(sequenceSwapCompatible(base(), { ...base(), loop: true })).toBe(false);
      expect(sequenceSwapCompatible(base(), { ...base(), sync: 'epoch' })).toBe(false);
      expect(sequenceSwapCompatible(base(), { ...base(), seed: 2 })).toBe(false);
      expect(sequenceSwapCompatible(base(), edit(0, { scene: { ...slide('Alpha'), seed: 9 } }))).toBe(false);
      const noBed: IdleSequence = { ...base(), bed: undefined };
      expect(sequenceSwapCompatible(base(), noBed)).toBe(false);
      expect(sequenceSwapCompatible(noBed, base())).toBe(false);
      expect(sequenceSwapCompatible(base(), { ...base(), bed: { ...bed('#ffffff'), seed: 3 } })).toBe(false);
      expect(sequenceSwapCompatible(base(), { ...base(), bed: { ...bed('#ffffff'), layers: [...bed('#ffffff').layers, SCENE.layers[0]!] } })).toBe(false);
    });

    it('a seq.seed change is pinned even when every segment and the bed carry their own seed — a sequence-level finish still resolves against the mount-time seed', () => {
      const ownSeeds: IdleSequence = {
        ...base(),
        bed: { ...bed('#ffffff'), seed: 100 },
        segments: base().segments.map((sg, i) => ({ ...sg, scene: { ...sg.scene, seed: i + 1 } })),
      };
      // segmentRenderSeed/bedRenderSeed are unaffected by seq.seed here — the
      // per-segment and bed seeds win — so only the explicit seq.seed check
      // catches this.
      expect(sequenceSwapCompatible(ownSeeds, { ...ownSeeds, seed: (ownSeeds.seed ?? 0) + 1 })).toBe(false);
    });

    it('a seq.seed change of an exact multiple of 2**32 is free — the mount-time seed normalizes (>>> 0) to the same value', () => {
      const withSeed: IdleSequence = { ...base(), seed: 7 };
      expect(sequenceSwapCompatible(withSeed, { ...withSeed, seed: 7 + 2 ** 32 })).toBe(true);
      // undefined vs. defined must still be pinned even when the defined
      // side normalizes to what undefined would fall back to elsewhere.
      expect(sequenceSwapCompatible({ ...withSeed, seed: undefined }, withSeed)).toBe(false);
    });

    it('adding or removing every finish in the sequence is pinned — the presentation pass is allocated once at mount', () => {
      expect(sequenceSwapCompatible(base(), { ...base(), finish: { grain: 0.3 } })).toBe(false);
      expect(sequenceSwapCompatible(base(), edit(0, { scene: { ...slide('Alpha'), finish: { grain: 0.3 } } }))).toBe(false);
      const withFinish: IdleSequence = { ...base(), finish: { grain: 0.3 } };
      expect(sequenceSwapCompatible(withFinish, base())).toBe(false);
      // Changing an existing finish's own values is free — finish paint isn't structural.
      expect(sequenceSwapCompatible(withFinish, { ...withFinish, finish: { grain: 0.6 } })).toBe(true);
    });
  });
});
