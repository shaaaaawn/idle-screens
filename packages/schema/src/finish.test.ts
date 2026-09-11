// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Ajv } from 'ajv';
import { createRng, type SaverContext, type SaverInstance } from '@idle-screens/core';
import schema from '../saver-spec.schema.json';
import { DITHER_ALPHA, DITHER_TILE, FINISH_ANIMATE_HZ, GRAIN_ALPHA, GRAIN_TILE, bayerMatrix, bayerTilePixels, finishStrength, grainOffset, grainTilePixels, pickScreenOp } from './finish';
import { compileSaver, compileSequence, type SequenceMountContext } from './compile';
import { validateSequence, validateSpec } from './validate';
import { luminanceGrid } from './perceive';
import { describeScene } from './describe';
import { applyDeltasToSpec, resolveSpecPath, steerablePaths, structuralSignature } from './steer';
import type { IdleSequence, SaverSpec } from './types';

function spec(over: Partial<SaverSpec> = {}): SaverSpec {
  return {
    schemaVersion: 1,
    id: 'fin',
    label: 'Finish',
    seed: 5,
    background: { type: 'solid', color: '#102030' },
    layers: [
      { key: 'dots', count: 6, sprite: { kind: 'circle', radius: [0.02, 0.04], color: '#ffffff' }, motion: { type: 'drift', speed: [0.05, 0.1] } },
    ],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Tiles and offsets — pure
// ---------------------------------------------------------------------------

describe('finish tiles', () => {
  it('the grain tile is seeded, deterministic, zero-mean grey with opaque alpha', () => {
    const a = grainTilePixels(7);
    const b = grainTilePixels(7);
    const c = grainTilePixels(8);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.length).toBe(GRAIN_TILE * GRAIN_TILE * 4);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < a.length; i += 4) {
      expect(a[i]).toBe(a[i + 1]);
      expect(a[i]).toBe(a[i + 2]);
      expect(a[i + 3]).toBe(255);
      sum += a[i]!;
      n++;
    }
    expect(Math.abs(sum / n - 128)).toBeLessThan(0.5); // zero-mean about overlay's neutral point
  });

  it('the Bayer matrix is the ordered 8×8 (0..63, each once) and its tile averages mid grey', () => {
    const m = bayerMatrix();
    expect(m).toHaveLength(8);
    expect([...m.flat()].sort((x, y) => x - y)).toEqual(Array.from({ length: 64 }, (_, i) => i));
    expect(m[0]![0]).toBe(0);
    expect(m[0]![1]).toBe(32);
    expect(m[1]![0]).toBe(48);
    expect(m[1]![1]).toBe(16);
    const px = bayerTilePixels();
    expect(px.length).toBe(DITHER_TILE * DITHER_TILE * 4);
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i]!;
    expect(Math.abs(sum / 64 - 127.5)).toBeLessThan(1);
  });

  it('grainOffset: fixed at the origin unless animate; then a seeded step per 1/12 s bucket', () => {
    expect(grainOffset(0, 1, false)).toEqual({ x: 0, y: 0 });
    expect(grainOffset(123456, 1, false)).toEqual({ x: 0, y: 0 });
    const bucketMs = 1000 / FINISH_ANIMATE_HZ;
    const a = grainOffset(0, 1, true);
    expect(grainOffset(bucketMs - 1, 1, true)).toEqual(a);
    expect(grainOffset(bucketMs, 1, true)).not.toEqual(a);
    expect(grainOffset(5000, 1, true)).toEqual(grainOffset(5000, 1, true));
    expect(grainOffset(5000, 1, true)).not.toEqual(grainOffset(5000, 2, true));
    for (let t = 0; t < 3000; t += 37) {
      const o = grainOffset(t, 3, true);
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.x).toBeLessThan(GRAIN_TILE);
      expect(o.y).toBeGreaterThanOrEqual(0);
      expect(o.y).toBeLessThan(GRAIN_TILE);
    }
  });

  it('finishStrength clamps and defaults', () => {
    expect(finishStrength(undefined)).toEqual({ grain: 0, dither: 0 });
    expect(finishStrength({ grain: 2, dither: -1 })).toEqual({ grain: 1, dither: 0 });
    expect(finishStrength({ grain: 0.5 })).toEqual({ grain: 0.5, dither: 0 });
  });

  it('pickScreenOp reads back the blend the context accepts: overlay, else soft-light, else multiply', () => {
    const accepting = (ok: string[]) => {
      let op = 'source-over';
      return {
        get globalCompositeOperation() { return op; },
        set globalCompositeOperation(v: string) { if (ok.includes(v) || v === 'source-over') op = v; },
      };
    };
    expect(pickScreenOp(accepting(['overlay', 'soft-light']))).toBe('overlay');
    expect(pickScreenOp(accepting(['soft-light']))).toBe('soft-light');
    expect(pickScreenOp(accepting([]))).toBe('multiply');
    const c = accepting(['overlay']);
    pickScreenOp(c);
    expect(c.globalCompositeOperation).toBe('source-over'); // restored
  });
});

