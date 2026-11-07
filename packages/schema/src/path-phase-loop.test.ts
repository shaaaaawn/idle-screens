// @vitest-environment happy-dom
/**
 * Deterministic paths (registry row 69): `motion.phase` fixes where a path
 * entity starts on its lap, and `motion.loop: 'once' | 'hold'` stops it —
 * once where the lap ends (the first point), hold on the last point. Both
 * fields are opt-in; determinism-baseline pins that a spec without them is
 * unchanged. These tests pin what they DO, and that the preview (the
 * analytic perception build) and the canvas put the entity in one place.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Ajv } from 'ajv';
import { createRng, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { compileSaver } from './compile';
import { buildEntities, entityScales, headingAt, pathStop, positionAt, trailSince, type Entity } from './simulate';
import { trailEchoes } from './trail';
import { scenePeriod } from './period';
import { adviseSpec } from './advise';
import { luminanceGrid } from './perceive';
import { lerpSpec, readSpecPath, resolveSpecPath, steerablePaths, structuralSignature } from './steer';
import { validateSpec } from './validate';
import type { LayerSpec, SaverSpec } from './types';
import jsonSchema from '../saver-spec.schema.json';

const SQUARE = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }];
const LAP = 4000;

const pathLayer = (motion: Record<string, unknown> = {}, extra: Partial<LayerSpec> = {}): LayerSpec => ({
  key: 'ball',
  count: 1,
  sprite: { kind: 'circle', radius: [0.02, 0.02], color: '#ffffff' },
  alpha: [1, 1],
  motion: { type: 'path', points: SQUARE, duration: LAP, curve: 'linear', ...motion } as LayerSpec['motion'],
  ...extra,
});

const after: LayerSpec = {
  key: 'dust',
  count: 12,
  sprite: { kind: 'circle', radius: [0.002, 0.006], color: '#88aaff' },
  alpha: [0.2, 0.8],
  pulse: { amp: 0.2, period: 3000 },
  motion: { type: 'drift', speed: [0.01, 0.03], angle: 20 },
};

const scene = (layers: LayerSpec[], extra: Partial<SaverSpec> = {}): SaverSpec => ({
  schemaVersion: 1,
  id: 'paths',
  label: 'Paths',
  seed: 11,
  background: { type: 'solid', color: '#000000' },
  layers,
  ...extra,
});

/** Every layer's entities, built the way compile and perceive build them. */
function build(spec: SaverSpec, w = 1920, h = 1080): Entity[][] {
  const rng = createRng(spec.seed ?? 42);
  const { scale, countScale } = entityScales(spec, w, h);
  return spec.layers.map((l) => buildEntities(l, rng, w, h, scale, countScale));
}

const W = 1920;
const H = 1080;
const at = (p: { x: number; y: number }): { x: number; y: number } => ({ x: p.x * W, y: p.y * H });
const pos = (e: Entity, t: number): { x: number; y: number } => {
  const p = positionAt(e, t, W, H);
  return { x: p.x, y: p.y };
};
/** Within 5e-6 px: an open path's last point is reached at 1 − 1e-9 of its last segment (the engine's clamp). */
const near = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
  expect(a.x).toBeCloseTo(b.x, 5);
  expect(a.y).toBeCloseTo(b.y, 5);
};

