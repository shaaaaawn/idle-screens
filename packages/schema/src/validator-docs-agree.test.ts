// @vitest-environment happy-dom
/**
 * F128 + F74: the validator, the JSON Schema and FORMAT.md say the same thing.
 * One test per submitted report (X-number), each the report's repro.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import { createRng, type SaverInstance } from '@idle-screens/core';
import jsonSchema from '../saver-spec.schema.json';
import { compileSaver } from './compile';
import { luminanceGrid } from './perceive';
import { transformPoint, transformSize } from './paint';
import { flattenPath, isPathPolygon, pathParts, strokeLines, trimLines, type PolygonSprite } from './shapes';
import { graphemeClusters, revealState, textBlockText } from './simulate';
import { lerpSpec } from './steer';
import { resolveTimelineAt } from './timeline';
import { MOTION_FIELDS, validateSpec, validateSpecPaths } from './validate';
import type { SaverSpec, TextNumber } from './types';

const ajv = new Ajv({ allErrors: true, strict: false });
const checkJson = ajv.compile(jsonSchema);

const scene = (layers: unknown[], extra: Record<string, unknown> = {}): SaverSpec => ({
  schemaVersion: 1, id: 'f128', label: 'F128', background: { type: 'solid', color: '#0a0f1e' }, layers, ...extra,
} as unknown as SaverSpec);

const codes = (spec: SaverSpec): string[] => (validateSpec(structuredClone(spec)).warnings ?? []).map((w) => `${w.path} ${w.code}`);

describe('X615: a list layout takes gap {x?, y?} as documented', () => {
  const list = (gap: unknown): SaverSpec => scene([{
    count: 3, sprite: { kind: 'text', strings: ['one', 'two', 'three'], color: '#ffffff', font: '600 16px sans-serif' },
    layout: { type: 'list', gap }, position: { x: 0.2, y: 0.2 }, motion: { type: 'static' },
  }]);

  it('accepts {y} on a list, in the validator and the JSON Schema', () => {
    const spec = list({ y: 0.08 });
    expect(validateSpec(structuredClone(spec)).errors).toEqual([]);
    expect(checkJson(spec)).toBe(true);
  });
  it('warns that gap.x does nothing on a one-column list', () => {
    expect(codes(list({ x: 0.2, y: 0.08 }))).toContain('layers[0].layout.gap.x no-effect');
    expect(codes(list({ y: 0.08 })).some((c) => c.includes('no-effect'))).toBe(false);
  });
  it('still rejects a non-positive pitch', () => {
    expect(validateSpec(list({ y: 0 })).valid).toBe(false);
    expect(validateSpec(list('wide')).valid).toBe(false);
  });
});

describe('X541 (closed, did not reproduce): links chain needs neither k nor maxDist', () => {
  it('validates a chain with neither', () => {
    const spec = scene([{
      count: 6, sprite: { kind: 'circle', radius: [0.004, 0.004], color: '#ffffff' },
      links: { mode: 'chain', color: '#ffffff', alpha: 0.4, width: 1 }, motion: { type: 'bounce', speed: [0.05, 0.1] },
    }]);
    expect(validateSpec(spec).errors).toEqual([]);
  });
});

describe('X575: bob / sway are min(w,h) amplitudes, and a px-sized one warns', () => {
  const drift = (bob: number, units?: 'px'): SaverSpec => scene([{
    count: 4, sprite: { kind: 'circle', radius: units ? [4, 8] : [0.004, 0.008], color: '#ffffff' },
    motion: { type: 'drift', speed: units ? [20, 40] : [0.02, 0.04], bob },
  }], units ? { units } : {});
  const rise = (sway: number): SaverSpec => scene([{
    count: 4, sprite: { kind: 'circle', radius: [0.004, 0.008], color: '#ffffff' },
    motion: { type: 'rise', speed: [0.01, 0.03], sway },
  }]);

  it('bob: 4 (the report) still validates — stored scenes must recall — but warns motion-amplitude', () => {
    const r = validateSpec(drift(4));
    expect(r.valid).toBe(true);
    const w = (r.warnings ?? []).find((x) => x.code === 'motion-amplitude');
    expect(w?.path).toBe('layers[0].motion.bob');
    expect(w?.message).toMatch(/min\(w, h\) units, not px/);
  });
  it('a typical amplitude is silent', () => {
    expect(codes(drift(0.004)).some((c) => c.includes('motion-amplitude'))).toBe(false);
    expect(codes(rise(0.006)).some((c) => c.includes('motion-amplitude'))).toBe(false);
  });
  it('sway warns the same way', () => {
    expect(codes(rise(12))).toContain('layers[0].motion.sway motion-amplitude');
  });
  it('under units: px the numbers are px: 8 px is fine, 400 px warns', () => {
    expect(codes(drift(8, 'px')).some((c) => c.includes('motion-amplitude'))).toBe(false);
    expect(codes(drift(400, 'px'))).toContain('layers[0].motion.bob motion-amplitude');
  });
});

describe('X588: a colour key a gradient paints over warns', () => {
  const drawing = (keyPath: string, value: unknown): SaverSpec => scene([{
    key: 'ball', count: 1, position: { x: 0.5, y: 0.5 }, motion: { type: 'static' },
    sprite: {
      kind: 'polygon', radius: [0.2, 0.2], color: '#ffffff', parts: [
        { path: 'M -1 0 A 1 1 0 1 1 1 0 A 1 1 0 1 1 -1 0 Z', color: '#334455',
          gradient: { type: 'radial', center: [0, 0], radius: 1, stops: [{ at: 0, color: '#ffeeaa' }, { at: 1, color: '#aa5500' }] } },
        { path: 'M -0.2 -0.2 H 0.2 V 0.2 H -0.2 Z', color: '#112233' },
      ],
    },
  }], { timeline: { keys: [{ t: 1000, path: keyPath, value, dur: 2000 }] } });

  it('warns timeline-key-no-effect on parts.N.color under a gradient', () => {
    expect(codes(drawing('ball.sprite.parts.0.color', '#ff0000'))).toContain('timeline.keys[0].path timeline-key-no-effect');
  });
  it('is silent for a gradient stop and for a flat part', () => {
    expect(codes(drawing('ball.sprite.parts.0.gradient.stops.1.color', '#ff0000')).some((c) => c.includes('no-effect'))).toBe(false);
    expect(codes(drawing('ball.sprite.parts.1.color', '#ff0000')).some((c) => c.includes('no-effect'))).toBe(false);
  });
});

describe('X585: fillRule auto cuts a hole that touches its container\'s edge', () => {
  /** Nonzero winding of the flattened ring at (x, y): what the canvas fills. */
  const winding = (d: string, x: number, y: number): number => {
    const r = flattenPath(d).points;
    let w = 0;
    for (let i = 0; i < r.length; i++) {
      const [ax, ay] = r[i]!, [bx, by] = r[(i + 1) % r.length]!;
      if (ay <= y && by > y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) > 0) w++;
      else if (ay > y && by <= y && (bx - ax) * (y - ay) - (x - ax) * (by - ay) < 0) w--;
    }
    return w;
  };
  const wall = 'M -1 -1 H 1 V 1 H -1 Z';
  // The same notch against each of the four edges: all four must cut.
  const notches: Array<[string, string, [number, number]]> = [
    ['top', 'M -0.3 -1 H 0.3 V -0.4 H -0.3 Z', [0, -0.7]],
    ['bottom', 'M -0.3 0.4 H 0.3 V 1 H -0.3 Z', [0, 0.7]],
    ['left', 'M -1 -0.3 H -0.4 V 0.3 H -1 Z', [-0.7, 0]],
    ['right', 'M 0.4 -0.3 H 1 V 0.3 H 0.4 Z', [0.7, 0]],
  ];
  for (const [edge, notch, [x, y]] of notches) {
    it(`a notch on the ${edge} edge is a hole`, () => {
      const d = `${wall} ${notch}`;
      expect(winding(d, x, y)).toBe(0);
      expect(winding(d, 0, 0)).not.toBe(0);
    });
  }
  it('a mouth whose corners touch a curved face is a hole (flattened curve, vertex on the rim)', () => {
    const face = 'M -1 0 A 1 1 0 1 1 1 0 A 1 1 0 1 1 -1 0 Z';
    const mouth = 'M -1 0 L 0 0.3 L 0 -0.3 Z';
    expect(winding(`${face} ${mouth}`, -0.2, 0)).toBe(0);
    expect(winding(`${face} ${mouth}`, 0.5, 0)).not.toBe(0);
  });
  it('a shape beside the wall, sharing only an edge, stays solid', () => {
    const d = `${wall} M 1 -0.3 H 1.5 V 0.3 H 1 Z`;
    expect(winding(d, 1.25, 0)).not.toBe(0);
    expect(winding(d, 0.9, 0)).not.toBe(0);
  });
});