// ---------------------------------------------------------------------------
// Validator + JSON schema
// ---------------------------------------------------------------------------

describe('validateSpec / validateSequence — finish', () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const check = ajv.compile(schema);

  it('accepts a full finish, clean, on both validators', () => {
    const s = spec({ finish: { grain: 0.5, dither: 0.3, animate: true } });
    expect(validateSpec(s)).toEqual({ valid: true, errors: [], warnings: [] });
    expect(check(s)).toBe(true);
    expect(validateSpec(spec({ finish: {} })).valid).toBe(true);
  });

  it('bounds grain and dither to 0..1 and animate to a boolean', () => {
    for (const [f, path] of [
      [{ grain: 1.1 }, 'finish.grain'],
      [{ grain: -0.1 }, 'finish.grain'],
      [{ dither: 2 }, 'finish.dither'],
      [{ dither: 'x' }, 'finish.dither'],
      [{ animate: 1 }, 'finish.animate'],
      ['loud', 'finish'],
    ] as const) {
      const s = { ...spec(), finish: f };
      expect(validateSpec(s).errors.map((e) => e.path), JSON.stringify(f)).toContain(path);
      expect(check(s)).toBe(false);
    }
  });

  it('warns on unknown finish keys', () => {
    const r = validateSpec({ ...spec(), finish: { grain: 0.2, scratches: 1 } });
    expect(r.valid).toBe(true);
    expect(r.warnings).toEqual([{ path: 'finish.scratches', code: 'unknown-property', message: "unknown finish property 'scratches' — will be ignored" }]);
  });

  it('a sequence-level finish is validated at `finish`, and the JSON schema carries it', () => {
    const seq = (finish: unknown): IdleSequence => ({
      format: 'idle-sequence', schemaVersion: 1, id: 'q', label: 'Q', loop: false, finish: finish as never,
      segments: [{ key: 'a', scene: spec() }],
    });
    expect(validateSequence(seq({ grain: 0.4 })).valid).toBe(true);
    expect(check(seq({ grain: 0.4 }))).toBe(true);
    expect(validateSequence(seq({ grain: 3 })).errors.map((e) => e.path)).toContain('finish.grain');
    expect(validateSequence(seq({ grain: 0.4, foo: 1 })).warnings).toEqual([{ path: 'finish.foo', code: 'unknown-property', message: "unknown finish property 'foo' — will be ignored" }]);
  });
});

// ---------------------------------------------------------------------------
// Perception, description, steering
// ---------------------------------------------------------------------------

describe('finish is luminance-neutral to the analytic tools, and steerable', () => {
  it('luminanceGrid ignores it entirely: identical cells and mean with and without', () => {
    const plain = luminanceGrid(spec());
    const finished = luminanceGrid(spec({ finish: { grain: 1, dither: 1, animate: true } }));
    expect(finished.cells).toEqual(plain.cells);
    expect(Math.abs(finished.meanLuminance - plain.meanLuminance)).toBeLessThan(plain.meanLuminance * 0.01);
  });

  it('describeScene mentions the finish only when declared', () => {
    expect(describeScene(spec()).spec).toEqual({ id: 'fin', label: 'Finish', units: 'px' });
    expect(describeScene(spec({ finish: { grain: 0.5 } })).spec).toEqual({ id: 'fin', label: 'Finish', units: 'px', finish: { grain: 0.5 } });
  });

  it('finish.grain / finish.dither are numeric paint paths; absent finish exposes none and is not structural', () => {
    const s = spec({ finish: { grain: 0.5, dither: 0.3 } });
    expect(steerablePaths(s)).toEqual(expect.arrayContaining(['finish.grain', 'finish.dither']));
    expect(steerablePaths(spec()).some((p) => p.startsWith('finish'))).toBe(false);
    expect(resolveSpecPath(s, 'finish.grain')?.key).toBe('grain');
    expect(resolveSpecPath(spec(), 'finish.grain')).toBeNull();
    const next = applyDeltasToSpec(s, [{ t: 0, path: 'finish.grain', value: 0.9 }]);
    expect(next.finish?.grain).toBe(0.9);
    expect(structuralSignature(s)).toBe(structuralSignature(spec()));
  });
});

