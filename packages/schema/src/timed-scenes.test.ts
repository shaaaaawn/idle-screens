// @vitest-environment happy-dom
/**
 * Timed scenes (registry #70, #71, #75, #76, #77): `timeline`, the steering
 * rule, layer `opacity` / `transform`, `position.dx` / `dy`, sequence
 * `wrapMorph` and morph `text: 'dip'`. Every field is opt-in; the baselines
 * (determinism-baseline, sequence-baseline) pin that absent fields change
 * nothing. These tests pin what the fields DO.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Ajv } from 'ajv';
import { createRng, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { compileSaver, compileSequence } from './compile';
import { canWrapMorph } from './sequence';
import { buildEntities } from './simulate';
import { easeSmooth, lerpSpec, structuralSignature } from './steer';
import { nextKeyAfter, resolveTimelineAt, timelineTracks, withoutTimeline } from './timeline';
import { validateSequence, validateSpec } from './validate';
import { dominanceRanking, luminanceGrid, motionStats } from './perceive';
import { adviseSequence } from './advise';
import type { IdleSequence, LayerSpec, SaverSpec, Timeline } from './types';
import jsonSchema from '../saver-spec.schema.json';

// ---------------------------------------------------------------------------
// Canvas mock (happy-dom has no 2d context) — records what the tests assert on.
// ---------------------------------------------------------------------------

interface Rec {
  fillRects: string[];
  fills: Array<{ style: string; alpha: number }>;
  texts: Array<{ text: string; alpha: number }>;
  calls: string[];
}

function recordingCtx(rec: Rec): CanvasRenderingContext2D {
  let fillStyle = '';
  const ctx = {
    fillRect: vi.fn(() => rec.fillRects.push(fillStyle)),
    fillText: vi.fn(function (this: { globalAlpha: number }, text: string) {
      rec.texts.push({ text, alpha: +ctx.globalAlpha.toFixed(6) });
    }),
    measureText: vi.fn((s: string) => ({ width: s.length * 8 })),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(() => rec.fills.push({ style: fillStyle, alpha: +ctx.globalAlpha.toFixed(6) })),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    save: vi.fn(() => rec.calls.push('save')),
    restore: vi.fn(() => rec.calls.push('restore')),
    translate: vi.fn((x: number, y: number) => rec.calls.push(`translate(${+x.toFixed(4)},${+y.toFixed(4)})`)),
    rotate: vi.fn((r: number) => rec.calls.push(`rotate(${+r.toFixed(6)})`)),
    scale: vi.fn((x: number, y: number) => rec.calls.push(`scale(${+x.toFixed(4)},${+y.toFixed(4)})`)),
    setTransform: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createImageData: vi.fn((w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })),
    putImageData: vi.fn(),
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    createPattern: vi.fn(() => ({})),
    imageSmoothingEnabled: true,
    get fillStyle() { return fillStyle; },
    set fillStyle(v: string) { fillStyle = typeof v === 'string' ? v : '<gradient>'; },
    strokeStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

let rec: Rec;
let origGetContext: HTMLCanvasElement['getContext'];

beforeEach(() => {
  rec = { fillRects: [], fills: [], texts: [], calls: [] };
  const ctx = recordingCtx(rec);
  origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => ctx) as any;
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = origGetContext;
});

const clear = (): void => { rec.fillRects.length = 0; rec.fills.length = 0; rec.texts.length = 0; rec.calls.length = 0; };

function saverCtx(overrides: Partial<SaverContext> = {}): SaverContext {
  return { host: document.createElement('div'), dpr: 1, width: 640, height: 400, rng: createRng(42), seed: 42, reducedMotion: true, ...overrides };
}

function mount(spec: SaverSpec, ctx?: Partial<SaverContext>): SaverInstance {
  const r = compileSaver(spec).mount(saverCtx(ctx));
  if (r instanceof Promise) throw new Error('expected sync mount');
  return r;
}

function mountSeq(seq: IdleSequence): SaverInstance {
  const r = compileSequence(seq).mount(saverCtx());
  if (r instanceof Promise) throw new Error('expected sync mount');
  return r;
}

/** The background colour of the frame at t: a solid ground is the last fillRect (a sequence clears its surface first). */
function groundAt(inst: SaverInstance, t: number): string {
  clear();
  inst.renderFrame!(t, 1);
  return rec.fillRects.at(-1)!;
}

const dot = (extra: Partial<LayerSpec> = {}): LayerSpec => ({
  key: 'dot',
  count: 1,
  sprite: { kind: 'circle', radius: [0.05, 0.05], color: '#ffffff' },
  motion: { type: 'static' },
  position: { x: 0.5, y: 0.5 },
  ...extra,
});

const scene = (extra: Partial<SaverSpec> = {}, layers: LayerSpec[] = [dot()]): SaverSpec => ({
  schemaVersion: 1,
  id: 'timed',
  label: 'Timed',
  seed: 7,
  background: { type: 'solid', color: '#000000' },
  layers,
  ...extra,
});

/** A lerped hex, the way lerpSpec produces it. */
const mix = (a: string, b: string, k: number): string =>
  (lerpSpec(scene({ background: { type: 'solid', color: a } }), scene({ background: { type: 'solid', color: b } }), k).background as { color: string }).color;

// ---------------------------------------------------------------------------
// timeline — the pure resolver
// ---------------------------------------------------------------------------