describe('X583: a keyed path that collapses draws nothing, it does not reject the scene', () => {
  // Same commands open and shut, so the key morphs number by number.
  const OPEN = 'M -0.6 0 C -0.3 -0.5 0.3 -0.5 0.6 0 C 0.3 0.5 -0.3 0.5 -0.6 0 Z';
  const SHUT = 'M -0.6 0 C -0.3 0 0.3 0 0.6 0 C 0.3 0 -0.3 0 -0.6 0 Z';
  const blink = (keyed = true): SaverSpec => scene([
    { key: 'face', count: 1, position: { x: 0.5, y: 0.5 }, motion: { type: 'static' }, sprite: { kind: 'circle', radius: [0.2, 0.2], color: '#e0c080' } },
    { key: 'eye', count: 1, position: { x: 0.5, y: 0.45 }, motion: { type: 'static' }, opacity: 1, sprite: { kind: 'polygon', radius: [0.05, 0.05], color: '#101010', path: keyed ? OPEN : SHUT } },
  ], keyed ? { timeline: { loop: true, duration: 4000, keys: [
    { t: 1000, path: 'eye.sprite.path', value: SHUT, dur: 150 },
    { t: 1400, path: 'eye.sprite.path', value: OPEN, dur: 150 },
  ] } } : {});

  it('the shut eye flattens to nothing (the mechanism)', () => {
    expect(flattenPath(SHUT).points.length).toBeLessThan(3);
  });
  it('a blink validates', () => {
    expect(validateSpec(blink()).errors).toEqual([]);
  });
  it('a collapsed key whose stroke leaves the unit box is still rejected', () => {
    const spec = blink();
    (spec.layers[1] as { sprite: Record<string, unknown> }).sprite.stroke = { color: '#ffffff', width: 0.05 };
    (spec as unknown as { timeline: { keys: { value: string }[] } }).timeline.keys[0]!.value = 'M 0 0 L 10 0 Z';
    const r = validateSpec(spec);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.message.includes('-1..1 unit box'))).toBe(true);
  });
  it('a base path that draws nothing is still an error', () => {
    const r = validateSpec(blink(false));
    expect(r.valid).toBe(false);
    expect(r.errors[0]?.path).toBe('layers[1].sprite.path');
  });
  it('perception reads the shut frame without throwing, and the eye is gone', () => {
    const spec = blink();
    const open = luminanceGrid(spec, { t: 0, cols: 32, rows: 18, viewport: { width: 640, height: 360 } });
    const shut = luminanceGrid(spec, { t: 1250, cols: 32, rows: 18, viewport: { width: 640, height: 360 } });
    expect(JSON.stringify(shut)).not.toContain('null');
    expect(JSON.stringify(shut)).not.toBe(JSON.stringify(open));
  });
  it('a timeline state with the eye shut passes the keyed composed check (what a live steer runs)', () => {
    const at = resolveTimelineAt(blink(), 1250);
    expect(validateSpecPaths(at, ['layers.1.opacity'])).toBe(false);
    expect(validateSpecPaths(at, ['layers.1.opacity'], true)).toBe(true);
  });

  describe('live steer on the blinking layer', () => {
    let alphas: number[] = [];
    let orig: HTMLCanvasElement['getContext'];
    beforeEach(() => {
      orig = HTMLCanvasElement.prototype.getContext;
      const target: Record<string, unknown> = {
        globalAlpha: 1, fillStyle: '', strokeStyle: '', globalCompositeOperation: 'source-over', font: '', lineWidth: 1,
        measureText: (s: string) => ({ width: s.length * 8 }),
        createLinearGradient: () => ({ addColorStop: () => undefined }),
        createRadialGradient: () => ({ addColorStop: () => undefined }),
        createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        fill: () => { alphas.push(+(target.globalAlpha as number).toFixed(3)); },
      };
      const ctx = new Proxy(target, { get: (t, k: string) => (k in t ? t[k] : () => undefined), set: (t, k: string, v) => { t[k] = v; return true; } });
      HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
    });
    afterEach(() => { HTMLCanvasElement.prototype.getContext = orig; });

    it('is accepted although a later timeline state has the eye shut', () => {
      const inst = compileSaver(blink()).mount({ host: document.createElement('div'), dpr: 1, width: 640, height: 360, rng: createRng(1), seed: 1, reducedMotion: true }) as SaverInstance;
      inst.renderFrame!(2000, 1);
      expect(alphas).not.toContain(0.5);
      inst.applyTrack!({ deltas: [{ t: 0, path: 'eye.opacity', value: 0.5, dur: 0 }] } as never);
      alphas = [];
      inst.renderFrame!(2100, 1);
      expect(alphas).toContain(0.5);
    });
  });
});

