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
import { flattenPath } from './shapes';
import { resolveTimelineAt } from './timeline';
import { MOTION_FIELDS, validateSpec, validateSpecPaths } from './validate';
import type { SaverSpec } from './types';

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