describe('resolveTimelineAt', () => {
  const tl = (t: Timeline): SaverSpec => scene({ timeline: t });

  it('a spec without a timeline comes back as the same object (the byte-identity guarantee)', () => {
    const s = scene();
    expect(resolveTimelineAt(s, 1234)).toBe(s);
    expect(withoutTimeline(s)).toBe(s);
  });

  it('holds the base value before the first key, glides smooth over dur, then holds the key', () => {
    const s = tl({ keys: [{ t: 1000, path: 'background.color', value: '#ff0000', dur: 1000 }] });
    const at = (t: number) => (resolveTimelineAt(s, t).background as { color: string }).color;
    expect(at(0)).toBe('#000000');
    expect(at(1000)).toBe('#000000');
    expect(at(1500)).toBe(mix('#000000', '#ff0000', easeSmooth(0.5)));
    expect(at(1250)).toBe(mix('#000000', '#ff0000', easeSmooth(0.25)));
    expect(at(2000)).toBe('#ff0000');
    expect(at(99999)).toBe('#ff0000');
    expect(resolveTimelineAt(s, 1500).timeline).toBeUndefined();
  });

  it("ease 'linear' and 'step'; dur 0 is a cut", () => {
    const s = tl({
      keys: [
        { t: 0, path: 'layers.0.opacity', value: 1, dur: 0 },
        { t: 1000, path: 'layers.0.opacity', value: 0, dur: 1000, ease: 'linear' },
        { t: 3000, path: 'layers.0.opacity', value: 1, dur: 1000, ease: 'step' },
      ],
    });
    const s2 = { ...s, layers: [dot({ opacity: 0.5 })] };
    const op = (t: number) => resolveTimelineAt(s2, t).layers[0]!.opacity;
    expect(op(0)).toBe(1);
    expect(op(1250)).toBeCloseTo(0.75, 10);
    expect(op(2000)).toBe(0);
    expect(op(3500)).toBe(0); // step holds until the glide ends
    expect(op(4000)).toBe(1);
  });

  it('an overlapping key glides from the earlier one’s in-flight value', () => {
    const s = scene({ layers: [dot({ opacity: 0 })], timeline: { keys: [
      { t: 0, path: 'layers.0.opacity', value: 1, dur: 2000, ease: 'linear' },
      { t: 1000, path: 'layers.0.opacity', value: 0, dur: 1000, ease: 'linear' },
    ] } });
    const op = (t: number) => resolveTimelineAt(s, t).layers[0]!.opacity!;
    expect(op(1000)).toBeCloseTo(0.5, 10); // the first glide's value when the second takes over
    expect(op(1500)).toBeCloseTo(0.25, 10);
    expect(op(2000)).toBe(0);
  });

  it('loop: value depends only on t mod duration, and before the first key is the LAST key’s value', () => {
    const s = tl({ loop: true, duration: 4000, keys: [
      { t: 500, path: 'background.color', value: '#ff0000', dur: 500 },
      { t: 2500, path: 'background.color', value: '#0000ff', dur: 500 },
    ] });
    const at = (t: number) => (resolveTimelineAt(s, t).background as { color: string }).color;
    expect(at(0)).toBe('#0000ff'); // wraps: the lap starts where the last key left it
    expect(at(1000)).toBe('#ff0000');
    expect(at(3000)).toBe('#0000ff');
    for (const t of [0, 700, 2600, 3999]) expect(at(t + 4000 * 7)).toBe(at(t));
  });

  it('key-form and index-form paths address one field (a later key wins at equal time)', () => {
    const s = tl({ keys: [
      { t: 0, path: 'layers.0.sprite.color', value: '#ff0000', dur: 0 },
      { t: 0, path: 'dot.sprite.color', value: '#00ff00', dur: 0 },
    ] });
    expect(timelineTracks(s).size).toBe(1);
    expect((resolveTimelineAt(s, 10).layers[0]!.sprite as { color: string }).color).toBe('#00ff00');
  });

  it('a key whose path does not resolve is dropped (the validator rejects it; the runtime stays lenient)', () => {
    const s = tl({ keys: [{ t: 0, path: 'layers.4.sprite.color', value: '#ff0000' }] });
    expect(resolveTimelineAt(s, 5000)).toEqual(withoutTimeline(s));
  });
});