describe('F74: FORMAT.md\'s motion table is the validator\'s allowlist', () => {
  // happy-dom's import.meta.url is not a file URL: find FORMAT.md from the repo root (or the package).
  const format = readFileSync(['packages/schema/FORMAT.md', 'FORMAT.md'].map((f) => resolve(process.cwd(), f)).find((f) => existsSync(f))!, 'utf8');
  const section = format.slice(format.indexOf('### `motion` (one of)'), format.indexOf('## Scale'));
  const rows = new Map<string, string[]>();
  for (const line of section.split('\n')) {
    const m = /^\| `([a-z]+)` \| ([^|]+) \|/.exec(line);
    if (!m || m[1] === 'type') continue;
    rows.set(m[1]!, [...m[2]!.matchAll(/`([a-zA-Z]+)`/g)].map((x) => x[1]!));
  }

  it('has one row per motion type', () => {
    expect([...rows.keys()].sort()).toEqual(Object.keys(MOTION_FIELDS).sort());
  });
  for (const [type, fields] of Object.entries(MOTION_FIELDS)) {
    it(`lists exactly ${type}'s fields`, () => {
      expect([...(rows.get(type) ?? [])].sort()).toEqual([...fields].sort());
    });
  }
  it('the JSON Schema declares the same fields for each motion type', () => {
    const found = new Map<string, string[]>();
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== 'object') return;
      const o = n as Record<string, unknown>;
      const props = o.properties as Record<string, { const?: unknown }> | undefined;
      const t = props?.type?.const;
      if (typeof t === 'string' && t in MOTION_FIELDS && !found.has(t)) found.set(t, Object.keys(props!).filter((k) => k !== 'type'));
      Object.values(o).forEach(walk);
    };
    walk(jsonSchema);
    for (const [type, fields] of Object.entries(MOTION_FIELDS)) {
      expect([type, [...(found.get(type) ?? [])].sort()]).toEqual([type, [...fields].sort()]);
    }
  });
});

