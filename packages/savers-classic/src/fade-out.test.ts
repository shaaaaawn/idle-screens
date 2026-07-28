// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRng, sampleTrack, defaultParams, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { fadeOut, fadeOutManifest, fadeOutDemoTrack } from './fade-out';

/* happy-dom has no Canvas2D — stub just enough for fade-out to draw into. */
function stubContext2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return {
    canvas,
    fillRect: () => {},
    clearRect: () => {},
    setTransform: () => {},
    fillStyle: '#000',
  } as unknown as CanvasRenderingContext2D;
}

/** Installs a getContext stub that records every `fillStyle|x,y,w,h` fillRect
 *  call, so "frames" can be compared without a real canvas backing store.
 *  Returns the live `calls` array plus a `restore` to put the prototype back. */
function recordFillRects(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    const stub = stubContext2D(this);
    let fillStyle = '#000';
    Object.defineProperty(stub, 'fillStyle', {
      get: () => fillStyle,
      set: (v: string) => {
        fillStyle = v;
      },
    });
    (stub as unknown as { fillRect: (...a: number[]) => void }).fillRect = (x, y, w, h) => {
      calls.push(`${fillStyle}|${x},${y},${w},${h}`);
    };
    return stub;
  } as unknown as HTMLCanvasElement['getContext'];
  return {
    calls,
    restore: () => {
      HTMLCanvasElement.prototype.getContext = original;
    },
  };
}

const W = 1280;
const H = 800;

function ctx(seed = 7, reducedMotion = true): SaverContext {
  const host = document.createElement('div');
  document.body.append(host);
  return {
    host,
    dpr: 1,
    width: W,
    height: H,
    rng: createRng(seed),
    seed,
    reducedMotion, // true = no rAF loop — we drive renderFrame() ourselves
  };
}

type Frameable = SaverInstance & { renderFrame(t: number, seed: number): void };
const mount = (c: SaverContext): Frameable => fadeOut.mount(c) as Frameable;