// ---------------------------------------------------------------------------
// Renderer: the presentation pass
// ---------------------------------------------------------------------------

interface Rec {
  fills: Array<{ style: unknown; op: string; alpha: number; smoothing: boolean }>;
  drawImages: Array<{ op: string; alpha: number }>;
  ops: string[];
  translates: Array<[number, number]>;
  patterns: number;
  ctx: CanvasRenderingContext2D;
}

/** One recording context per canvas, so the visible canvas, the scene canvas and the tiles can be told apart. */
function perCanvas(): Map<HTMLCanvasElement, Rec> {
  const recs = new Map<HTMLCanvasElement, Rec>();
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    const rec = recs.get(this);
    if (rec) return rec.ctx;
    const r: Rec = { fills: [], drawImages: [], ops: [], translates: [], patterns: 0, ctx: null as unknown as CanvasRenderingContext2D };
    let op = 'source-over';
    const ctx = {
      fillRect: vi.fn(function (this: { fillStyle: unknown; globalAlpha: number; imageSmoothingEnabled: boolean }) { r.fills.push({ style: this.fillStyle, op, alpha: this.globalAlpha, smoothing: this.imageSmoothingEnabled }); }),
      drawImage: vi.fn(function (this: { globalAlpha: number }) { r.drawImages.push({ op, alpha: this.globalAlpha }); }),
      translate: vi.fn((x: number, y: number) => { r.translates.push([x, y]); }),
      createPattern: vi.fn(() => { r.patterns++; return { pattern: true }; }),
      createImageData: vi.fn((w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })),
      putImageData: vi.fn(), clearRect: vi.fn(), fillText: vi.fn(), measureText: vi.fn(() => ({ width: 8 })),
      beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
      save: vi.fn(), restore: vi.fn(), rotate: vi.fn(), scale: vi.fn(), setTransform: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      fillStyle: '', strokeStyle: '', globalAlpha: 1, imageSmoothingEnabled: true, font: '', textAlign: 'center', textBaseline: 'middle', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
      get globalCompositeOperation() { return op; },
      set globalCompositeOperation(v: string) { op = v; r.ops.push(v); },
    } as unknown as CanvasRenderingContext2D;
    r.ctx = ctx;
    recs.set(this, r);
    return ctx;
  } as never;
  return recs;
}

let recs: Map<HTMLCanvasElement, Rec>;
let origGetContext: HTMLCanvasElement['getContext'];

beforeEach(() => {
  origGetContext = HTMLCanvasElement.prototype.getContext;
  recs = perCanvas();
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext;
});

function saverCtx(over: Partial<SaverContext> & { capabilityTier?: 'minimal' | 'basic' | 'standard' | 'high' } = {}): SaverContext {
  return { host: document.createElement('div'), dpr: 1, width: 800, height: 450, rng: createRng(1), seed: 1, reducedMotion: true, ...over };
}

function mount(s: SaverSpec, ctx: SaverContext = saverCtx()): SaverInstance {
  const inst = compileSaver(s).mount(ctx);
  if (inst instanceof Promise) throw new Error('sync mount expected');
  return inst;
}

const visibleOf = (host: HTMLElement): Rec => recs.get(host.querySelector('canvas')!)!;
/** Canvases not in the host: the scene canvas (large) and the tile canvases (256² / 8²). */
const offscreenOf = (host: HTMLElement): Array<[HTMLCanvasElement, Rec]> => [...recs.entries()].filter(([c]) => !host.contains(c));
const sceneOf = (host: HTMLElement): Rec | undefined => offscreenOf(host).find(([c]) => c.width !== GRAIN_TILE && c.width !== DITHER_TILE)?.[1];
const SCREEN_OPS = ['overlay', 'soft-light', 'multiply'];