// ---------------------------------------------------------------------------
// Small format adds (feat/format-small-adds): X711, X677, X676, X698, X707.
// ---------------------------------------------------------------------------

/** Lit cells of a grid (luminance off its row's background). */
const litCells = (g: { cols: number; cells: number[]; background: number[] }): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  g.cells.forEach((v, i) => {
    const r = Math.floor(i / g.cols);
    if (Math.abs(v - g.background[r]!) > 0.02) out.push([i % g.cols, r]);
  });
  return out;
};

describe('X711: stroke / fill:false / gradient on a points polygon draws the closed path through its points', () => {
  const STICK: Array<[number, number]> = [[0, 0], [0.3, 0.6], [0, 0], [-0.3, 0.6], [0, 0], [0, -0.6]];
  const figure = (sprite: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): SaverSpec => scene([{
    key: 'b', count: 1, position: { x: 0.5, y: 0.5 }, motion: { type: 'static' }, alpha: [1, 1],
    sprite: { kind: 'polygon', radius: [0.2, 0.2], color: '#282520', points: STICK, fill: false, stroke: { color: '#282520', width: 0.05, opacity: 1 }, ...sprite },
  }], { background: { type: 'solid', color: '#ede6d5' }, ...extra });

  it('the repro validates, in the validator and the JSON Schema', () => {
    const spec = figure();
    expect(validateSpec(structuredClone(spec)).errors).toEqual([]);
    expect(checkJson(spec)).toBe(true);
  });
  it('strokes every limb of the out-and-back tour, closing edge included', () => {
    const sp = figure().layers[0]!.sprite as PolygonSprite;
    expect(isPathPolygon(sp)).toBe(true);
    const lines = strokeLines(pathParts(sp)[0]!);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.closed).toBe(true);
    expect(lines[0]!.points).toEqual(STICK);
    // Each leg twice (out and back) plus the spine out and the closing edge home.
    const len = (pts: Array<[number, number]>): number => pts.reduce((m, p, i) => m + Math.hypot(p[0] - pts[(i + 1) % pts.length]![0], p[1] - pts[(i + 1) % pts.length]![1]), 0);
    expect(len(lines[0]!.points)).toBeCloseTo(4 * Math.hypot(0.3, 0.6) + 1.2, 9);
  });
  it('a plain points polygon (no path paint) stays off the path branch', () => {
    const plain = { kind: 'polygon', radius: [0.2, 0.2], color: '#fff', points: [[-1, 0.9], [0.2, -1], [1, 0.4]] } as unknown as PolygonSprite;
    expect(isPathPolygon(plain)).toBe(false);
    expect(isPathPolygon({ ...plain, fill: true } as PolygonSprite)).toBe(false);
    expect(isPathPolygon({ ...plain, gradient: { type: 'linear', from: [0, -1], to: [0, 1], stops: [{ at: 0, color: '#000' }, { at: 1, color: '#fff' }] } } as PolygonSprite)).toBe(true);
  });
  it('paints ink where the limbs are (perception reads the stroke)', () => {
    const lit = litCells(luminanceGrid(figure(), { t: 0, cols: 32, rows: 32, viewport: { width: 640, height: 640 } }));
    expect(lit.length).toBeGreaterThan(10);
    // The spine runs above the hip and the legs below it.
    expect(lit.some(([, r]) => r < 14)).toBe(true);
    expect(lit.some(([, r]) => r > 18)).toBe(true);
  });
  it('fill: false still needs a stroke, and sides polygons still refuse path paint', () => {
    const noStroke = validateSpec(figure({ stroke: undefined }));
    expect(noStroke.errors.map((e) => e.path)).toContain('layers[0].sprite.fill');
    const sides = validateSpec(scene([{ count: 1, sprite: { kind: 'polygon', radius: [0.1, 0.1], sides: 5, color: '#fff', stroke: { color: '#fff', width: 0.02 } }, motion: { type: 'static' } }]));
    expect(sides.errors.find((e) => e.path === 'layers[0].sprite.stroke')?.message).toMatch(/path, points or parts/);
    const badStroke = validateSpec(figure({ stroke: { color: '#fff', width: 2 } }));
    expect(badStroke.errors.map((e) => e.path)).toContain('layers[0].sprite.stroke.width');
  });
  it('keyed points glide as line art: the resolved frame strokes the lerped joints', () => {
    const raised: Array<[number, number]> = [[0, 0], [0.5, 0.2], [0, 0], [-0.3, 0.6], [0, 0], [0, -0.6]];
    const spec = figure({}, { timeline: { keys: [{ t: 1000, path: 'b.sprite.points', value: raised, dur: 1000, ease: 'linear' }] } });
    expect(validateSpec(structuredClone(spec)).errors).toEqual([]);
    const mid = resolveTimelineAt(spec, 1500).layers[0]!.sprite as PolygonSprite;
    const knee = strokeLines(pathParts(mid)[0]!)[0]!.points[1]!;
    expect(knee[0]).toBeCloseTo(0.4, 9);
    expect(knee[1]).toBeCloseTo(0.4, 9);
  });
});