describe('nextKeyAfter', () => {
  const s = scene({ timeline: { loop: true, duration: 10000, keys: [
    { t: 2000, path: 'background.color', value: '#ff0000', dur: 400 },
    { t: 6000, path: 'background.color', value: '#00ff00', dur: 800 },
  ] } });

  it('the next key on the path, in scene time — across laps', () => {
    expect(nextKeyAfter(s, 'background.color', 1000)).toEqual({ at: 2000, dur: 400 });
    expect(nextKeyAfter(s, 'background.color', 3000)).toEqual({ at: 6000, dur: 800 });
    expect(nextKeyAfter(s, 'background.color', 7000)).toEqual({ at: 12000, dur: 400 });
    expect(nextKeyAfter(s, 'background.color', 23000)).toEqual({ at: 26000, dur: 800 });
  });

  it('null for a path no key touches, and past the last key of a non-looping timeline', () => {
    expect(nextKeyAfter(s, 'layers.0.sprite.color', 0)).toBeNull();
    const once = scene({ timeline: { keys: [{ t: 2000, path: 'background.color', value: '#ff0000' }] } });
    expect(nextKeyAfter(once, 'background.color', 2500)).toBeNull();
    expect(nextKeyAfter(scene(), 'background.color', 0)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------

describe('validate: timeline', () => {
  const codes = (s: unknown) => (validateSpec(s).warnings ?? []).map((w) => w.code);
  const errs = (s: unknown) => validateSpec(s).errors.map((e) => `${e.path}: ${e.message}`);
  const tl = (t: unknown) => scene({ timeline: t as Timeline });

  it('accepts a well-formed looping timeline with no warnings', () => {
    const r = validateSpec(tl({ loop: true, duration: 8000, keys: [
      { t: 0, path: 'background.color', value: '#101020', dur: 1000 },
      { t: 4000, path: 'dot.sprite.color', value: '#ff8800', ease: 'linear', dur: 2000 },
      { t: 4000, path: 'layers.0.opacity', value: 0.5 },
    ] }));
    // `layers.0.opacity` is not on the base spec, so it cannot be keyed yet.
    expect(r.errors.map((e) => e.path)).toEqual(['timeline.keys[2].path']);
    const ok = validateSpec({ ...tl({ loop: true, duration: 8000, keys: [
      { t: 0, path: 'background.color', value: '#101020', dur: 1000 },
      { t: 4000, path: 'dot.opacity', value: 0.5, ease: 'step' },
    ] }), layers: [dot({ opacity: 1 })] });
    expect(ok).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('rejects bad shapes, unresolved or unanimatable paths, and values the spec would reject', () => {
    expect(errs(tl([]))).toEqual(['timeline: must be an object {loop?, duration?, keys}']);
    expect(errs(tl({ keys: [] }))[0]).toMatch(/^timeline.keys/);
    expect(errs(tl({ loop: true, keys: [{ t: 0, path: 'background.color', value: '#fff' }] }))).toContain('timeline.duration: loop: true needs a duration (the lap length in ms)');
    expect(errs(tl({ keys: [{ t: -1, path: 'background.color', value: '#fff' }] }))[0]).toMatch(/keys\[0\]\.t/);
    expect(errs(tl({ keys: [{ t: 0, path: 'nope.color', value: '#fff' }] }))[0]).toMatch(/does not resolve/);
    expect(errs(tl({ keys: [{ t: 0, path: 'id', value: 'x' }] }))[0]).toMatch(/^timeline.keys\[0\]\.path/);
    expect(errs(tl({ keys: [{ t: 0, path: 'background.color', value: 'red!' }] }))[0]).toMatch(/keys\[0\]\.value/);
    expect(errs(tl({ keys: [{ t: 0, path: 'background.color', value: '#fff', ease: 'bounce' }] }))[0]).toMatch(/ease/);
    expect(errs(tl({ keys: [{ t: 0, path: 'background.color', value: '#fff', dur: 40000 }] }))[0]).toMatch(/dur/);
    expect(errs(tl({ loop: true, duration: 1000, keys: [{ t: 1000, path: 'background.color', value: '#fff' }] }))).toContain("timeline.duration: must be greater than the latest key's t (1000 ms) under loop");
    expect(errs(tl({ keys: [{ t: 0, path: 'background.color', value: '#fff' }], tempo: 120 }))).toEqual([]);
    expect(codes(tl({ keys: [{ t: 0, path: 'background.color', value: '#fff' }], tempo: 120 }))).toContain('unknown-property');
  });

  it('enforces the 200 ms floor between distinct key times on one path — across the loop wrap too', () => {
    const near = tl({ keys: [
      { t: 1000, path: 'background.color', value: '#ffffff', dur: 0 },
      { t: 1100, path: 'background.color', value: '#000000', dur: 0 },
    ] });
    expect(errs(near)[0]).toMatch(/closer than 200 ms/);
    // Different paths may share a beat.
    expect(validateSpec(tl({ keys: [
      { t: 1000, path: 'background.color', value: '#ffffff' },
      { t: 1100, path: 'dot.sprite.color', value: '#000000' },
    ] })).valid).toBe(true);
    const wrap = tl({ loop: true, duration: 2000, keys: [
      { t: 50, path: 'background.color', value: '#ffffff', dur: 0 },
      { t: 1900, path: 'background.color', value: '#000000', dur: 0 },
    ] });
    expect(errs(wrap)[0]).toMatch(/across the loop wrap/);
  });

  it('warns on a structural key (a rebuild, not a glide) and on a glide that overruns the lap', () => {
    expect(codes(tl({ keys: [{ t: 0, path: 'layers.0.position.x', value: 0.2 }] }))).toContain('timeline-structural-key');
    expect(codes(tl({ loop: true, duration: 2000, keys: [{ t: 1500, path: 'background.color', value: '#fff', dur: 1000 }] }))).toContain('timeline-glide-overruns-lap');
  });
});

describe('validate: opacity, transform, dx/dy', () => {
  const errs = (l: Partial<LayerSpec>) => validateSpec(scene({}, [dot(l)])).errors.map((e) => e.path);

  it('accepts in-range values', () => {
    expect(validateSpec(scene({}, [dot({ opacity: 0.3, transform: { x: -0.2, y: 0.1, scale: 1.5, scaleX: -1, rotate: 30 }, position: { x: 0.5, y: 0.5, dx: 0.25, dy: -0.1 } })])))
      .toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('rejects out-of-range values', () => {
    expect(errs({ opacity: 1.5 })).toEqual(['layers[0].opacity']);
    expect(errs({ opacity: -0.1 })).toEqual(['layers[0].opacity']);
    expect(errs({ transform: { x: 3 } })).toEqual(['layers[0].transform.x']);
    expect(errs({ transform: { scale: -1 } })).toEqual(['layers[0].transform.scale']);
    expect(errs({ transform: { scaleX: 9 } })).toEqual(['layers[0].transform.scaleX']);
    expect(errs({ transform: { rotate: 4000 } })).toEqual(['layers[0].transform.rotate']);
    expect(errs({ position: { x: 0.5, y: 0.5, dx: 2.5 } })).toEqual(['layers[0].position.dx']);
  });

  it("under units: 'px' the offsets are pixels, bounded in px", () => {
    const px = (l: Partial<LayerSpec>) => validateSpec({ ...scene({ units: 'px' }, [dot({ sprite: { kind: 'circle', radius: [20, 20], color: '#fff' }, ...l })]) });
    expect(px({ transform: { x: 120, y: -40 }, position: { x: 0.5, y: 0.5, dx: 300, dy: -80 } }).errors).toEqual([]);
    expect(px({ transform: { x: 20000 } }).errors.map((e) => e.message)).toEqual(['must be a number within ±17280 (px)']);
  });

  it('opacity / transform / timeline are paint (outside the structural signature); dx/dy are placement', () => {
    const base = structuralSignature(scene());
    expect(structuralSignature(scene({}, [dot({ opacity: 0.2 })]))).toBe(base);
    expect(structuralSignature(scene({}, [dot({ transform: { scale: 2 } })]))).toBe(base);
    expect(structuralSignature(scene({ timeline: { keys: [{ t: 0, path: 'background.color', value: '#fff' }] } }))).toBe(base);
    expect(structuralSignature(scene({}, [dot({ position: { x: 0.5, y: 0.5, dx: 0.1 } })]))).not.toBe(base);
  });
});

// ---------------------------------------------------------------------------
// dx / dy — placement in min(w, h) units (#71)
// ---------------------------------------------------------------------------

describe('position dx/dy', () => {
  for (const [w, h] of [[1920, 1080], [1080, 1920], [1000, 1000]] as const) {
    it(`offsets in min(w,h) units on ${w}×${h} — the offset is the same size on every aspect`, () => {
      const unit = Math.min(w, h);
      const [e] = buildEntities(dot({ position: { x: 0.5, y: 0.5, dx: 0.25, dy: -0.1 } }), createRng(1), w, h, unit);
      expect(e!.x0).toBeCloseTo(w / 2 + 0.25 * unit, 9);
      expect(e!.y0).toBeCloseTo(h / 2 - 0.1 * unit, 9);
    });
  }

  it('absent dx/dy is the same float as before, and the rng stream is untouched', () => {
    const a = buildEntities(dot(), createRng(1), 1920, 1080, 1080);
    const b = buildEntities(dot({ position: { x: 0.5, y: 0.5, dx: 0, dy: 0 } }), createRng(1), 1920, 1080, 1080);
    expect(b).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// the renderer: opacity + transform draw
// ---------------------------------------------------------------------------

describe('layer opacity / transform draw', () => {
  it('opacity multiplies the drawn alpha; absent draws exactly as before', () => {
    const plain = mount(scene());
    clear();
    plain.renderFrame!(0, 1);
    const a1 = rec.fills.map((f) => f.alpha);
    plain.dispose();
    const faded = mount(scene({}, [dot({ opacity: 0.25 })]));
    clear();
    faded.renderFrame!(0, 1);
    expect(rec.fills.map((f) => f.alpha)).toEqual(a1.map((a) => +(a * 0.25).toFixed(6)));
    faded.dispose();
  });

  it('opacity 0 skips the layer', () => {
    const inst = mount(scene({}, [dot({ opacity: 0 })]));
    clear();
    inst.renderFrame!(0, 1);
    expect(rec.fills).toEqual([]);
    inst.dispose();
  });

  it('transform wraps the layer in save / centre-translate / rotate / scale / uncentre / restore', () => {
    const inst = mount(scene({}, [dot({ transform: { x: 0.1, y: -0.05, scale: 2, scaleX: 0.5, rotate: 90 } })]), { width: 640, height: 400 });
    clear();
    inst.renderFrame!(0, 1);
    const i = rec.calls.indexOf('save');
    expect(rec.calls.slice(i, i + 5)).toEqual([
      'save',
      `translate(${320 + 0.1 * 400},${200 - 0.05 * 400})`,
      `rotate(${+(Math.PI / 2).toFixed(6)})`,
      'scale(1,2)',
      'translate(-320,-200)',
    ]);
    expect(rec.calls.at(-1)).toBe('restore');
    inst.dispose();
  });

  it('no transform ⇒ no save / restore added around the layer', () => {
    const count = (s: SaverSpec) => {
      const inst = mount(s);
      clear();
      inst.renderFrame!(0, 1);
      inst.dispose();
      return rec.calls.filter((c) => c === 'save').length;
    };
    const plain = count(scene());
    expect(count(scene({}, [dot({ transform: { scale: 1.5 } })]))).toBe(plain + 1);
    expect(rec.calls.some((c) => c.startsWith('scale'))).toBe(true);
    count(scene());
    expect(rec.calls.some((c) => c.startsWith('scale'))).toBe(false);
  });

  it('a live steer glides opacity without re-seeding (paint, not structure)', () => {
    const inst = mount(scene({}, [dot({ opacity: 1 })]));
    inst.renderFrame!(0, 1);
    inst.applyTrack!({ program: 't', seed: 1, deltas: [{ t: 0, path: 'dot.opacity', value: 0.5, ease: 'step', dur: 0 }] } as never);
    clear();
    inst.renderFrame!(100, 1);
    expect(rec.fills[0]!.alpha).toBeCloseTo(0.5, 6);
    inst.dispose();
  });
});

// ---------------------------------------------------------------------------
// the renderer: timeline + the steering rule
// ---------------------------------------------------------------------------

describe('SpecInstance with a timeline', () => {
  const film = (): SaverSpec => scene({ timeline: { keys: [
    { t: 1000, path: 'background.color', value: '#ff0000', dur: 1000 },
    { t: 4000, path: 'background.color', value: '#0000ff', dur: 1000 },
  ] } });

  it('renders the timeline on the scene clock, frame-addressably (seek back and forth)', () => {
    const inst = mount(film());
    for (const t of [0, 1500, 2500, 4500, 9000, 1500, 0]) {
      expect(groundAt(inst, t)).toBe((resolveTimelineAt(film(), t).background as { color: string }).color);
    }
    inst.dispose();
  });

  it('a steer on a path NO key touches is sticky, exactly as on an ambient scene', () => {
    const inst = mount(film());
    inst.renderFrame!(500, 1);
    inst.applyTrack!({ program: 't', seed: 1, deltas: [{ t: 0, path: 'dot.sprite.color', value: '#00ff00', ease: 'step', dur: 0 }] } as never);
    for (const t of [600, 5000, 60000]) {
      clear();
      inst.renderFrame!(t, 1);
      expect(rec.fills.map((f) => f.style)).toContain('#00ff00');
    }
    inst.dispose();
  });

  it('a steer on an ANIMATED path holds until that path’s next key, then glides back over the key’s dur', () => {
    const inst = mount(film());
    inst.renderFrame!(2500, 1); // red, between keys
    inst.applyTrack!({ program: 't', seed: 1, deltas: [{ t: 0, path: 'background.color', value: '#00ff00', ease: 'step', dur: 0 }] } as never);
    expect(groundAt(inst, 2600)).toBe('#00ff00');
    expect(groundAt(inst, 3999)).toBe('#00ff00');
    // The 4000 key takes the path back: a glide from the steer to the timeline's value.
    const tlAt = (t: number) => (resolveTimelineAt(film(), t).background as { color: string }).color;
    expect(groundAt(inst, 4500)).toBe(mix('#00ff00', tlAt(4500), easeSmooth(0.5)));
    expect(groundAt(inst, 5000)).toBe('#0000ff');
    expect(groundAt(inst, 8000)).toBe('#0000ff'); // expired: the timeline owns the path again
    inst.dispose();
  });

  it('a re-sent track (the host broadcasts the whole track on every steer) does not re-arm an expired hold', () => {
    const inst = mount(film());
    inst.renderFrame!(2500, 1);
    const colour = { t: 1111, path: 'background.color', value: '#00ff00', ease: 'step', dur: 0 };
    inst.applyTrack!({ program: 't', seed: 1, deltas: [colour] } as never);
    expect(groundAt(inst, 3000)).toBe('#00ff00');
    expect(groundAt(inst, 6000)).toBe('#0000ff'); // the 4000 key took the path back
    // A later, unrelated steer arrives with the full retained track — the colour delta keeps its stamp.
    inst.applyTrack!({ program: 't', seed: 1, deltas: [colour, { t: 2222, path: 'dot.sprite.color', value: '#ff00ff', ease: 'step', dur: 0 }] } as never);
    expect(groundAt(inst, 6100)).toBe('#0000ff');
    expect(rec.fills.map((f) => f.style)).toContain('#ff00ff');
    // A NEW steer of the same value (a new stamp) does apply.
    inst.applyTrack!({ program: 't', seed: 1, deltas: [{ ...colour, t: 3333 }] } as never);
    expect(groundAt(inst, 6200)).toBe('#00ff00');
    inst.dispose();
  });

  it('an invalid steer is rejected as on any scene', () => {
    const inst = mount(film());
    inst.renderFrame!(2500, 1);
    inst.applyTrack!({ program: 't', seed: 1, deltas: [{ t: 0, path: 'background.color', value: 'nope', ease: 'step', dur: 0 }] } as never);
    expect(groundAt(inst, 2600)).toBe('#ff0000');
    inst.dispose();
  });

  it('ghosting: a backward seek replays the warm-up on the timeline’s own values', () => {
    const s = { ...film(), ghosting: 0.5 };
    const inst = mount(s);
    inst.renderFrame!(4800, 1);
    clear();
    inst.renderFrame!(1500, 1); // non-contiguous: fixed-step replay ending at 1500
    expect(rec.fillRects.at(-1)).toBe((resolveTimelineAt(s, 1500).background as { color: string }).color);
    inst.dispose();
  });

  it('a timeline animating transform and opacity never rebuilds (placement stays put)', () => {
    const s = scene({ timeline: { loop: true, duration: 4000, keys: [
      { t: 0, path: 'dot.transform.scale', value: 1 },
      { t: 2000, path: 'dot.transform.scale', value: 3 },
      { t: 1000, path: 'dot.opacity', value: 0.2 },
    ] } }, [dot({ opacity: 1, transform: { scale: 1 } })]);
    expect(validateSpec(s).warnings ?? []).toEqual([]);
    const inst = mount(s);
    const arcs = (t: number) => { clear(); inst.renderFrame!(t, 1); return rec.calls.filter((c) => c.startsWith('scale')); };
    expect(arcs(3000)[0]).toBe('scale(3,3)');
    // Under loop the lap starts at the last key's value (3), and the t=0 key glides it back to 1.
    expect(arcs(500)[0]).toBe('scale(2,2)');
    expect(arcs(1000)[0]).toBe('scale(1,1)');
    inst.dispose();
  });
});

// ---------------------------------------------------------------------------
// perception follows the timeline + paint fields
// ---------------------------------------------------------------------------

describe('perception', () => {
  it('perceives the scene as resolved at opts.t', () => {
    const s = scene({ timeline: { keys: [{ t: 1000, path: 'background.color', value: '#ffffff', dur: 0 }] } });
    expect(luminanceGrid(s, { t: 0 }).meanLuminance).toBeLessThan(0.1);
    expect(luminanceGrid(s, { t: 2000 }).meanLuminance).toBeGreaterThan(0.9);
  });

  it('opacity scales a layer’s ink and dominance; transform moves and scales it', () => {
    const bright = scene({}, [dot({ sprite: { kind: 'circle', radius: [0.2, 0.2], color: '#ffffff' } })]);
    const dim = scene({}, [dot({ sprite: { kind: 'circle', radius: [0.2, 0.2], color: '#ffffff' }, opacity: 0.2 })]);
    expect(luminanceGrid(dim).meanLuminance).toBeLessThan(luminanceGrid(bright).meanLuminance);
    const big = scene({}, [dot({ sprite: { kind: 'circle', radius: [0.2, 0.2], color: '#ffffff' }, transform: { scale: 2 } })]);
    expect(dominanceRanking(big)[0]!.factors.area).toBeCloseTo(dominanceRanking(bright)[0]!.factors.area * 4, 6);
    const moved = scene({}, [dot({ sprite: { kind: 'circle', radius: [0.05, 0.05], color: '#ffffff' }, transform: { x: 0.4 } })]);
    expect(luminanceGrid(moved).centroid!.x).toBeGreaterThan(0.6);
    expect(motionStats(moved)[0]!.moving).toBe(false);
  });

  it('motionStats sees a timeline gliding a layer transform, not just an entity’s own motion', () => {
    const s = scene({ timeline: { keys: [
      { t: 0, path: 'dot.transform.x', value: 0, dur: 0 },
      { t: 1000, path: 'dot.transform.x', value: 1, ease: 'linear', dur: 3000 },
    ] } }, [dot({ transform: { x: 0 } })]);
    expect(validateSpec(s).warnings ?? []).toEqual([]);
    // Sampled mid-glide: the layer's own entity is static, so only the
    // timeline-driven transform moves it between t and t+dt.
    expect(motionStats(s, { t: 2000, dt: 500 })[0]!.moving).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sequences: morph over timelines, text 'dip', wrapMorph
// ---------------------------------------------------------------------------

const segScene = (color: string, extra: Partial<SaverSpec> = {}): SaverSpec => scene({ background: { type: 'solid', color }, ...extra });

describe('sequence morph with timelines', () => {
  it('lerps each segment resolved on its own clock: outgoing at its end, incoming at localT', () => {
    const a = segScene('#000000', { timeline: { keys: [{ t: 1000, path: 'background.color', value: '#ff0000', dur: 0 }] } });
    const b = segScene('#0000ff', { timeline: { keys: [{ t: 0, path: 'background.color', value: '#00ff00', dur: 2000, ease: 'linear' }] } });
    const s: IdleSequence = { format: 'idle-sequence', schemaVersion: 1, id: 'm', label: 'M', loop: false, segments: [
      { key: 'a', scene: a, duration: 3000, transition: { type: 'morph', dur: 1000 } },
      { key: 'b', scene: b, duration: 5000 },
    ] };
    expect(validateSequence(s).valid).toBe(true);
    const inst = mountSeq(s);
    const localT = 500;
    const A = (resolveTimelineAt(a, 3000 + localT).background as { color: string }).color;
    const B = (resolveTimelineAt(b, localT).background as { color: string }).color;
    expect(A).toBe('#ff0000');
    expect(groundAt(inst, 3000 + localT)).toBe(mix(A, B, easeSmooth(localT / 1000)));
    // After the morph finalises, B's own timeline keeps running.
    expect(groundAt(inst, 3000 + 1500)).toBe((resolveTimelineAt(b, 1500).background as { color: string }).color);
    inst.dispose();
  });
});

describe("morph text: 'dip'", () => {
  const cap = (text: string): SaverSpec => scene({}, [{
    key: 'cap', count: 1, sprite: { kind: 'textBlock', text, maxWidth: 0.6, fontSize: 0.05, color: '#ffffff' }, motion: { type: 'static' }, position: { x: 0.2, y: 0.2 },
  }]);
  const s = (text: 'dip' | 'crossfade'): IdleSequence => ({ format: 'idle-sequence', schemaVersion: 1, id: 'd', label: 'D', loop: false, segments: [
    { key: 'a', scene: cap('Alpha'), duration: 5000, transition: { type: 'morph', dur: 1000, text } },
    { key: 'b', scene: cap('Omega'), duration: 5000 },
  ] });
  const painted = (t: number, text: 'dip' | 'crossfade') => {
    const inst = mountSeq(s(text));
    clear();
    inst.renderFrame!(t, 1);
    const out = { alpha: rec.texts.filter((c) => c.text === 'Alpha').map((c) => c.alpha), omega: rec.texts.filter((c) => c.text === 'Omega').map((c) => c.alpha) };
    inst.dispose();
    return out;
  };

  it('validates, and is not flagged morph-nothing-morphable', () => {
    const r = validateSequence(s('dip'));
    expect(r.valid).toBe(true);
    expect((r.warnings ?? []).map((w) => w.code)).not.toContain('morph-nothing-morphable');
  });

  it('first half: only the outgoing words, fading at 1 − 2k; second half: only the incoming at 2k − 1', () => {
    const k1 = easeSmooth(0.2);
    expect(painted(5200, 'dip')).toEqual({ alpha: [+(1 - 2 * k1).toFixed(6)], omega: [] });
    const k2 = easeSmooth(0.8);
    expect(painted(5800, 'dip')).toEqual({ alpha: [], omega: [+(2 * k2 - 1).toFixed(6)] });
    expect(painted(5500, 'dip')).toEqual({ alpha: [], omega: [] }); // k = 0.5: the dip's floor
  });

  it("crossfade is unchanged: both strings at complementary alphas", () => {
    const k = easeSmooth(0.2);
    expect(painted(5200, 'crossfade')).toEqual({ alpha: [+(1 - k).toFixed(6)], omega: [+k.toFixed(6)] });
  });
});

describe('wrapMorph', () => {
  const loop = (extra: Partial<IdleSequence> = {}, last: 'morph' | 'cut' = 'morph'): IdleSequence => ({
    format: 'idle-sequence', schemaVersion: 1, id: 'w', label: 'W', loop: true, segments: [
      { key: 'a', scene: segScene('#000000'), duration: 2000, transition: { type: 'morph', dur: 1000 } },
      { key: 'b', scene: segScene('#ffffff'), duration: 2000, transition: last === 'morph' ? { type: 'morph', dur: 1000 } : { type: 'cut' } },
    ], ...extra,
  });

  it('without wrapMorph the wrap is a hard cut (stored sequences keep their frames)', () => {
    const inst = mountSeq(loop());
    expect(groundAt(inst, 3500)).toBe('#ffffff');
    expect(groundAt(inst, 4500)).toBe('#000000');
    inst.dispose();
  });

  it('with wrapMorph the last segment morphs into segment 0 on every lap after the first', () => {
    const s = loop({ wrapMorph: true });
    expect(canWrapMorph(s)).toBe(true);
    expect(validateSequence(s)).toEqual({ valid: true, errors: [], warnings: [] });
    const inst = mountSeq(s);
    expect(groundAt(inst, 500)).toBe('#000000'); // the first mount at t=0 is not a wrap
    groundAt(inst, 3500);
    expect(groundAt(inst, 4500)).toBe(mix('#ffffff', '#000000', easeSmooth(0.5)));
    expect(groundAt(inst, 5200)).toBe('#000000');
    // lap 3, the inner boundary still morphs as it always did
    expect(groundAt(inst, 6500)).toBe(mix('#000000', '#ffffff', easeSmooth(0.5)));
    expect(groundAt(inst, 8500)).toBe(mix('#ffffff', '#000000', easeSmooth(0.5)));
    inst.dispose();
  });

  it('warns — and stays a cut — when it cannot apply', () => {
    const why = (s: IdleSequence) => (validateSequence(s).warnings ?? []).find((w) => w.code === 'wrap-morph-inactive')?.message;
    expect(why(loop({ wrapMorph: true, loop: false }))).toMatch(/does not loop/);
    expect(why(loop({ wrapMorph: true }, 'cut'))).toMatch(/no morph/);
    const split = loop({ wrapMorph: true });
    split.segments[0]!.transition = { type: 'cut' };
    expect(canWrapMorph(split)).toBe(false);
    expect(why(split)).toMatch(/not one morph chain/);
    const mismatch = loop({ wrapMorph: true });
    mismatch.segments[1]!.scene = segScene('#ffffff', { layers: [dot(), dot({ key: 'two' })] });
    expect(why(mismatch)).toMatch(/structurally/);
  });
});

// ---------------------------------------------------------------------------
// the published JSON Schema knows every new field
// ---------------------------------------------------------------------------


describe('saver-spec.schema.json', () => {
  const check = new Ajv({ allErrors: true, strict: false }).compile(jsonSchema);

  it('accepts a timed spec and a wrapMorph / dip sequence that the runtime validator accepts', () => {
    const spec = scene({ timeline: { loop: true, duration: 6000, keys: [
      { t: 0, path: 'dot.opacity', value: 1, ease: 'linear', dur: 500 },
      { t: 3000, path: 'dot.transform.scale', value: 2 },
    ] } }, [dot({ opacity: 0, transform: { scale: 1, scaleX: -1, rotate: 10, x: 0.1, y: 0 }, position: { x: 0.5, y: 0.5, dx: 0.2, dy: -0.1 } })]);
    expect(validateSpec(spec).valid).toBe(true);
    expect(check(spec), JSON.stringify(check.errors)).toBe(true);
    const seq: IdleSequence = { format: 'idle-sequence', schemaVersion: 1, id: 's', label: 'S', loop: true, wrapMorph: true, segments: [
      { key: 'a', scene: spec, duration: 3000, transition: { type: 'morph', dur: 1000, text: 'dip' } },
      { key: 'b', scene: spec, duration: 3000, transition: { type: 'morph', dur: 1000 } },
    ] };
    expect(validateSequence(seq).valid).toBe(true);
    expect(check(seq), JSON.stringify(check.errors)).toBe(true);
  });

  it('rejects the same out-of-range values the runtime rejects', () => {
    expect(check(scene({}, [dot({ opacity: 2 })]))).toBe(false);
    expect(check(scene({ timeline: { keys: [] } }))).toBe(false);
    expect(check(scene({ timeline: { keys: [{ t: 0, path: 'background.color', value: '#fff', ease: 'bounce' as never }] } }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// QA findings on PR #194 — each pinned so it cannot come back
// ---------------------------------------------------------------------------

describe('QA: composed validity (flash safety across keys and steers)', () => {
  const pulsing = (extra: Partial<SaverSpec> = {}): SaverSpec => scene(extra, [dot({
    key: 'a', count: 10, position: undefined, pulse: { amp: 0.5, period: 4000 }, clock: { rate: 0.5 }, opacity: 1,
  })]);
  const eff = (inst: SaverInstance): SaverSpec => (inst as unknown as { effSpec: SaverSpec }).effSpec;

  it('two keys each valid alone that combine past the flash floor are rejected', () => {
    const s = pulsing({ timeline: { keys: [
      { t: 0, path: 'a.clock.rate', value: 4, dur: 0 },
      { t: 0, path: 'a.pulse.period', value: 500, dur: 0 },
    ] } });
    const r = validateSpec(s);
    expect(r.valid).toBe(false);
    expect(r.errors.map((e) => e.path)).toContain('timeline');
    expect(r.errors.find((e) => e.path === 'timeline')!.message).toMatch(/combine into an invalid scene/);
  });

  it('a live steer that is valid now but breaks at a later key is rejected (sticky steer + future key)', () => {
    const inst = mount(pulsing({ timeline: { keys: [{ t: 3000, path: 'a.pulse.period', value: 500, dur: 0 }] } }));
    inst.renderFrame!(1000, 1);
    inst.applyTrack!({ program: 't', seed: 1, deltas: [{ t: 1, path: 'a.clock.rate', value: 4, ease: 'step', dur: 0 }] } as never);
    inst.renderFrame!(4000, 1);
    expect(validateSpec(structuredClone(eff(inst))).valid).toBe(true);
    expect(eff(inst).layers[0]!.clock!.rate).toBe(0.5);
    inst.dispose();
  });

  it('a second live steer that breaks the floor together with a held first one is rejected', () => {
    const inst = mount(pulsing({ timeline: { keys: [{ t: 9000, path: 'a.opacity', value: 1 }] } }));
    inst.renderFrame!(1000, 1);
    inst.applyTrack!({ program: 't', seed: 1, deltas: [{ t: 1, path: 'a.clock.rate', value: 4, ease: 'step', dur: 0 }] } as never);
    inst.applyTrack!({ program: 't', seed: 1, deltas: [{ t: 1, path: 'a.clock.rate', value: 4, ease: 'step', dur: 0 }, { t: 2, path: 'a.pulse.period', value: 1000, ease: 'step', dur: 0 }] } as never);
    inst.renderFrame!(1200, 1);
    expect(validateSpec(structuredClone(eff(inst))).valid).toBe(true);
    expect(eff(inst).layers[0]!.clock!.rate).toBe(4);
    expect(eff(inst).layers[0]!.pulse!.period).toBe(4000);
    // …and the same when the second steer arrives on its own (a host that sends only the new delta).
    inst.applyTrack!({ program: 't', seed: 1, deltas: [{ t: 3, path: 'a.pulse.period', value: 1000, ease: 'step', dur: 0 }] } as never);
    inst.renderFrame!(1300, 1);
    expect(validateSpec(structuredClone(eff(inst))).valid).toBe(true);
    expect(eff(inst).layers[0]!.pulse!.period).toBe(4000);
    inst.dispose();
  });
});

describe('QA: override glides', () => {
  const opacitySpec = (): SaverSpec => scene({ timeline: { keys: [{ t: 5200, path: 'dot.opacity', value: 1, dur: 1000 }] } }, [dot({ opacity: 1 })]);
  const op = (inst: SaverInstance, t: number): number => { inst.renderFrame!(t, 1); return (inst as unknown as { effSpec: SaverSpec }).effSpec.layers[0]!.opacity!; };

  it('a key landing mid glide-in takes the path back from where the glide had reached (no jump)', () => {
    const inst = mount(opacitySpec());
    (inst as unknown as { paused: boolean }).paused = false; // a playing instance: steers glide
    inst.renderFrame!(5000, 1);
    inst.applyTrack!({ program: 't', seed: 1, deltas: [{ t: 1, path: 'dot.opacity', value: 0, dur: 1000 }] } as never);
    const before = op(inst, 5199);
    const after = op(inst, 5201);
    expect(Math.abs(after - before)).toBeLessThan(0.02);
    expect(op(inst, 6300)).toBe(1);
    inst.dispose();
  });

  it('a re-sent track carrying two deltas for one field does not re-arm a released hold', () => {
    const inst = mount(opacitySpec());
    inst.renderFrame!(1000, 1);
    const deltas = [{ t: 10, path: 'dot.opacity', value: 0.2, ease: 'step', dur: 0 }, { t: 20, path: 'layers.0.opacity', value: 0.3, ease: 'step', dur: 0 }];
    inst.applyTrack!({ program: 't', seed: 1, deltas } as never);
    expect(op(inst, 2000)).toBe(0.3);
    expect(op(inst, 7000)).toBe(1); // the 5200 key took it back
    inst.applyTrack!({ program: 't', seed: 1, deltas: [...deltas, { t: 30, path: 'background.color', value: '#101010', ease: 'step', dur: 0 }] } as never);
    expect(op(inst, 7100)).toBe(1);
    inst.dispose();
  });
});

describe('QA: lerp of paint fields present on one side only', () => {
  it('opacity and transform glide from their identity instead of stepping', () => {
    const a = scene({}, [dot()]);
    const b = scene({}, [dot({ opacity: 0, transform: { x: 0.5 } })]);
    const mid = lerpSpec(a, b, 0.5).layers[0]!;
    expect(mid.opacity).toBeCloseTo(0.5, 9);
    expect(mid.transform!.x).toBeCloseTo(0.25, 9);
    const back = lerpSpec(b, a, 0.5).layers[0]!;
    expect(back.opacity).toBeCloseTo(0.5, 9);
    expect(back.transform!.x).toBeCloseTo(0.25, 9);
  });

  it('specs without the fields lerp to the very same shape as before', () => {
    const a = scene({}, [dot()]);
    const b = scene({ background: { type: 'solid', color: '#ffffff' } }, [dot({ sprite: { kind: 'circle', radius: [0.1, 0.1], color: '#000000' } })]);
    const mid = lerpSpec(a, b, 0.5);
    expect('opacity' in mid.layers[0]!).toBe(false);
    expect('transform' in mid.layers[0]!).toBe(false);
  });
});

describe('QA: sequences', () => {
  const sc = (c: string, extra: Partial<SaverSpec> = {}): SaverSpec => scene({ background: { type: 'solid', color: c }, ...extra });

  it('a morph does not bring back a steer the outgoing timeline already took back', () => {
    const s: IdleSequence = { format: 'idle-sequence', schemaVersion: 1, id: 'q', label: 'Q', loop: false, seed: 3, segments: [
      { key: 'r', scene: sc('#000000', { timeline: { keys: [{ t: 2000, path: 'background.color', value: '#ffffff', dur: 0 }] } }), duration: 3000, transition: { type: 'morph', dur: 1000 } },
      { key: 'g', scene: sc('#ffffff'), duration: 3000 },
    ] };
    const inst = mountSeq(s);
    groundAt(inst, 1000);
    inst.applyTrack!({ program: 't', seed: 1, deltas: [{ t: 1, path: 'background.color', value: '#ff0000', ease: 'step', dur: 0 }] } as never);
    expect(groundAt(inst, 1500)).toBe('#ff0000');
    expect(groundAt(inst, 2500)).toBe('#ffffff');
    // The outgoing end stays where its timeline took it (white) — no pop back to red…
    expect(groundAt(inst, 3000)).toBe('#ffffff');
    // …and glides to the incoming segment, which has no timeline, so the
    // retained steer is sticky there (documented sequence behaviour).
    expect(groundAt(inst, 3500)).toBe(mix('#ffffff', '#ff0000', easeSmooth(0.5)));
    expect(groundAt(inst, 4100)).toBe('#ff0000');
    inst.dispose();
  });

  it('with wrapMorph, a clicker jump to segment 0 cuts to it (no frame of the last segment)', () => {
    const s: IdleSequence = { format: 'idle-sequence', schemaVersion: 1, id: 'q', label: 'Q', loop: true, wrapMorph: true, seed: 3, segments: [
      { key: 'r', scene: sc('#ff0000'), duration: 3000, transition: { type: 'morph', dur: 1000 } },
      { key: 'g', scene: sc('#00ff00'), duration: 3000, transition: { type: 'morph', dur: 1000 } },
      { key: 'b', scene: sc('#0000ff'), duration: 3000, transition: { type: 'morph', dur: 1000 } },
    ] };
    const inst = mountSeq(s);
    expect(groundAt(inst, 4500)).toBe('#00ff00');
    clear();
    inst.applyTrack!({ program: 't', seed: 1, deltas: [{ t: 1, path: 'sequence.segment', value: 0 }] } as never);
    expect(rec.fillRects.at(-1)).toBe('#ff0000');
    expect(groundAt(inst, 4516)).toBe('#ff0000');
    inst.dispose();
  });

  it('a timeline key on finish.* reaches the sequence’s presented finish', () => {
    const s: IdleSequence = { format: 'idle-sequence', schemaVersion: 1, id: 'q', label: 'Q', loop: false, segments: [
      { key: 'a', scene: sc('#000000', { finish: { grain: 0.1 }, timeline: { keys: [{ t: 500, path: 'finish.grain', value: 0.3, dur: 0 }] } }), duration: 5000 },
    ] };
    expect(validateSequence(s).valid).toBe(true);
    const inst = mountSeq(s);
    inst.renderFrame!(2000, 1);
    expect((inst as unknown as { frameFinish(): { grain?: number } }).frameFinish().grain).toBe(0.3);
    inst.dispose();
  });

  it('boundary-luminance-jump judges the ground each side of the cut actually shows', () => {
    const s: IdleSequence = { format: 'idle-sequence', schemaVersion: 1, id: 'q', label: 'Q', loop: false, segments: [
      { key: 'a', scene: sc('#000000', { timeline: { keys: [{ t: 1000, path: 'background.color', value: '#ffffff', dur: 1000 }] } }), duration: 3000 },
      { key: 'b', scene: sc('#000000'), duration: 3000 },
    ] };
    expect(adviseSequence(s).map((w) => w.code)).toContain('boundary-luminance-jump');
  });
});
