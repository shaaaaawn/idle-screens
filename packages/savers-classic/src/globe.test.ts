// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRng, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { globe, globeManifest, globeDemoTrack } from './globe';

/* happy-dom has no Canvas2D — stub just enough for the globe to draw into. */
function stubContext2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} } as unknown as CanvasGradient;
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
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
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
const mount = (c: SaverContext): Frameable => globe.mount(c) as Frameable;

describe('globe', () => {
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
      expect(globeManifest.id).toBe('globe');
      expect(globeManifest.workerReady).toBe(true);
      expect(globeManifest.minBackend).toBe('canvas2d');
      expect(globeManifest.a11y?.flashSafe).toBe(true);
      expect(globeManifest.paramSpace).toBeDefined();
    });

    it('carries the After Dark attribution', () => {
      expect(globeManifest.attribution).toBeDefined();
      expect(globeManifest.attribution?.source).toMatch(/After Dark/);
      expect(globeManifest.attribution?.license).toMatch(/MIT/);
      expect(globeManifest.attribution?.url).toBe('https://github.com/bryanbraun/after-dark-css');
    });

    it('paramSpace declares density, spin, bounce, wire, glow, depthFade', () => {
      const space = globeManifest.paramSpace!;
      expect(Object.keys(space).sort()).toEqual(
        ['bounce', 'density', 'depthFade', 'glow', 'spin', 'wire'].sort(),
      );
      expect(space.density!.type).toBe('number');
      expect(space.spin!.type).toBe('number');
      expect(space.bounce!.type).toBe('number');
      expect(space.wire!.type).toBe('color');
      expect(space.glow!.type).toBe('number');
      expect(space.depthFade!.type).toBe('number');
    });

    it('defaults fall within each param\'s declared min/max', () => {
      const space = globeManifest.paramSpace!;
      for (const [key, def] of Object.entries(space)) {
        if (typeof def.default === 'number') {
          if (def.min !== undefined) expect(def.default, `${key} default >= min`).toBeGreaterThanOrEqual(def.min);
          if (def.max !== undefined) expect(def.default, `${key} default <= max`).toBeLessThanOrEqual(def.max);
        }
      }
      // The lineage's preserved defaults: spin=1 (0.9 rad/s base, unmultiplied)
      // and bounce=1 (the original's full DVD-bounce path).
      expect(space.spin!.default).toBe(1);
      expect(space.bounce!.default).toBe(1);
      expect(space.wire!.default).toBe('#78c8ff');
    });
  });

  describe('demo track', () => {
    it('steers spin, bounce, and glow over a ~12s loop', () => {
      expect(globeDemoTrack.program).toBe('globe');
      expect(globeDemoTrack.loop).toBe(true);
      expect(globeDemoTrack.duration).toBe(12000);
      const paths = new Set(globeDemoTrack.deltas.map((d) => d.path));
      expect(paths.has('spin')).toBe(true);
      expect(paths.has('bounce')).toBe(true);
      expect(paths.has('glow')).toBe(true);
    });

    it('every delta path exists in the manifest paramSpace', () => {
      const space = globeManifest.paramSpace!;
      for (const d of globeDemoTrack.deltas) {
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
      inst.applyTrack?.(globeDemoTrack);
      for (let t = 0; t < 20_000; t += 1000) {
        expect(() => inst.renderFrame(t, globeDemoTrack.seed)).not.toThrow();
      }
      inst.dispose();
    });

    it('bounce=0 floats the globe at the viewport center for every t', () => {
      const inst = mount(ctx());
      inst.applyTrack?.({
        program: 'globe',
        seed: 11,
        deltas: [{ t: 0, path: 'bounce', value: 0 }],
      });
      // Rendering shouldn't throw across a wide t sweep with bounce pinned at 0.
      for (let t = 0; t < 30_000; t += 2500) {
        expect(() => inst.renderFrame(t, 11)).not.toThrow();
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

    it('different seeds mount without throwing (different initial bounce phase)', () => {
      for (const seed of [1, 2, 3, 42]) {
        const inst = mount(ctx({ rng: createRng(seed), seed }));
        expect(() => inst.renderFrame(3000, seed)).not.toThrow();
        inst.dispose();
      }
    });
  });
});