describe('SpecInstance — finish presentation', () => {
  it('absent finish: one canvas, drawn directly — no scene canvas, no copy, no screen (the path before the field existed)', () => {
    const host = document.createElement('div');
    const inst = mount(spec(), saverCtx({ host }));
    inst.renderFrame!(500, 1);
    expect(host.querySelectorAll('canvas')).toHaveLength(1);
    expect(offscreenOf(host)).toEqual([]);
    const v = visibleOf(host);
    expect(v.drawImages).toEqual([]);
    expect(v.fills.some((f) => f.style === '#102030')).toBe(true);
    expect(v.ops.some((o) => SCREEN_OPS.includes(o))).toBe(false);
    inst.dispose();
  });

  it('with a finish the scene draws offscreen; the visible canvas gets one copy plus the screens, last, per frame', () => {
    const host = document.createElement('div');
    const inst = mount(spec({ finish: { grain: 0.5, dither: 0.3 } }), saverCtx({ host }));
    expect(host.querySelectorAll('canvas')).toHaveLength(1); // still one visible canvas
    const scene = sceneOf(host)!;
    const v = visibleOf(host);
    // The ground and the entities went to the scene canvas, never the visible one.
    expect(scene.fills.some((f) => f.style === '#102030')).toBe(true);
    expect(v.fills.some((f) => f.style === '#102030')).toBe(false);
    // Constructor paint: one copy, then grain (0.5 × 0.35) and dither (0.3 × 0.25), crisp, with the screen op.
    expect(v.drawImages).toEqual([{ op: 'source-over', alpha: 1 }]);
    expect(v.fills.map((f) => [f.op, +f.alpha.toFixed(4), f.smoothing])).toEqual([
      ['overlay', +(0.5 * GRAIN_ALPHA).toFixed(4), false],
      ['overlay', +(0.3 * DITHER_ALPHA).toFixed(4), false],
    ]);
    // The scene canvas never sees a screen op.
    expect(scene.ops.some((o) => SCREEN_OPS.includes(o))).toBe(false);
    // Tiles: created once, cached across frames.
    inst.renderFrame!(100, 1);
    inst.renderFrame!(200, 1);
    expect(v.patterns).toBe(2);
    expect(v.drawImages).toHaveLength(3);
    expect(v.fills).toHaveLength(6);
    inst.dispose();
  });

  it('grain only / dither only screen exactly their own tile; zero strengths copy without a screen', () => {
    for (const [f, fills] of [
      [{ grain: 1 }, 1],
      [{ dither: 1 }, 1],
      [{ grain: 0, dither: 0 }, 0],
    ] as const) {
      recs = perCanvas();
      const host = document.createElement('div');
      const inst = mount(spec({ finish: f }), saverCtx({ host }));
      const v = visibleOf(host);
      expect(v.drawImages).toHaveLength(1);
      expect(v.fills).toHaveLength(fills);
      inst.dispose();
    }
  });

  it('the finish never enters the persistence loop: ghosting 0.9 + grain 1 over 120 frames adds a bounded, constant screen per frame', () => {
    const host = document.createElement('div');
    const inst = mount(spec({ ghosting: 0.9, finish: { grain: 1 } }), saverCtx({ host }));
    const scene = sceneOf(host)!;
    const v = visibleOf(host);
    const before = { scene: scene.fills.length, copies: v.drawImages.length, screens: v.fills.length };
    for (let i = 1; i <= 120; i++) inst.renderFrame!(i * (1000 / 60), 1);
    // Scene canvas: only source-over/layer blends — never a screen op, never a pattern.
    expect(scene.ops.every((o) => !SCREEN_OPS.includes(o))).toBe(true);
    expect(scene.fills.every((f) => typeof f.style === 'string')).toBe(true);
    expect(scene.patterns).toBe(0);
    // Visible canvas: exactly one full-alpha copy and one grain screen per frame — nothing accumulates.
    expect(v.drawImages.length - before.copies).toBe(120);
    expect(v.fills.length - before.screens).toBe(120);
    expect(v.fills.every((f) => f.op === 'overlay' && Math.abs(f.alpha - GRAIN_ALPHA) < 1e-9)).toBe(true);
    expect(v.drawImages.every((d) => d.op === 'source-over' && d.alpha === 1)).toBe(true);
    // Persistence lives on the scene canvas: its ground was painted at partial alpha (the smear), the visible copy never.
    expect(scene.fills.slice(before.scene).some((f) => f.style === '#102030' && f.alpha < 1)).toBe(true);
    inst.dispose();
  });

  it('a static tile sits at the origin; animate steps the offset per 12 Hz bucket — deterministically', () => {
    const host = document.createElement('div');
    const inst = mount(spec({ finish: { grain: 1, animate: true } }), saverCtx({ host }));
    const v = visibleOf(host);
    inst.renderFrame!(0, 1);
    inst.renderFrame!(40, 1);
    inst.renderFrame!(100, 1);
    inst.renderFrame!(100, 1);
    const offs = v.translates.map(([x, y]) => `${x},${y}`);
    expect(offs[1]).toBe(offs[2]); // t = 0 and t = 40: same 1/12 s bucket
    expect(offs[3]).not.toBe(offs[2]); // t = 100: next bucket
    expect(offs[4]).toBe(offs[3]); // same t, same offset
    expect(offs[1]).toBe(`${-grainOffset(0, 5, true).x},${-grainOffset(0, 5, true).y}`);
    inst.dispose();

    recs = perCanvas();
    const host2 = document.createElement('div');
    const still = mount(spec({ finish: { grain: 1 } }), saverCtx({ host: host2 }));
    still.renderFrame!(100, 1);
    still.renderFrame!(5000, 1);
    expect(visibleOf(host2).translates.every(([x, y]) => x === 0 && y === 0)).toBe(true);
    still.dispose();
  });

  it("the 'basic' and 'minimal' tiers ignore animate (static tile)", () => {
    for (const tier of ['basic', 'minimal'] as const) {
      recs = perCanvas();
      const host = document.createElement('div');
      const inst = mount(spec({ finish: { grain: 1, animate: true } }), saverCtx({ host, capabilityTier: tier }));
      inst.renderFrame!(100, 1);
      inst.renderFrame!(2000, 1);
      expect(visibleOf(host).translates.every(([x, y]) => x === 0 && y === 0)).toBe(true);
      inst.dispose();
    }
  });

  it('a steered finish.grain glides the screen alpha', () => {
    const host = document.createElement('div');
    const inst = mount(spec({ finish: { grain: 0.2 } }), saverCtx({ host }));
    const v = visibleOf(host);
    inst.applyTrack!({ deltas: [{ t: 0, path: 'finish.grain', value: 1, dur: 0 }] } as never);
    expect(Math.abs(v.fills.at(-1)!.alpha - GRAIN_ALPHA)).toBeLessThan(1e-9); // paused: jumps to the target and repaints
    inst.dispose();
  });

  it('resize sizes the visible canvas with the scene canvas; dispose removes the visible canvas and drops the pass', () => {
    const host = document.createElement('div');
    const inst = mount(spec({ finish: { grain: 1 } }), saverCtx({ host }));
    const visible = host.querySelector('canvas')!;
    inst.resize(1200, 600, 2);
    expect([visible.width, visible.height]).toEqual([2400, 1200]);
    const [sceneCanvas] = offscreenOf(host).find(([c]) => c.width === 2400)!;
    expect(sceneCanvas.height).toBe(1200);
    inst.dispose();
    expect(host.querySelector('canvas')).toBeNull();
    expect((inst as unknown as { finishPass: unknown }).finishPass).toBeNull();
  });

  it('a transparent child never presents (its finish is the host\'s), even when its spec declares one', () => {
    // Mount through a sequence with a bed: the segment child is transparent and hostPresents.
    const seq: IdleSequence = {
      format: 'idle-sequence', schemaVersion: 1, id: 'q', label: 'Q', loop: false, seed: 3,
      bed: spec({ id: 'bed' }),
      segments: [{ key: 'a', scene: spec({ id: 'a', background: undefined, finish: { grain: 1 } }) }],
    };
    const host = document.createElement('div');
    const inst = compileSequence(seq).mount(saverCtx({ host })) as SaverInstance;
    inst.renderFrame!(500, 1);
    // Exactly one presentation per frame — the sequence's — with the segment's grain.
    const v = visibleOf(host);
    expect(v.drawImages).toHaveLength(2); // constructor frame + one renderFrame
    expect(v.fills).toHaveLength(2);
    expect(v.fills.every((f) => f.op === 'overlay')).toBe(true);
    inst.dispose();
  });
});