describe('X677: textBlock.number.minDigits zero-pads the integer part', () => {
  const counter = (number: Record<string, unknown>): SaverSpec => scene([{
    key: 'hud', count: 1, position: { x: 0.1, y: 0.1 }, motion: { type: 'static' },
    sprite: { kind: 'textBlock', text: 'FRAME 0000', font: '500 monospace', fontSize: 0.03, maxWidth: 0.8, number: { value: 0, decimals: 0, prefix: 'FRAME ', grouping: false, minDigits: 4, ...number } },
  }]);
  const text = (n: Record<string, unknown>): string => textBlockText({ text: '', number: { value: 0, ...n } as TextNumber });

  it('the repro validates, in the validator and the JSON Schema', () => {
    const spec = counter({});
    expect(validateSpec(structuredClone(spec)).errors).toEqual([]);
    expect(checkJson(spec)).toBe(true);
  });
  it('FRAME 0000 … FRAME 1080 keep one width', () => {
    const at = [0, 9, 10, 100, 1080].map((value) => text({ value, prefix: 'FRAME ', grouping: false, minDigits: 4 }));
    expect(at).toEqual(['FRAME 0000', 'FRAME 0009', 'FRAME 0010', 'FRAME 0100', 'FRAME 1080']);
  });
  it('pads before grouping (as Intl does), keeps the sign outside, and leaves decimals alone', () => {
    expect(text({ value: 42, minDigits: 4 })).toBe('0,042');
    expect(text({ value: 42, minDigits: 4 })).toBe(new Intl.NumberFormat('en-US', { minimumIntegerDigits: 4, maximumFractionDigits: 0 }).format(42));
    expect(text({ value: -42, minDigits: 4, grouping: false })).toBe('-0042');
    expect(text({ value: 7.5, minDigits: 3, decimals: 2 })).toBe('007.50');
    expect(text({ value: 12345, minDigits: 2, grouping: false })).toBe('12345');
  });
  it('rejects a non-integer or out-of-range minDigits', () => {
    for (const minDigits of [0, 13, 2.5, '4']) {
      const r = validateSpec(counter({ minDigits }));
      expect(r.errors.map((e) => e.path)).toContain('layers[0].sprite.number.minDigits');
      expect(checkJson(counter({ minDigits }))).toBe(false);
    }
  });
});