describe('motion.phase', () => {
  it('fixes the starting point exactly, in place of the seeded one', () => {
    const [[e]] = build(scene([pathLayer({ phase: 0.3 })]));
    expect(e!.path!.phase).toBe(0.3);
    const [[z]] = build(scene([pathLayer({ phase: 0 })]));
    expect(pos(z!, 0)).toEqual(at(SQUARE[0]!));
    // A closed lap passes point k of n at k/n of the lap: the knot grid is exact.
    for (let k = 0; k < SQUARE.length; k++) near(pos(z!, (k / SQUARE.length) * LAP), at(SQUARE[k]!));
    // An open lap is there and back: its last point at 0.5.
    const [[o]] = build(scene([pathLayer({ phase: 0.5, closed: false })]));
    near(pos(o!, 0), at(SQUARE[3]!));
  });

  it('spreads count > 1 evenly from the phase: entity i at (phase + i/count) mod 1', () => {
    const [ents] = build(scene([pathLayer({ phase: 0.6 }, { count: 4 })]));
    expect(ents!.map((e) => e.path!.phase)).toEqual([0.6, (0.6 + 0.25) % 1, (0.6 + 0.5) % 1, (0.6 + 0.75) % 1]);
  });

  it('keeps its count at every viewport (a fixed-phase layer is choreography, not density)', () => {
    const spec = scene([pathLayer({ phase: 0.1 }, { count: 3 }), after]);
    for (const [w, h] of [[1280, 720], [1920, 1080], [3840, 2160]] as const) {
      const [ents] = build(spec, w, h);
      expect(ents!.length).toBe(3);
      expect(ents!.map((e) => e.path!.phase)).toEqual([0.1, (0.1 + 1 / 3) % 1, (0.1 + 2 / 3) % 1]);
    }
    // Without a phase the same layer still scales with the viewport, as before.
    expect(build(scene([pathLayer({}, { count: 3 })]), 3840, 2160)[0]!.length).toBe(6);
  });

  it('moves no other seeded value: the draw is still consumed', () => {
    const plain = build(scene([pathLayer({ scatter: 0.03 }, { count: 5, spin: [10, 40] }), after]));
    const fixed = build(scene([pathLayer({ scatter: 0.03, phase: 0.25, loop: 'hold' }, { count: 5, spin: [10, 40] }), after]));
    expect(JSON.stringify(fixed[1])).toBe(JSON.stringify(plain[1]));
    const strip = (es: Entity[]) => es.map((e) => ({ ...e, path: { ...e.path!, phase: 0, stop: undefined } }));
    expect(JSON.stringify(strip(fixed[0]!))).toBe(JSON.stringify(strip(plain[0]!)));
  });

  it('an explicit loop: "loop" builds the same entities as no loop at all', () => {
    const a = build(scene([pathLayer(), after]));
    const b = build(scene([pathLayer({ loop: 'loop' }), after]));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect('stop' in a[0]![0]!.path!).toBe(false);
  });
});

