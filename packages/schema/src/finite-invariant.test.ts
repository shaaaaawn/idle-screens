// @vitest-environment happy-dom
import { expect, it, afterEach } from 'vitest';
import { createRng, type SaverInstance } from '@idle-screens/core';
import { compileSaver } from './compile';
import { buildEntities, positionAt, sizeAt, alphaAt } from './simulate';
import { EXAMPLE_SPECS } from './examples/index';
import type { SaverSpec } from './types';

// Guards the analytic invariant end-to-end: every bundled example must produce
// finite positions/sizes/alphas at every sampled time — a NaN here becomes a
// crashed canvas call (e.g. createRadialGradient throws on non-finite input).
function assertFiniteExamples(W: number, H: number, dt: number): void {
  for (const spec of EXAMPLE_SPECS) {
    const rng = createRng((spec.seed ?? 42) >>> 0 || 1);
    const scale = spec.units === 'px' ? 1 : Math.min(W, H);
    for (const [li, layer] of spec.layers.entries()) {
      const ents = buildEntities(layer as never, rng, W, H, scale, 1);
      for (const [ei, e] of ents.entries()) {
        for (let t = 0; t <= 120000; t += dt) {
          const p = positionAt(e, t, W, H);
          const s = sizeAt(e, t);
          const a = alphaAt(e, t);
          if (![p.x, p.y, s, a].every(Number.isFinite)) {
            throw new Error(`${W}x${H} ${spec.id} layer ${li} (${(layer as {key?:string}).key}) entity ${ei} t=${t}: x=${p.x} y=${p.y} size=${s} alpha=${a} entity=${JSON.stringify(e)}`);
          }
        }
      }
    }
  }
}

it('no example ever produces a non-finite position/size/alpha', () => {
  assertFiniteExamples(1920, 1080, 313);
});

// A canvas mounted hidden, collapsed or before layout is 0 wide and/or high
// until its first resize. Sampled coarsely: these fail at t = 0 when they fail.
it('no example produces a non-finite position/size/alpha at a zero-area viewport', () => {
  for (const [W, H] of [[0, 0], [0, 1080], [1920, 0]] as const) assertFiniteExamples(W, H, 7919);
});

// The prod `ballet` channel threw `createRadialGradient … non-finite` on every
// frame, args (NaN, 0, 0, NaN, 0, 0.1): its soft drift layers in a viewer whose
// canvas was 0×0. A wrapped mover's wrap range is w + 2·size, and at width 0
// the size is 0 too, so `% 0` made x NaN.
let origGetContext: HTMLCanvasElement['getContext'] | undefined;
afterEach(() => { if (origGetContext) HTMLCanvasElement.prototype.getContext = origGetContext; });

it('a soft wrapped mover renders at a zero-area viewport without a non-finite gradient', () => {
  const finite = (name: string) => (...a: number[]) => {
    // Chrome throws a TypeError here; the mock does the same so the frame fails as prod did.
    if (!a.every(Number.isFinite)) throw new TypeError(`${name}(${a.join(', ')}): non-finite`);
    return { addColorStop: () => undefined };
  };
  const ctx = new Proxy({ createRadialGradient: finite('createRadialGradient'), createLinearGradient: finite('createLinearGradient'),
    measureText: (s: string) => ({ width: s.length * 8 }), globalAlpha: 1 } as Record<string | symbol, unknown>, {
    get: (o, k) => (k in o ? o[k] : () => undefined),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
  const spec: SaverSpec = {
    schemaVersion: 1, id: 'zero-viewport', label: 'Zero viewport', seed: 2030, background: { type: 'solid', color: '#000000' },
    layers: [
      { key: 'mist', count: 6, sprite: { kind: 'circle', radius: [0.015, 0.03], color: '#e8a0bf', soft: true }, alpha: [0.04, 0.12], blend: 'lighter',
        motion: { type: 'drift', speed: [0.002, 0.006], bidirectional: true } },
      { key: 'motes', count: 6, sprite: { kind: 'circle', radius: [0.004, 0.01], color: '#ffd9a0', soft: true }, motion: { type: 'rise', speed: [0.01, 0.03] } },
    ],
  };
  for (const [width, height] of [[0, 0], [0, 1080], [1920, 0]] as const) {
    const inst = compileSaver(spec).mount({ host: document.createElement('div'), dpr: 2, width, height, rng: createRng(2030), seed: 2030, reducedMotion: false }) as SaverInstance;
    expect(() => { for (let i = 0; i < 4; i++) inst.renderFrame!(7.85e9 + i * 16.7, 2030); }, `${width}x${height}`).not.toThrow();
    inst.dispose();
  }
});