describe('X676: stroke.draw.mode "each" draws every subpath at once', () => {
  const SPOKES = 'M 0 -0.3 L 0 -1 M 0.3 0 L 1 0 M 0 0.3 L 0 1 M -0.3 0 L -1 0';
  const burst = (mode?: string): SaverSpec => scene([{
    key: 'ticks', count: 1, position: { x: 0.5, y: 0.5 }, motion: { type: 'static' },
    sprite: { kind: 'polygon', radius: [0.3, 0.3], color: '#ffffff', fill: false, path: SPOKES, stroke: { color: '#ffffff', width: 0.02, draw: { start: 0, end: 0, ...(mode ? { mode } : {}) } } },
  }], { timeline: { keys: [{ t: 0, path: 'ticks.sprite.stroke.draw.end', value: 1, dur: 1200, ease: 'linear' }] } });
  const drawnAt = (spec: SaverSpec, t: number): Array<{ points: Array<[number, number]> }> => strokeLines(pathParts(resolveTimelineAt(spec, t).layers[0]!.sprite as PolygonSprite)[0]!);

  it('the repro validates with mode each, in the validator and the JSON Schema', () => {
    const spec = burst('each');
    expect(validateSpec(structuredClone(spec)).errors).toEqual([]);
    expect(checkJson(spec)).toBe(true);
  });
  it('run (the default) sweeps the spokes one after another; each grows all four together', () => {
    // 0.3 of the way: run has spoke 1 and the start of spoke 2; each has 30% of every spoke.
    const run = drawnAt(burst(), 360);
    expect(run).toHaveLength(2); // all of spoke 1 (0.7 of 2.8) and 0.14 of spoke 2
    const each = drawnAt(burst('each'), 360);
    expect(each).toHaveLength(4);
    for (const l of each) {
      const [a, b] = [l.points[0]!, l.points[l.points.length - 1]!];
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(0.7 * 0.3, 9);
    }
  });
  it('the memo tells the modes apart for the same span', () => {
    const lines = flattenPath(SPOKES).lines;
    expect(trimLines(lines, 0, 0.5)).toHaveLength(2);
    expect(trimLines(lines, 0, 0.5, 'each')).toHaveLength(4);
    expect(trimLines(lines, 0, 0.5)).toHaveLength(2);
  });
  it('a closed ring in each mode counts its closing edge, and comes back open when cut', () => {
    const ring = flattenPath('M -1 -1 L 1 -1 L 1 1 L -1 1 Z').lines;
    const half = trimLines(ring, 0, 0.5, 'each');
    expect(half).toHaveLength(1);
    expect(half[0]!.closed).toBe(false);
    expect(half[0]!.points[half[0]!.points.length - 1]).toEqual([1, 1]);
  });
  it('rejects an unknown mode', () => {
    const r = validateSpec(burst('all'));
    expect(r.errors.map((e) => e.path)).toContain('layers[0].sprite.stroke.draw.mode');
    expect(checkJson(burst('all'))).toBe(false);
  });
});