describe("motion.loop: 'once' and 'hold'", () => {
  const ent = (motion: Record<string, unknown>): Entity => build(scene([pathLayer(motion)]))[0]![0]!;

  it('is the loop until it stops — the same speed and the same knot times', () => {
    for (const closed of [true, false]) {
      for (const phase of [0, 0.35, 0.9]) {
        const loop = ent({ phase, closed });
        for (const loopMode of ['once', 'hold'] as const) {
          const stopped = ent({ phase, closed, loop: loopMode });
          const tStop = (stopped.path!.stop! - phase) * LAP;
          for (let t = 0; t < tStop; t += 97) near(pos(stopped, t), pos(loop, t));
        }
      }
    }
  });

  it("once stops at the end of its lap — the first point — and stays", () => {
    const e = ent({ phase: 0.25, loop: 'once' });
    expect(e.path!.stop).toBe(1);
    near(pos(e, 0.75 * LAP), at(SQUARE[0]!));
    for (const t of [0.75 * LAP + 1, 2 * LAP, 60_000, 3_600_000]) near(pos(e, t), at(SQUARE[0]!));
    // An open path's lap is there and back: once comes home.
    const o = ent({ phase: 0, loop: 'once', closed: false });
    near(pos(o, LAP / 2), at(SQUARE[3]!));
    for (const t of [LAP, 5 * LAP]) near(pos(o, t), at(SQUARE[0]!));
  });

  it('hold stops on the last point — arrive and stay', () => {
    const c = ent({ phase: 0, loop: 'hold' });
    expect(c.path!.stop).toBe(0.75); // (n − 1)/n: a closed path never runs its closing segment
    for (const t of [0.75 * LAP, LAP, 10 * LAP, 3_600_000]) near(pos(c, t), at(SQUARE[3]!));
    const o = ent({ phase: 0, loop: 'hold', closed: false });
    expect(o.path!.stop).toBe(0.5);
    for (const t of [LAP / 2, LAP, 10 * LAP]) near(pos(o, t), at(SQUARE[3]!));
  });

  it('an entity that starts past its stop reaches it on the next lap', () => {
    expect(pathStop('hold', true, 4, 0.9)).toBe(1.75);
    expect(pathStop('hold', false, 4, 0.6)).toBe(1.5);
    const e = ent({ phase: 0.9, loop: 'hold' });
    near(pos(e, 0.85 * LAP), at(SQUARE[3]!));
    near(pos(e, 20 * LAP), at(SQUARE[3]!));
    // It passed the first point on the way, a quarter-lap after the start of the next lap… still moving.
    near(pos(e, 0.1 * LAP), at(SQUARE[0]!));
  });

  it('is a pure function of t: seeking back before the stop shows it moving again', () => {
    const e = ent({ phase: 0, loop: 'hold' });
    const seq = [5000, 1000, 9000, 1000, 0].map((t) => pos(e, t));
    expect(seq[1]).toEqual(seq[3]);
    expect(seq[4]).toEqual(at(SQUARE[0]!));
    expect(seq[1]).not.toEqual(seq[0]);
  });

  it('with emit, the pass replays from phase on every event', () => {
    const every = 6000;
    const plain = build(scene([pathLayer({ phase: 0.1, loop: 'hold' })]))[0]![0]!;
    const emitted = build(scene([pathLayer({ phase: 0.1, loop: 'hold' }, { emit: { every, life: 5000 } })]))[0]![0]!;
    const ph = emitted.emit!.phase;
    for (const k of [0, 1, 7]) {
      for (const tau of [0, 400, 2000, 3500, 4900]) near(pos(emitted, ph + k * every + tau), pos(plain, tau));
    }
  });

  it('with emit, a trail starts at the event — it never ribbons back across the replay jump', () => {
    // A diamond whose replay jump (last point → first) is under half the
    // viewport, so the wrap-seam check alone would not stop the ribbon.
    const DIAMOND = [{ x: 0.3, y: 0.5 }, { x: 0.5, y: 0.3 }, { x: 0.7, y: 0.5 }, { x: 0.5, y: 0.7 }];
    const REST = DIAMOND[3]!;
    const trail = { length: 1500, fade: 1 };
    const spec = scene([pathLayer({ points: DIAMOND, phase: 0, loop: 'hold' }, { emit: { every: 6000, life: 5000 }, trail })]);
    const [[e]] = build(spec);
    const opened = e!.emit!.phase + 6000; // the second event opens here
    const t = opened + 400;
    expect(trailSince(e!, t)).toBe(opened);
    const posAt = (pt: number) => positionAt(e!, pt, W, H);
    const clipped = trailEchoes(trail, t, 1, 20, posAt, W, H, true, 0, 0, false, trailSince(e!, t));
    expect(clipped.length).toBeGreaterThan(0);
    for (const ec of clipped) expect(ec.t).toBeGreaterThanOrEqual(opened);
    // Unclipped, echoes would reach back to the last pass's rest point.
    const unclipped = trailEchoes(trail, t, 1, 20, posAt, W, H, true, 0, 0, false);
    expect(unclipped.some((ec) => Math.hypot(ec.x - W * REST.x, ec.y - H * REST.y) < 1)).toBe(true);
    // Every other entity keeps the clock's start: a looping path, and a stopping one without emit.
    expect(trailSince(build(scene([pathLayer({}, { emit: { every: 6000, life: 5000 } })]))[0]![0]!, t)).toBe(0);
    expect(trailSince(build(scene([pathLayer({ loop: 'hold' })]))[0]![0]!, t)).toBe(0);
    // Perception agrees: no ink at the last pass's rest point while the new pass is near its start.
    const g = luminanceGrid(spec, { viewport: { width: W, height: H }, t, cols: 96, rows: 54 });
    const cell = (x: number, y: number) => g.cells[Math.floor(y * g.rows) * g.cols + Math.floor(x * g.cols)]!;
    expect(cell(REST.x, REST.y)).toBe(g.background[Math.floor(REST.y * g.rows)]);
  });

  it('a once path starting just short of its stop still keeps its arrival heading', () => {
    // phase 0.999 on a 4000 ms lap: the stop is 4 ms away, under the 32 ms difference step.
    const [[e]] = build(scene([pathLayer({ phase: 0.999, loop: 'once' })]));
    const h = headingAt(e!, 1000, W, H);
    expect(h).not.toBeNull();
    // It arrives along the left edge, point 3 → 0: heading up.
    expect(Math.abs(h! + Math.PI / 2)).toBeLessThan(0.05);
  });

  it('a trail under emit never samples before the clock starts', () => {
    const trail = { length: 1500, fade: 1 };
    const spec = scene([pathLayer({ phase: 0, loop: 'hold' }, { emit: { every: 6000, life: 5000 }, trail })]);
    const [[e]] = build(spec);
    const t = 100; // before the first event opens
    const posAt = (pt: number) => positionAt(e!, pt, W, H);
    const echoes = trailEchoes(trail, t, 1, 20, posAt, W, H, true, 0, 0, false, trailSince(e!, t));
    expect(echoes.length).toBeGreaterThan(0);
    for (const ec of echoes) expect(ec.t).toBeGreaterThanOrEqual(0);
  });

  it('a moving emit path just after an event opens is oriented along the path, not the restart jump', () => {
    const DIAMOND = [{ x: 0.3, y: 0.5 }, { x: 0.5, y: 0.3 }, { x: 0.7, y: 0.5 }, { x: 0.5, y: 0.7 }];
    const [[e]] = build(scene([pathLayer({ points: DIAMOND, phase: 0, loop: 'hold' }, { emit: { every: 6000, life: 5000 } })]));
    const opened = e!.emit!.phase + 6000;
    const early = headingAt(e!, opened + 5, W, H);
    const later = headingAt(e!, opened + 100, W, H);
    expect(early).not.toBeNull();
    expect(early!).toBeCloseTo(later!, 1);
  });

  it('a resting entity keeps the heading it arrived with', () => {
    const e = ent({ phase: 0, loop: 'hold' });
    const arriving = headingAt(e, 0.75 * LAP - 1, W, H);
    expect(arriving).not.toBeNull();
    expect(headingAt(e, 0.75 * LAP, W, H)).toBeCloseTo(arriving!, 6);
    expect(headingAt(e, 50 * LAP, W, H)).toBeCloseTo(arriving!, 6);
    // It arrives along the bottom edge, point 2 → 3: heading left.
    expect(arriving!).toBeCloseTo(Math.PI, 6);
  });

  it('under a looping timeline, a pass that stops is noted (it does not replay per lap)', () => {
    const tl = { loop: true, duration: 8000, keys: [{ t: 0, path: 'background.color', value: '#101020', dur: 1000 }] };
    const notes = (motion: Record<string, unknown>, extra: Partial<LayerSpec> = {}) =>
      adviseSpec(scene([pathLayer(motion, extra)], { timeline: tl })).filter((w) => w.code === 'path-runs-once');
    const [w] = notes({ loop: 'hold' });
    expect(w?.path).toBe('layers[0].motion.loop');
    expect(w?.message).toMatch(/^informational: `ball`'s path/);
    expect(notes({ loop: 'once' })).toHaveLength(1);
    expect(notes({})).toHaveLength(0);
    expect(notes({ loop: 'hold' }, { emit: { every: 4000, life: 3000 } })).toHaveLength(0);
    expect(adviseSpec(scene([pathLayer({ loop: 'hold' })])).map((x) => x.code)).not.toContain('path-runs-once');
  });

  it('has no repeat period without emit; with emit it repeats with the events', () => {
    const once = scenePeriod(scene([pathLayer({ loop: 'once' })]));
    expect(once.period).toBeNull();
    expect(once.reasons.join(' ')).toMatch(/stops after one pass/);
    expect(scenePeriod(scene([pathLayer({ loop: 'hold' }, { emit: { every: 6000, life: 5000 } })])).period).toBe(6000);
    expect(scenePeriod(scene([pathLayer()])).period).toBe(LAP);
  });
});

describe('validation, schema and steering', () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const checkJson = ajv.compile(jsonSchema);
  const errs = (motion: Record<string, unknown>): string[] => validateSpec(scene([pathLayer(motion)])).errors.map((e) => `${e.path}: ${e.message}`);

  it('accepts 0 <= phase < 1 and the three loop modes, in the validator and the JSON Schema', () => {
    for (const m of [{ phase: 0 }, { phase: 0.999 }, { loop: 'loop' }, { loop: 'once' }, { loop: 'hold', phase: 0.5 }]) {
      expect(errs(m)).toEqual([]);
      expect(checkJson(scene([pathLayer(m)]))).toBe(true);
    }
  });

  it('rejects a phase outside 0..1 and an unknown loop mode, with a hint', () => {
    for (const phase of [-0.1, 1, 2, '0.5']) {
      expect(errs({ phase })).toEqual([expect.stringMatching(/^layers\[0\]\.motion\.phase: must be a number, 0 <= phase < 1/)]);
      expect(checkJson(scene([pathLayer({ phase })]))).toBe(false);
    }
    expect(errs({ loop: 'onse' })).toEqual([expect.stringMatching(/motion\.loop: must be 'loop' \| 'once' \| 'hold'.*did you mean 'once'/)]);
    expect(checkJson(scene([pathLayer({ loop: 'forever' })]))).toBe(false);
  });

  it('a phase on another motion type is an unknown property that points at path', () => {
    const w = validateSpec(scene([{ ...after, motion: { type: 'drift', speed: [0.01, 0.02], phase: 0.5 } as never }])).warnings ?? [];
    expect(w.find((x) => x.path === 'layers[0].motion.phase')?.message).toMatch(/path/);
  });

  it("advertises phase (a number that glides) but not loop (an enum that steps, like curve) — and both resolve", () => {
    const spec = scene([pathLayer({ phase: 0.2, loop: 'hold' })]);
    const paths = steerablePaths(spec);
    expect(paths).toContain('layers.0.motion.phase');
    expect(paths).not.toContain('layers.0.motion.loop');
    expect(paths).not.toContain('layers.0.motion.curve');
    for (const p of paths) expect(resolveSpecPath(spec, p)).not.toBeNull();
    expect(resolveSpecPath(spec, 'ball.motion.loop')).not.toBeNull();
    expect(readSpecPath(spec, 'ball.motion.phase')).toBe(0.2);
  });

  it('a phase glide re-places only that layer: structural, but nothing re-seeds', () => {
    const a = scene([pathLayer({ phase: 0 }), after]);
    const b = scene([pathLayer({ phase: 0.5 }), after]);
    expect(structuralSignature(a)).not.toBe(structuralSignature(b));
    const mid = lerpSpec(a, b, 0.5);
    expect((mid.layers[0]!.motion as { phase: number }).phase).toBe(0.25);
    const [pa, da] = build(a);
    const [pm, dm] = build(mid);
    expect(JSON.stringify(dm)).toBe(JSON.stringify(da));
    expect(pm![0]!.path!.phase).toBe(0.25);
    expect(pa![0]!.path!.phase).toBe(0);
  });

  it('a timeline key on phase glides without the structural-key warning; one on duration still warns', () => {
    const codes = (path: string, value: number): string[] =>
      (validateSpec(scene([pathLayer({ phase: 0 })], { timeline: { keys: [{ t: 1000, path, value, dur: 2000 }] } })).warnings ?? []).map((w) => w.code);
    expect(codes('ball.motion.phase', 0.5)).not.toContain('timeline-structural-key');
    expect(codes('layers.0.motion.phase', 0.5)).not.toContain('timeline-structural-key');
    expect(codes('ball.motion.duration', 8000)).toContain('timeline-structural-key');
  });
});

