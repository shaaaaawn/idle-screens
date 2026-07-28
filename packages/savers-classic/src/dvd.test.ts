// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRng, type SaverContext, type SaverInstance } from '@idle-screens/core';
import { dvd, dvdManifest, dvdDemoTrack } from './dvd';

/* happy-dom has no Canvas2D — stub just enough for the mark to draw into,
 * logging every draw call so two renders at the same `t` can be compared. */
function stubContext2D(canvas: HTMLCanvasElement, log: unknown[]): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} } as unknown as CanvasGradient;
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      log.push([name, ...args]);
    };
  return {
    canvas,
    fillRect: rec('fillRect'),
    clearRect: rec('clearRect'),
    beginPath: rec('beginPath'),
    closePath: rec('closePath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    quadraticCurveTo: rec('quadraticCurveTo'),
    arc: rec('arc'),
    ellipse: rec('ellipse'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    fillText: rec('fillText'),
    strokeText: rec('strokeText'),
    measureText: () => ({ width: 0 }),
    setTransform: () => {},
    save: () => {},
    restore: () => {},
    translate: rec('translate'),
    rotate: rec('rotate'),
    transform: rec('transform'),
    scale: () => {},
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px monospace',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    shadowColor: 'rgba(0,0,0,0)',
    shadowBlur: 0,
  } as unknown as CanvasRenderingContext2D;
}

function makeCtx(overrides: Partial<SaverContext> = {}): { host: HTMLElement; ctx: SaverContext } {
  const host = document.createElement('div');
  const ctx: SaverContext = {
    host,
    dpr: 1,
    width: 1280,
    height: 800,
    rng: createRng(7),
    seed: 7,
    reducedMotion: true, // no rAF loop — we drive renderFrame() ourselves
    ...overrides,
  };
  return { host, ctx };
}

type Frameable = SaverInstance & { renderFrame(t: number, seed: number): void };
const mount = (ctx: SaverContext): Frameable => dvd.mount(ctx) as Frameable;

describe('dvd (consolidated bouncing-logo saver)', () => {
  it('manifest shape: id/passthrough/paramSpace', () => {
    expect(dvdManifest.id).toBe('dvd');
    expect(dvdManifest.label).toMatch(/\S/);
    expect(dvdManifest.passthrough).toBe(false);
    expect(dvdManifest.paramSpace).toBeDefined();
    expect(Object.keys(dvdManifest.paramSpace ?? {}).length).toBeGreaterThan(0);
    expect(dvdManifest.minBackend).toBe('canvas2d');
    expect(dvdManifest.workerReady).toBe(true);
    expect(dvdManifest.a11y?.flashSafe).toBe(true);
  });

  it('demo track: every delta path exists in paramSpace', () => {
    const space = dvdManifest.paramSpace ?? {};
    expect(dvdDemoTrack.program).toBe('dvd');
    expect(dvdDemoTrack.deltas.length).toBeGreaterThan(0);
    for (const d of dvdDemoTrack.deltas) {
      expect(Object.keys(space), `delta path "${d.path}" is a known param`).toContain(d.path);
    }
  });

  it('param defaults sit within their declared min/max (or options)', () => {
    const space = dvdManifest.paramSpace ?? {};
    for (const [key, def] of Object.entries(space)) {
      if (def.type === 'number') {
        if (def.min !== undefined) expect(def.default as number, key).toBeGreaterThanOrEqual(def.min);
        if (def.max !== undefined) expect(def.default as number, key).toBeLessThanOrEqual(def.max);
      } else if (def.type === 'enum') {
        expect(def.options ?? [], key).toContain(def.default);
      }
    }
  });

  describe('renderFrame determinism', () => {
    let originalGetContext: HTMLCanvasElement['getContext'];
    let log: unknown[] = [];

    beforeAll(() => {
      originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
        return stubContext2D(this, log);
      } as unknown as HTMLCanvasElement['getContext'];
    });

    afterAll(() => {
      HTMLCanvasElement.prototype.getContext = originalGetContext;
    });

    it('rendering the same t twice does not throw and produces identical draw calls', () => {
      const { host, ctx } = makeCtx();
      const inst = mount(ctx);

      log = [];
      expect(() => inst.renderFrame(5000, 7)).not.toThrow();
      const first = JSON.stringify(log);
      expect(first.length).toBeGreaterThan(0);

      log = [];
      expect(() => inst.renderFrame(5000, 7)).not.toThrow();
      const second = JSON.stringify(log);

      expect(second, 're-rendering the same (t, seed) reproduces the frame exactly').toBe(first);

      inst.dispose();
      host.remove();
    });

    it('is stable across a seek-away-and-back, and across every mark', () => {
      const { host, ctx } = makeCtx();
      const inst = mount(ctx);

      for (const mark of ['dvd', 'idle-screens', 'diamond', 'ring']) {
        inst.applyTrack?.({ program: 'dvd', seed: 7, deltas: [{ t: 0, path: 'mark', value: mark }] });

        log = [];
        expect(() => inst.renderFrame(12_345, 7)).not.toThrow();
        const pinned = JSON.stringify(log);

        expect(() => inst.renderFrame(40_000, 7)).not.toThrow();

        log = [];
        expect(() => inst.renderFrame(12_345, 7)).not.toThrow();
        expect(JSON.stringify(log), `${mark}: seek away and back is stable`).toBe(pinned);
      }

      inst.dispose();
      host.remove();
    });
  });
});