describe('X698: transform.scaleY squashes and stretches vertically', () => {
  const dot = (transform: Record<string, unknown>, keys?: unknown[]): SaverSpec => scene([{
    key: 'd', count: 1, position: { x: 0.5, y: 0.5 }, motion: { type: 'static' }, alpha: [1, 1],
    sprite: { kind: 'circle', radius: [0.2, 0.2], color: '#ffffff' }, transform: { scale: 1, scaleX: 1, scaleY: 1, origin: 'anchor', ...transform },
  }], keys ? { timeline: { keys } } : {});

  it('the repro validates with no unknown-property warning, in the validator and the JSON Schema', () => {
    const spec = dot({}, [{ t: 1000, path: 'd.transform.scaleY', value: 0.6, dur: 300 }]);
    const r = validateSpec(structuredClone(spec));
    expect(r.errors).toEqual([]);
    expect((r.warnings ?? []).some((w) => w.path.includes('scaleY'))).toBe(false);
    expect(checkJson(spec)).toBe(true);
    expect(checkJson(scene([{ count: 1, group: 'g', sprite: { kind: 'circle', radius: [0.1, 0.1], color: '#fff' }, motion: { type: 'static' } }], { groups: { g: { transform: { scaleY: -1 } } } }))).toBe(true);
  });
  it('maps points per axis, and its size factor is the geometric mean of both axes', () => {
    const tf = { scale: 2, scaleX: 1.5, scaleY: 0.5, origin: 'anchor' as const };
    const q = transformPoint(tf, { x: 600, y: 600 }, 1000, 1000, 1000, { x: 500, y: 500 });
    expect(q.x).toBeCloseTo(800, 9);
    expect(q.y).toBeCloseTo(600, 9);
    expect(transformSize(tf)).toBeCloseTo(2 * Math.sqrt(0.75), 12);
  });
  describe('the renderer squashes the disc at t = 1.5 s (the report saw it unchanged)', () => {
    let scales: Array<[number, number]> = [];
    let orig: HTMLCanvasElement['getContext'];
    beforeEach(() => {
      scales = [];
      orig = HTMLCanvasElement.prototype.getContext;
      const target: Record<string, unknown> = {
        globalAlpha: 1, fillStyle: '', strokeStyle: '', globalCompositeOperation: 'source-over', font: '', lineWidth: 1,
        measureText: (str: string) => ({ width: str.length * 8 }),
        createLinearGradient: () => ({ addColorStop: () => undefined }),
        createRadialGradient: () => ({ addColorStop: () => undefined }),
        createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
        getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
        scale: (x: number, y: number) => { scales.push([x, y]); },
      };
      const ctx = new Proxy(target, { get: (t, k: string) => (k in t ? t[k] : () => undefined), set: (t, k: string, v) => { t[k] = v; return true; } });
      HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
    });
    afterEach(() => { HTMLCanvasElement.prototype.getContext = orig; });

    it('scales the layer by (scale·scaleX, scale·scaleY)', () => {
      const spec = dot({}, [{ t: 1000, path: 'd.transform.scaleY', value: 0.6, dur: 300 }]);
      const inst = compileSaver(spec).mount({ host: document.createElement('div'), dpr: 1, width: 800, height: 800, rng: createRng(1), seed: 1, reducedMotion: true }) as SaverInstance;
      inst.renderFrame!(1500, 1);
      expect(scales.some(([x, y]) => x === 1 && Math.abs(y - 0.6) < 1e-9)).toBe(true);
    });
  });
  it('a glide from no transform to scaleY fills the identity, so it does not step', () => {
    const from = scene([{ count: 1, sprite: { kind: 'circle', radius: [0.1, 0.1], color: '#fff' }, motion: { type: 'static' }, transform: { x: 0 } }]);
    const to = scene([{ count: 1, sprite: { kind: 'circle', radius: [0.1, 0.1], color: '#fff' }, motion: { type: 'static' }, transform: { x: 0, scaleY: 0.5 } }]);
    expect((lerpSpec(from, to, 0.5).layers[0]!.transform as { scaleY: number }).scaleY).toBeCloseTo(0.75, 12);
  });
});