// ---------------------------------------------------------------------------
// The preview (analytic build + luminance grid) and the canvas agree.
// happy-dom has no 2d context: a recording mock captures where circles land.
// ---------------------------------------------------------------------------

interface Arc { x: number; y: number; r: number }
let arcs: Arc[];
let origGetContext: HTMLCanvasElement['getContext'];

function recordingCtx(): CanvasRenderingContext2D {
  const noop = vi.fn();
  const ctx = {
    arc: vi.fn((x: number, y: number, r: number) => arcs.push({ x, y, r })),
    fillRect: noop, fillText: noop, beginPath: noop, fill: noop, stroke: noop, moveTo: noop, lineTo: noop,
    closePath: noop, save: noop, restore: noop, translate: noop, rotate: noop, scale: noop, setTransform: noop,
    measureText: vi.fn((s: string) => ({ width: s.length * 8 })),
    createLinearGradient: vi.fn(() => ({ addColorStop: noop })),
    createRadialGradient: vi.fn(() => ({ addColorStop: noop })),
    createImageData: vi.fn((w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })),
    putImageData: noop, drawImage: noop, clearRect: noop, createPattern: vi.fn(() => ({})),
    imageSmoothingEnabled: true, fillStyle: '', strokeStyle: '', globalAlpha: 1, globalCompositeOperation: 'source-over',
    font: '', textAlign: 'center', textBaseline: 'middle', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  arcs = [];
  const ctx = recordingCtx();
  origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext;
});

