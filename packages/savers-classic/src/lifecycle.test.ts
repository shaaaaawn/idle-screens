// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { createRng } from '@idle-screens/core';
import type { SaverContext, SaverInstance } from '@idle-screens/core';
import { CLASSIC_SAVERS } from './index';

/* -------------------------------------------------------------------------- */
/*  Stub HTMLCanvasElement.getContext                                          */
/*                                                                            */
/*  happy-dom does not implement Canvas2D. We patch getContext to return a     */
/*  no-op stub so canvas-based savers can mount without error.                */
/* -------------------------------------------------------------------------- */

/** Minimal stub that satisfies every canvas-2d method the classic savers call. */
function stubContext2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const gradient = {
    addColorStop: () => {},
  } as unknown as CanvasGradient;

  return {
    canvas,
    // drawing
    fillRect: () => {},
    clearRect: () => {},
    strokeRect: () => {},
    // path
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    // transforms
    setTransform: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    // images
    drawImage: () => {},
    putImageData: () => {},
    createImageData: (_w: number, h?: number) => {
      const w = typeof _w === 'number' ? _w : 1;
      const hh = typeof h === 'number' ? h : 1;
      return { width: w, height: hh, data: new Uint8ClampedArray(w * hh * 4) };
    },
    getImageData: (x: number, y: number, w: number, h: number) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    }),
    // gradients
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    // text
    fillText: () => {},
    strokeText: () => {},
    measureText: () => ({ width: 0 }),
    // misc properties the savers assign
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    shadowColor: 'rgba(0,0,0,0)',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  } as unknown as CanvasRenderingContext2D;
}

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
let originalOffscreenGetContext: typeof OffscreenCanvas.prototype.getContext | undefined;

beforeAll(() => {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, _opts?: any) {
    if (id === '2d') return stubContext2D(this);
    // WebGPU / WebGL — return null so GPU savers fall through to their CPU path
    return null;
  } as typeof HTMLCanvasElement.prototype.getContext;

  // OffscreenCanvas is available in happy-dom; fluid and reaction-diffusion
  // create off-screen buffer canvases via `new OffscreenCanvas(w, h)`.
  if (typeof OffscreenCanvas !== 'undefined') {
    originalOffscreenGetContext = OffscreenCanvas.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    OffscreenCanvas.prototype.getContext = function (this: OffscreenCanvas, id: string, _opts?: any) {
      if (id === '2d') return stubContext2D(this as unknown as HTMLCanvasElement);
      return null;
    } as typeof OffscreenCanvas.prototype.getContext;
  }
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  if (typeof OffscreenCanvas !== 'undefined' && originalOffscreenGetContext) {
    OffscreenCanvas.prototype.getContext = originalOffscreenGetContext;
  }
});

/* -------------------------------------------------------------------------- */
/*  SaverContext factory                                                       */
/* -------------------------------------------------------------------------- */

/** Build a fresh SaverContext for each test, including `page` for passthrough savers. */
function makeCtx(passthrough: boolean): SaverContext {
  return {
    host: document.createElement('div'),
    dpr: 1,
    width: 640,
    height: 400,
    rng: createRng(42),
    seed: 42,
    reducedMotion: false,
    ...(passthrough
      ? {
          page: {
            palette: () => [],
            victims: () => [],
          },
        }
      : {}),
  };
}

/* -------------------------------------------------------------------------- */
/*  Lifecycle smoke tests for every classic saver                             */
/* -------------------------------------------------------------------------- */

describe.each(CLASSIC_SAVERS.map((s) => ({ id: s.manifest.id, saver: s })))(
  'lifecycle: $id',
  ({ saver }) => {
    let instance: SaverInstance | undefined;
    let host: HTMLElement;

    afterEach(() => {
      // Ensure dispose runs even if a test assertion fails mid-way.
      try {
        instance?.dispose();
      } catch {
        // already disposed or never mounted
      }
      instance = undefined;
    });

    it('mount returns a SaverInstance with required methods', async () => {
      const ctx = makeCtx(!!saver.manifest.passthrough);
      host = ctx.host;
      instance = await Promise.resolve(saver.mount(ctx));

      expect(instance).toBeDefined();
      expect(typeof instance.setPaused).toBe('function');
      expect(typeof instance.resize).toBe('function');
      expect(typeof instance.dispose).toBe('function');
    });

    it('setPaused(true) and setPaused(false) do not throw', async () => {
      const ctx = makeCtx(!!saver.manifest.passthrough);
      host = ctx.host;
      instance = await Promise.resolve(saver.mount(ctx));

      expect(() => instance!.setPaused(true)).not.toThrow();
      expect(() => instance!.setPaused(false)).not.toThrow();
    });

    it('resize(800, 600) does not throw', async () => {
      const ctx = makeCtx(!!saver.manifest.passthrough);
      host = ctx.host;
      instance = await Promise.resolve(saver.mount(ctx));

      expect(() => instance!.resize(800, 600)).not.toThrow();
    });

    it('dispose does not throw and cleans up host children', async () => {
      const ctx = makeCtx(!!saver.manifest.passthrough);
      host = ctx.host;
      instance = await Promise.resolve(saver.mount(ctx));

      expect(() => instance!.dispose()).not.toThrow();
      // After dispose, the host should have no children (or at least no error).
      expect(host.children.length).toBe(0);
      // Mark as disposed so afterEach does not double-dispose.
      instance = undefined;
    });

    it('full lifecycle: mount -> pause -> resize -> unpause -> dispose', async () => {
      const ctx = makeCtx(!!saver.manifest.passthrough);
      host = ctx.host;
      instance = await Promise.resolve(saver.mount(ctx));

      instance.setPaused(true);
      instance.resize(800, 600);
      instance.setPaused(false);
      instance.dispose();
      expect(host.children.length).toBe(0);
      instance = undefined;
    });
  },
);