describe('X707: glyphFade and line reveals follow the documented progress mapping', () => {
  const lines = [{ text: 'Asia · 4.7 bn', widthEm: 6 }, { text: 'Africa · 1.5 bn', widthEm: 7 }, { text: 'Europe · 0.7 bn', widthEm: 7 }];
  const N = lines.reduce((n, l) => n + graphemeClusters(l.text).length, 0);
  const f = 0.25;
  const alpha = (p: number, li: number, g: number): number => revealState(lines, { progress: p, mode: 'glyphFade', fade: f }, 0).glyphAlphas![li]![g]!;

  it('N counts graphemes of the broken lines, without line breaks', () => {
    expect(N).toBe(13 + 15 + 15);
  });
  it('glyph g is fully shown exactly at f + (g/N)(1 − f), and not before', () => {
    const n1 = graphemeClusters(lines[0]!.text).length;
    for (const [li, gi, g] of [[0, 0, 0], [0, n1 - 1, n1 - 1], [1, 3, n1 + 3], [2, 14, N - 1]] as const) {
      const full = f + (g / N) * (1 - f);
      expect(alpha(full, li, gi)).toBeCloseTo(1, 9);
      expect(alpha(full - 0.01, li, gi)).toBeLessThan(1);
      expect(alpha((g / N) * (1 - f), li, gi)).toBeCloseTo(0, 9);
    }
    // The report keyed 0.33 (= 13/43 + newline) for line 1 and saw only its first glyphs.
    expect(alpha(0.33, 0, n1 - 1)).toBeLessThan(1);
    expect(alpha(f + ((n1 - 1) / N) * (1 - f), 0, n1 - 1)).toBeCloseTo(1, 9);
  });
  it("mode 'line' shows round(progress · L) lines: line k appears at (k − ½)/L", () => {
    const shown = (p: number): number => revealState(lines, { progress: p, mode: 'line' }, 0).fullLines;
    const L = lines.length;
    for (let k = 1; k <= L; k++) {
      expect(shown((k - 0.5) / L)).toBe(k);
      expect(shown((k - 0.5) / L - 0.001)).toBe(k - 1);
      expect(shown(k / L)).toBe(k);
    }
  });
});