// ---------------------------------------------------------------------------
// SequenceInstance — once per composed frame
// ---------------------------------------------------------------------------

describe('SequenceInstance — finish', () => {
  /** Two fading segments; `finishB` is segment b's finish (none when omitted). */
  const twoSeq = (over: Partial<IdleSequence> = {}, finishB?: SaverSpec['finish']): IdleSequence => ({
    format: 'idle-sequence', schemaVersion: 1, id: 'q', label: 'Q', loop: false, seed: 3,
    segments: [
      { key: 'a', scene: spec({ id: 'a' }), duration: 5000, transition: { type: 'fade', dur: 1000 } },
      { key: 'b', scene: finishB ? spec({ id: 'b', finish: finishB }) : spec({ id: 'b' }), duration: 5000 },
    ],
    ...over,
  });
  const GRAIN_B = { grain: 0.8 } as const;

  const mountSeq = (seq: IdleSequence, ctx: SequenceMountContext): SaverInstance => {
    const inst = compileSequence(seq).mount(ctx);
    if (inst instanceof Promise) throw new Error('sync');
    return inst;
  };

  it('no finish anywhere: children draw straight onto the visible surface — no copy, no scene canvas', () => {
    const host = document.createElement('div');
    const seq = twoSeq();
    const inst = mountSeq(seq, saverCtx({ host }));
    inst.renderFrame!(500, 1);
    inst.renderFrame!(7000, 1);
    const v = visibleOf(host);
    expect(v.drawImages).toEqual([]);
    expect(v.fills.some((f) => f.style === '#102030')).toBe(true);
    expect(offscreenOf(host)).toEqual([]);
    inst.dispose();
  });

  it("a segment's finish applies while that segment is active, once per composed frame, and never while another is", () => {
    const host = document.createElement('div');
    const inst = mountSeq(twoSeq({}, GRAIN_B), saverCtx({ host }));
    const v = visibleOf(host);
    const scene = sceneOf(host)!;
    inst.renderFrame!(500, 1); // segment a: no finish
    expect(v.drawImages).toHaveLength(2); // constructor frame + this one: plain copies
    expect(v.fills).toHaveLength(0);
    inst.renderFrame!(7000, 1); // segment b: grain 0.8
    expect(v.drawImages).toHaveLength(3);
    expect(v.fills).toHaveLength(1);
    expect(v.fills[0]!.op).toBe('overlay');
    expect(Math.abs(v.fills[0]!.alpha - 0.8 * GRAIN_ALPHA)).toBeLessThan(1e-9);
    // During the fade into b (localT < dur) the incoming segment's finish applies to the composite, still once.
    inst.renderFrame!(5300, 1);
    expect(v.fills).toHaveLength(2);
    // Children only ever drew on the scene canvas, and never a screen op there.
    expect(scene.fills.some((f) => f.style === '#102030')).toBe(true);
    expect(scene.ops.some((o) => SCREEN_OPS.includes(o))).toBe(false);
    inst.dispose();
  });

  it('a sequence-level finish overrides every segment finish', () => {
    const host = document.createElement('div');
    const inst = mountSeq(twoSeq({ finish: { dither: 1 } }, GRAIN_B), saverCtx({ host }));
    const v = visibleOf(host);
    inst.renderFrame!(500, 1);
    inst.renderFrame!(7000, 1);
    expect(v.fills.every((f) => Math.abs(f.alpha - DITHER_ALPHA) < 1e-9)).toBe(true);
    expect(v.fills).toHaveLength(3); // constructor + 2 frames, dither only
    inst.dispose();
  });

  it('resize sizes the visible surface; dispose drops the tiles and removes the canvas', () => {
    const host = document.createElement('div');
    const inst = mountSeq(twoSeq({}, GRAIN_B), saverCtx({ host }));
    const visible = host.querySelector('canvas')!;
    inst.resize(1000, 500, 2);
    expect([visible.width, visible.height]).toEqual([2000, 1000]);
    inst.dispose();
    expect(host.querySelector('canvas')).toBeNull();
  });
});
