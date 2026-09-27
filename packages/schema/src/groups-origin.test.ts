// @vitest-environment happy-dom
/**
 * Layer groups (#70), `transform.origin` (#79) and advisories that honour
 * paint opacity (#80). All opt-in: the determinism / sequence / timed
 * baselines pin that specs without them are unchanged; these pin what they do.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createRng, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { compileSaver } from './compile';
import { adviseSpec } from './advise';
import { dominanceRanking, luminanceGrid } from './perceive';
import { lerpSpec, steerablePaths, structuralSignature } from './steer';
import { resolveTimelineAt } from './timeline';
import { validateSpec } from './validate';
import type { LayerSpec, SaverSpec } from './types';

interface Rec { fills: Array<{ alpha: number }>; calls: string[] }
let rec: Rec;
let origGetContext: HTMLCanvasElement['getContext'];

beforeEach(() => {
  rec = { fills: [], calls: [] };
  const ctx = {
    fillRect: vi.fn(), fillText: vi.fn(), measureText: vi.fn((s: string) => ({ width: s.length * 8 })),
    beginPath: vi.fn(), arc: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(),
    fill: vi.fn(() => rec.fills.push({ alpha: +ctx.globalAlpha.toFixed(6) })),
    save: vi.fn(() => rec.calls.push('save')),
    restore: vi.fn(() => rec.calls.push('restore')),
    translate: vi.fn((x: number, y: number) => rec.calls.push(`translate(${+x.toFixed(3)},${+y.toFixed(3)})`)),
    rotate: vi.fn((r: number) => rec.calls.push(`rotate(${+r.toFixed(4)})`)),
    scale: vi.fn((x: number, y: number) => rec.calls.push(`scale(${+x.toFixed(3)},${+y.toFixed(3)})`)),
    setTransform: vi.fn(), createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })), createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createImageData: vi.fn((w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })),
    putImageData: vi.fn(), drawImage: vi.fn(), clearRect: vi.fn(), createPattern: vi.fn(() => ({})),
    fillStyle: '', strokeStyle: '', globalAlpha: 1, globalCompositeOperation: 'source-over', font: '', textAlign: 'center', textBaseline: 'middle', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
  };
  origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => ctx) as any;
});
afterEach(() => { HTMLCanvasElement.prototype.getContext = origGetContext; });

const clear = (): void => { rec.fills.length = 0; rec.calls.length = 0; };
const saverCtx = (o: Partial<SaverContext> = {}): SaverContext => ({ host: document.createElement('div'), dpr: 1, width: 640, height: 400, rng: createRng(1), seed: 1, reducedMotion: true, ...o });
function mount(spec: SaverSpec): SaverInstance {
  const r = compileSaver(spec).mount(saverCtx());
  if (r instanceof Promise) throw new Error('sync');
  return r;
}
const dot = (x: Partial<LayerSpec> = {}): LayerSpec => ({ key: 'dot', count: 1, sprite: { kind: 'circle', radius: [0.05, 0.05], color: '#ffffff' }, motion: { type: 'static' }, position: { x: 0.5, y: 0.5 }, ...x });
const scene = (x: Partial<SaverSpec> = {}, layers: LayerSpec[] = [dot()]): SaverSpec => ({ schemaVersion: 1, id: 'g', label: 'G', seed: 3, background: { type: 'solid', color: '#000000' }, layers, ...x });

// ---------------------------------------------------------------------------
describe('validation', () => {
  const errs = (s: unknown) => validateSpec(s).errors.map((e) => e.path);

  it('accepts groups, membership and origin with no warnings', () => {
    const s = scene({ groups: { moon: { transform: { scale: 1.2, x: 0.1, origin: 'viewport' }, opacity: 0.8 }, empty: {} } },
      [dot({ group: 'moon', transform: { scale: 2, origin: 'anchor' } }), dot({ key: 'b', group: 'moon' })]);
    expect(validateSpec(s)).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('rejects an unknown group, bad names and values, and an anchored group transform', () => {
    expect(errs(scene({}, [dot({ group: 'nope' })]))).toEqual(['layers[0].group']);
    expect(errs(scene({ groups: { '1bad': {} } }))).toEqual(['groups.1bad']);
    expect(errs(scene({ groups: { g: { opacity: 2 } } }))).toEqual(['groups.g.opacity']);
    expect(errs(scene({ groups: { g: { transform: { origin: 'anchor' } } } }))).toEqual(['groups.g.transform.origin']);
    expect(errs(scene({ groups: { g: { transform: { scale: 9 } } } }))).toEqual(['groups.g.transform.scale']);
    expect(errs(scene({}, [dot({ transform: { origin: 'middle' as never } })]))).toEqual(['layers[0].transform.origin']);
    const many = Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`g${i}`, {}]));
    expect(errs(scene({ groups: many }))).toEqual(['groups']);
  });

  it('groups, membership and origin are paint — outside the structural signature', () => {
    const base = structuralSignature(scene());
    expect(structuralSignature(scene({ groups: { g: { opacity: 0.2 } } }, [dot({ group: 'g', transform: { origin: 'anchor' } })]))).toBe(base);
  });
});

// ---------------------------------------------------------------------------
describe('renderer', () => {
  it("origin: 'anchor' turns the layer about its own position (plus dx/dy), not the viewport centre", () => {
    // position (0.25, 0.5) + dx 0.1 on 640×400 ⇒ anchor (160 + 40, 200)
    const inst = mount(scene({}, [dot({ position: { x: 0.25, y: 0.5, dx: 0.1 }, transform: { scale: 2, origin: 'anchor' } })]));
    clear();
    inst.renderFrame!(0, 1);
    const i = rec.calls.indexOf('save');
    expect(rec.calls.slice(i, i + 4)).toEqual(['save', 'translate(200,200)', 'scale(2,2)', 'translate(-200,-200)']);
    inst.dispose();
  });

  it('a group transform wraps the member’s own (group first, about the viewport centre)', () => {
    const inst = mount(scene({ groups: { g: { transform: { x: 0.1, scale: 1.5 } } } }, [dot({ group: 'g', position: { x: 0.25, y: 0.5 }, transform: { scale: 2, origin: 'anchor' } })]));
    clear();
    inst.renderFrame!(0, 1);
    const i = rec.calls.indexOf('save');
    expect(rec.calls.slice(i, i + 7)).toEqual([
      'save', 'translate(360,200)', 'scale(1.5,1.5)', 'translate(-320,-200)', // group: about (320, 200), shifted 0.1 × 400
      'translate(160,200)', 'scale(2,2)', 'translate(-160,-200)', // layer: about its anchor
    ]);
    expect(rec.calls.filter((c) => c === 'restore')).toHaveLength(rec.calls.filter((c) => c === 'save').length);
    inst.dispose();
  });

  it('group opacity multiplies member opacity; 0 skips the layer; non-members are untouched', () => {
    const s = (o: number): SaverSpec => scene({ groups: { g: { opacity: o } } }, [dot({ group: 'g', opacity: 0.5 }), dot({ key: 'b' })]);
    let inst = mount(s(0.5));
    clear();
    inst.renderFrame!(0, 1);
    expect(rec.fills.map((f) => f.alpha)).toEqual([0.25, 1]);
    inst.dispose();
    inst = mount(s(0));
    clear();
    inst.renderFrame!(0, 1);
    expect(rec.fills.map((f) => f.alpha)).toEqual([1]);
    inst.dispose();
  });

  it('a steer on groups.<name>.opacity reaches every member without a rebuild', () => {
    const inst = mount(scene({ groups: { g: { opacity: 1 } } }, [dot({ group: 'g' }), dot({ key: 'b', group: 'g' })]));
    inst.renderFrame!(0, 1);
    inst.applyTrack!({ program: 't', seed: 1, deltas: [{ t: 1, path: 'groups.g.opacity', value: 0.4, ease: 'step', dur: 0 }] } as never);
    clear();
    inst.renderFrame!(100, 1);
    expect(rec.fills.map((f) => f.alpha)).toEqual([0.4, 0.4]);
    inst.dispose();
  });
});

// ---------------------------------------------------------------------------
describe('paths, timeline and lerp', () => {
  const g = (): SaverSpec => scene({ groups: { moon: { transform: { scale: 1, origin: 'viewport' }, opacity: 1 } } }, [dot({ group: 'moon', transform: { scale: 1, origin: 'anchor' } })]);

  it('steerablePaths lists group knobs, never timeline internals, membership or origin', () => {
    const paths = steerablePaths({ ...g(), timeline: { keys: [{ t: 0, path: 'groups.moon.opacity', value: 1 }] } });
    expect(paths).toEqual(expect.arrayContaining(['groups.moon.opacity', 'groups.moon.transform.scale', 'layers.0.transform.scale']));
    expect(paths.filter((p) => p.startsWith('timeline') || p.endsWith('.group') || p.endsWith('.origin'))).toEqual([]);
  });

  it('a timeline key animates a whole group', () => {
    const s = { ...g(), timeline: { keys: [{ t: 1000, path: 'groups.moon.transform.scale', value: 2, dur: 1000, ease: 'linear' as const }] } };
    expect(validateSpec(s).valid).toBe(true);
    expect(resolveTimelineAt(s, 1500).groups!.moon!.transform!.scale).toBeCloseTo(1.5, 9);
  });

  it('a morph between a grouped and an ungrouped end glides from the identity', () => {
    const a = scene({}, [dot()]);
    const b = scene({ groups: { moon: { opacity: 0, transform: { scale: 3 } } } }, [dot({ group: 'moon' })]);
    const mid = lerpSpec(a, b, 0.5);
    expect(mid.groups!.moon!.opacity).toBeCloseTo(0.5, 9);
    expect(mid.groups!.moon!.transform!.scale).toBeCloseTo(2, 9);
  });

  it('specs without groups lerp to the same shape as before', () => {
    const mid = lerpSpec(scene(), scene({ background: { type: 'solid', color: '#ffffff' } }), 0.5);
    expect('groups' in mid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('perception', () => {
  const big = (x: Partial<LayerSpec> = {}): LayerSpec => dot({ sprite: { kind: 'circle', radius: [0.1, 0.1], color: '#ffffff' }, ...x });

  it('group opacity 0 removes the members’ ink; group translate moves it', () => {
    expect(luminanceGrid(scene({ groups: { g: { opacity: 0 } } }, [big({ group: 'g' })])).meanLuminance).toBe(luminanceGrid(scene({}, [])).meanLuminance);
    const moved = luminanceGrid(scene({ groups: { g: { transform: { x: 0.5 } } } }, [big({ group: 'g' })]));
    expect(moved.centroid!.x).toBeGreaterThan(0.65);
  });

  it("origin: 'anchor' keeps a scaled layer where it stands", () => {
    const at = (origin: 'anchor' | 'viewport') => luminanceGrid(scene({}, [big({ position: { x: 0.2, y: 0.3 }, transform: { scale: 1.8, origin } })])).centroid!;
    expect(at('anchor').x).toBeCloseTo(0.2, 1);
    expect(at('viewport').x).toBeLessThan(0.1);
  });

  it('group scale weighs dominance area', () => {
    const one = dominanceRanking(scene({}, [big()]))[0]!.factors.area;
    const two = dominanceRanking(scene({ groups: { g: { transform: { scale: 2 } } } }, [big({ group: 'g' })]))[0]!.factors.area;
    expect(two).toBeCloseTo(one * 4, 6);
  });
});

// ---------------------------------------------------------------------------
describe('advisories honour paint opacity (#80)', () => {
  const dim = (x: Partial<LayerSpec> = {}): LayerSpec => dot({ key: 'dim', sprite: { kind: 'circle', radius: [0.05, 0.05], color: '#010101' }, ...x });
  const codes = (s: SaverSpec) => adviseSpec(s).map((w) => `${w.code}@${w.path}`);

  it('a layer held at opacity 0 is not judged; the same layer visible is', () => {
    expect(codes(scene({}, [dot({ key: 'lit' }), dim()]))).toContain('low-contrast-layer@layers[1].sprite');
    expect(codes(scene({}, [dot({ key: 'lit' }), dim({ opacity: 0 })]))).not.toContain('low-contrast-layer@layers[1].sprite');
    expect(codes(scene({ groups: { off: { opacity: 0 } } }, [dot({ key: 'lit' }), dim({ group: 'off' })]))).not.toContain('low-contrast-layer@layers[1].sprite');
  });

  it('a layer the timeline fades in is still judged', () => {
    const s = scene({ timeline: { keys: [{ t: 2000, path: 'dim.opacity', value: 1 }] } }, [dot({ key: 'lit' }), dim({ opacity: 0 })]);
    expect(codes(s)).toContain('low-contrast-layer@layers[1].sprite');
  });

  it('hidden entities do not count toward dense-scene', () => {
    const crowd = (op?: number): LayerSpec => ({ key: 'crowd', count: 400, sprite: { kind: 'circle', radius: [0.002, 0.004], color: '#ffffff' }, motion: { type: 'static' }, ...(op === undefined ? {} : { opacity: op }) });
    const more: LayerSpec = { ...crowd(), key: 'more', count: 200 };
    expect(codes(scene({}, [crowd(), more]))).toContain('dense-scene@layers');
    expect(codes(scene({}, [crowd(0), more]))).not.toContain('dense-scene@layers');
  });
});