describe('the preview matches the canvas', () => {
  const VW = 640;
  const VH = 400;
  const mount = (spec: SaverSpec): SaverInstance => {
    const ctx: SaverContext = { host: document.createElement('div'), dpr: 1, width: VW, height: VH, rng: createRng(spec.seed ?? 42), seed: spec.seed ?? 42, reducedMotion: true };
    const r = compileSaver(spec).mount(ctx);
    if (r instanceof Promise) throw new Error('expected sync mount');
    return r;
  };
  const canvasAt = (inst: SaverInstance, t: number): Arc => {
    arcs = [];
    inst.renderFrame!(t, 1);
    expect(arcs.length).toBe(1);
    return arcs[0]!;
  };
  /** The brightest cell of the luminance grid, as a pixel centre. */
  const previewPeak = (spec: SaverSpec, t: number): { x: number; y: number } => {
    const g = luminanceGrid(spec, { viewport: { width: VW, height: VH }, t, cols: 64, rows: 40 });
    let best = 0;
    g.cells.forEach((v, i) => { if (v > g.cells[best]!) best = i; });
    return { x: ((best % g.cols) + 0.5) * (VW / g.cols), y: (Math.floor(best / g.cols) + 0.5) * (VH / g.rows) };
  };

  for (const [label, motion] of [
    ['hold, closed', { phase: 0, loop: 'hold' }],
    ['once, open', { phase: 0.2, loop: 'once', closed: false, curve: 'smooth' }],
    ['looping, fixed phase', { phase: 0.7 }],
  ] as const) {
    it(`${label}: the canvas draws the entity where the analytic build puts it, and the grid sees it there`, () => {
      const spec = scene([pathLayer(motion)]);
      const inst = mount(spec);
      const [[e]] = build(spec, VW, VH);
      for (const t of [0, 900, 2100, 2999, 3000, 3700, 12_000, 600_000, 1500]) {
        const drawn = canvasAt(inst, t);
        const p = positionAt(e!, t, VW, VH);
        expect(drawn.x).toBeCloseTo(p.x, 6);
        expect(drawn.y).toBeCloseTo(p.y, 6);
        const peak = previewPeak(spec, t);
        expect(Math.hypot(peak.x - p.x, peak.y - p.y)).toBeLessThan(VW / 64);
      }
      inst.dispose();
    });
  }
});