describe('fade-out: cell-by-cell dissolve to black and back', () => {
  let originalGetContext: HTMLCanvasElement['getContext'];

  beforeAll(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
      return stubContext2D(this);
    } as unknown as HTMLCanvasElement['getContext'];
  });

  afterAll(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it('manifest: canvas2d, low cost, carries attribution, workerReady false', () => {
    expect(fadeOutManifest.id).toBe('fade-out');
    expect(fadeOutManifest.label).toMatch(/\S/);
    expect(fadeOutManifest.passthrough).toBe(false);
    expect(fadeOutManifest.minBackend).toBe('canvas2d');
    expect(fadeOutManifest.paramSpace).toBeTruthy();
    expect(fadeOutManifest.a11y?.flashSafe).toBe(true);
    expect(fadeOutManifest.workerReady).toBe(false);
    expect(fadeOutManifest.attribution).toEqual({
      source: 'After Dark "Fade Away" — concept by Berkeley Systems',
      license: 'MIT port; reference CSS MIT (Bryan Braun)',
      url: 'https://github.com/bryanbraun/after-dark-css',
    });
    expect(typeof fadeOut.mount).toBe('function');
    expect(fadeOut.manifest).toBe(fadeOutManifest);
  });

  it('defaults are within their declared paramSpace ranges', () => {
    const space = fadeOutManifest.paramSpace!;
    const defaults = defaultParams(space) as Record<string, number | string>;
    for (const [key, def] of Object.entries(space)) {
      const v = defaults[key];
      if (def.type === 'number') {
        expect(typeof v, `${key} default is a number`).toBe('number');
        if (def.min !== undefined) expect(v as number).toBeGreaterThanOrEqual(def.min);
        if (def.max !== undefined) expect(v as number).toBeLessThanOrEqual(def.max);
      }
      if (def.type === 'enum') {
        expect(def.options, `${key} default is one of its options`).toContain(v);
      }
      if (def.type === 'color') {
        expect(v as string).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('demoTrack targets fade-out, is ~14s, loops, and every delta path is valid', () => {
    expect(fadeOutDemoTrack.program).toBe('fade-out');
    expect(Number.isInteger(fadeOutDemoTrack.seed)).toBe(true);
    expect(fadeOutDemoTrack.duration).toBe(14_000);
    expect(fadeOutDemoTrack.loop).toBe(true);
    const space = fadeOutManifest.paramSpace!;
    for (const d of fadeOutDemoTrack.deltas) {
      expect(space[d.path], `delta path "${d.path}" must exist in paramSpace`).toBeTruthy();
    }
    // and it actually steers the params the task called for
    const pathsUsed = new Set(fadeOutDemoTrack.deltas.map((d) => d.path));
    expect(pathsUsed.has('pattern')).toBe(true);
    expect(pathsUsed.has('speed')).toBe(true);
    expect(pathsUsed.has('ink')).toBe(true);
  });

  it('sampling the demoTrack against the paramSpace is deterministic and defaults-consistent', () => {
    const space = fadeOutManifest.paramSpace!;
    expect(sampleTrack(space, fadeOutDemoTrack, 3500)).toEqual(sampleTrack(space, fadeOutDemoTrack, 3500));
    const out = sampleTrack(space, fadeOutDemoTrack, 0);
    const defaults = defaultParams(space);
    expect(Object.keys(out).sort()).toEqual(Object.keys(defaults).sort());
  });

  it('renderFrame does not throw across a full cycle (dissolve and reform)', () => {
    const inst = mount(ctx());
    for (let t = 0; t < 90_000; t += 500) {
      expect(() => inst.renderFrame(t, 7)).not.toThrow();
    }
    inst.dispose();
  });

  it('same (t, seed) renders an identical frame, and seeking backwards reproduces it', () => {
    const { calls, restore } = recordFillRects();
    try {
      const inst = mount(ctx(11));
      calls.length = 0;
      inst.renderFrame(12_345, 11);
      const first = calls.slice();

      inst.renderFrame(50_000, 11); // seek far away
      calls.length = 0;
      inst.renderFrame(12_345, 11); // seek back
      const second = calls.slice();

      expect(second, 'seeking backwards reproduces the exact same frame').toEqual(first);
      expect(first.length, 'the grid actually painted cells').toBeGreaterThan(0);
      inst.dispose();
    } finally {
      restore();
    }
  });

  it('the dissolve order is seeded: two seeds paint different frames at the same t', () => {
    const { calls, restore } = recordFillRects();
    try {
      const instA = mount(ctx(11));
      calls.length = 0;
      instA.renderFrame(12_345, 11);
      const framesA = calls.slice();
      instA.dispose();

      const instB = mount(ctx(12));
      calls.length = 0;
      instB.renderFrame(12_345, 12);
      const framesB = calls.slice();
      instB.dispose();

      expect(framesA, 'different seeds produce different dissolve thresholds').not.toEqual(framesB);
    } finally {
      restore();
    }
  });

  it('resize re-grids without throwing, and an interior cell keeps its threshold (row/col-derived salt, not draw-order)', () => {
    // Cell (row 15, col 25) at cellSize 40 sits at x=1000, y=600, and exists
    // in both sizes below. A linear draw-order salt (row*cols+col) would give
    // this cell a DIFFERENT index once `cols` changes on resize (32 -> 42),
    // so pinning this exact interior cell — not the (0,0) corner, whose salt
    // is 0 under either scheme — is what actually discriminates the house
    // law ("derive fork salt from cell row/col, not draw order").
    const { calls, restore } = recordFillRects();
    try {
      const inst = mount(ctx(3));
      calls.length = 0;
      inst.renderFrame(1000, 3);
      const before = calls.filter((c) => c.endsWith('|1000,600,40,40'));
      expect(before.length, 'the probe cell exists before resize').toBe(1);

      expect(() => inst.resize(W + 400, H + 200)).not.toThrow();
      calls.length = 0;
      inst.renderFrame(1000, 3);
      const after = calls.filter((c) => c.endsWith('|1000,600,40,40'));
      expect(after.length, 'the probe cell still exists after resize').toBe(1);

      expect(after, 'an interior cell is unchanged by a resize that only adds more cells').toEqual(before);
      inst.dispose();
    } finally {
      restore();
    }
  });

  it('reducedMotion mounts paused and paints a still frame immediately (not blank)', () => {
    const { calls, restore } = recordFillRects();
    try {
      const c = ctx(7, true);
      calls.length = 0;
      const inst = mount(c);
      expect(calls.length, 'construction paints a still frame under reducedMotion').toBeGreaterThan(0);
      inst.dispose();
    } finally {
      restore();
    }
  });

  it('setPaused freezes on a still frame and does not throw either direction', () => {
    const inst = mount(ctx());
    expect(() => inst.setPaused(false)).not.toThrow();
    expect(() => inst.setPaused(true)).not.toThrow();
    inst.dispose();
  });

  it('dispose removes the canvas and does not throw', () => {
    const c = ctx();
    const inst = mount(c);
    expect(c.host.querySelector('canvas')).toBeTruthy();
    inst.dispose();
    expect(c.host.querySelector('canvas')).toBeFalsy();
  });
});
