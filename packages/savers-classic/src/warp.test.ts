// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRng, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { warp, warpManifest, warpDemoTrack } from './warp';

/* happy-dom has no Canvas2D — stub just enough for warp to draw into. */
function stubContext2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return {
    canvas,
    fillRect: () => {},
    clearRect: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    setTransform: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

const W = 1280;
const H = 800;

function ctx(overrides: Partial<SaverContext> = {}): SaverContext {
  return {
    host: document.createElement('div'),
    dpr: 1,
    width: W,
    height: H,
    rng: createRng(11),
    seed: 11,
    reducedMotion: true, // no rAF loop — we drive renderFrame() ourselves
    ...overrides,
  };
}

type Frameable = SaverInstance & { renderFrame(t: number, seed: number): void };
const mount = (c: SaverContext): Frameable => warp.mount(c) as Frameable;

describe('warp', () => {
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

  describe('manifest sanity', () => {
    it('has the stable id, worker-readiness, and a typed paramSpace', () => {
      expect(warpManifest.id).toBe('warp');
      expect(warpManifest.workerReady).toBe(true);
      expect(warpManifest.minBackend).toBe('canvas2d');
      expect(warpManifest.a11y?.flashSafe).toBe(true);
      expect(warpManifest.paramSpace).toBeDefined();
    });

    it('paramSpace declares density, speed, tint, streak, twinkle', () => {
      const space = warpManifest.paramSpace!;
      expect(Object.keys(space).sort()).toEqual(
        ['density', 'speed', 'streak', 'tint', 'twinkle'].sort(),
      );
      expect(space.tint!.type).toBe('color');
      expect(space.speed!.type).toBe('number');
      expect(space.streak!.type).toBe('number');
      expect(space.twinkle!.type).toBe('number');
      expect(space.density!.type).toBe('number');
    });

    it('defaults fall within each param\'s declared min/max', () => {
      const space = warpManifest.paramSpace!;
      for (const [key, def] of Object.entries(space)) {
        if (typeof def.default === 'number') {
          if (def.min !== undefined) expect(def.default, `${key} default >= min`).toBeGreaterThanOrEqual(def.min);
          if (def.max !== undefined) expect(def.default, `${key} default <= max`).toBeLessThanOrEqual(def.max);
        }
      }
      expect(space.speed!.default).toBe(1);
      expect(space.tint!.default).toBe('#ffffff');
    });
  });

  describe('demo track', () => {
    it('steers speed, streak, and tint over a ~14s loop', () => {
      expect(warpDemoTrack.program).toBe('warp');
      expect(warpDemoTrack.loop).toBe(true);
      expect(warpDemoTrack.duration).toBe(14000);
      const paths = new Set(warpDemoTrack.deltas.map((d) => d.path));
      expect(paths.has('speed')).toBe(true);
      expect(paths.has('streak')).toBe(true);
      expect(paths.has('tint')).toBe(true);
    });

    it('every delta path exists in the manifest paramSpace', () => {
      const space = warpManifest.paramSpace!;
      for (const d of warpDemoTrack.deltas) {
        expect(Object.keys(space), `delta path "${d.path}" is a real param`).toContain(d.path);
      }
    });
  });

  describe('renderFrame', () => {
    it('rendering the same t twice does not throw', () => {
      const inst = mount(ctx());
      expect(() => inst.renderFrame(2500, 11)).not.toThrow();
      expect(() => inst.renderFrame(2500, 11)).not.toThrow();
      inst.dispose();
    });

    it('seeking backward (5000 -> 1000 -> 5000) does not throw', () => {
      const inst = mount(ctx());
      expect(() => inst.renderFrame(5000, 11)).not.toThrow();
      expect(() => inst.renderFrame(1000, 11)).not.toThrow();
      expect(() => inst.renderFrame(5000, 11)).not.toThrow();
      inst.dispose();
    });

    it('applying the demo track and rendering across the loop does not throw', () => {
      const inst = mount(ctx());
      inst.applyTrack?.(warpDemoTrack);
      for (let t = 0; t < 20_000; t += 1000) {
        expect(() => inst.renderFrame(t, warpDemoTrack.seed)).not.toThrow();
      }
      inst.dispose();
    });
  });

  describe('lifecycle', () => {
    it('mounts, pauses, resizes, and disposes without throwing', () => {
      const inst = mount(ctx({ reducedMotion: false }));
      expect(() => inst.setPaused(true)).not.toThrow();
      expect(() => inst.resize(640, 480)).not.toThrow();
      expect(() => inst.setPaused(false)).not.toThrow();
      expect(() => inst.dispose()).not.toThrow();
    });
  });
});
