// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createRng, type SaverContext, type SaverInstance, type SaverPlugin } from '@idle-screens/core';
import { warp } from './warp';
import { dvd } from './dvd';
import { flurry } from './flurry';

/**
 * Resuming from a pause must continue the frozen frame, not replay from zero.
 *
 * These savers moved to a closed-form loop that derives logical time from the
 * rAF clock: `start()` re-anchors `startT` to the next frame's timestamp and
 * renders `now - startT`. That is right at mount and wrong on resume — the
 * subtraction always yields zero for the first frame after `start()`, so every
 * pause/resume (and every reduced-motion toggle) snapped the scene back to its
 * opening frame and restarted any applied control track. The pre-modernization
 * loop had no time origin to reset, so this arrived with the rewrite.
 */

/** happy-dom has no Canvas2D; stub every 2d call these savers make. */
function stubContext2D(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} } as unknown as CanvasGradient;
  return {
    canvas,
    fillRect: () => {}, clearRect: () => {}, strokeRect: () => {},
    beginPath: () => {}, closePath: () => {}, moveTo: () => {}, lineTo: () => {},
    arc: () => {}, ellipse: () => {}, fill: () => {}, stroke: () => {},
    setTransform: () => {}, save: () => {}, restore: () => {},
    translate: () => {}, rotate: () => {}, scale: () => {},
    drawImage: () => {}, measureText: () => ({ width: 10 }),
    fillText: () => {}, strokeText: () => {},
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif',
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    shadowBlur: 0, shadowColor: '#000', lineCap: 'butt', lineJoin: 'miter',
  } as unknown as CanvasRenderingContext2D;
}

/** A hand-cranked rAF so the test owns the clock the savers derive time from. */
function manualRaf(): { frame: (now: number) => void; restore: () => void } {
  const original = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  let pending: FrameRequestCallback | null = null;
  let id = 0;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    pending = cb;
    return ++id;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {
    pending = null;
  }) as typeof globalThis.cancelAnimationFrame;
  return {
    frame: (now: number) => {
      const cb = pending;
      pending = null;
      cb?.(now);
    },
    restore: () => {
      globalThis.requestAnimationFrame = original;
      globalThis.cancelAnimationFrame = originalCancel;
    },
  };
}

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

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});

function makeCtx(): SaverContext {
  const host = document.createElement('div');
  hosts.push(host);
  return {
    host,
    dpr: 1,
    width: 1280,
    height: 800,
    rng: createRng(7),
    seed: 7,
    reducedMotion: false, // we want the rAF loop to actually start
  };
}

/** Drive the saver and record the logical `t` of every frame it renders. */
function record(instance: SaverInstance): number[] {
  const seen: number[] = [];
  const inner = instance.renderFrame!.bind(instance);
  // An own property shadows the prototype method, so the saver's internal
  // `this.renderFrame(...)` call lands here too.
  instance.renderFrame = (t: number, seed: number) => {
    seen.push(t);
    inner(t, seed);
  };
  return seen;
}

describe.each([
  ['warp', warp],
  ['dvd', dvd],
  ['flurry', flurry],
] as Array<[string, SaverPlugin]>)('%s resume', (_name, saver) => {
  it('continues from the frozen frame instead of restarting at zero', async () => {
    const raf = manualRaf();
    try {
      const instance = await Promise.resolve(saver.mount(makeCtx()));
      const seen = record(instance);

      // Run to a non-zero logical time.
      raf.frame(1000); // first frame anchors the origin -> t = 0
      raf.frame(1500); // -> t = 500
      const beforePause = seen[seen.length - 1]!;
      expect(beforePause).toBeGreaterThan(0);

      instance.setPaused(true);
      // Resume much later on the wall clock: the gap must not leak into logical
      // time, and neither may the scene rewind.
      instance.setPaused(false);
      raf.frame(9000); // re-anchors here -> should resume AT beforePause
      const afterResume = seen[seen.length - 1]!;

      expect(afterResume, 'resume replayed from logical zero').toBeCloseTo(beforePause, 5);

      // ...and time advances normally from there, without the 7.5s wall gap.
      raf.frame(9200);
      expect(seen[seen.length - 1]!).toBeCloseTo(beforePause + 200, 5);

      instance.dispose();
    } finally {
      raf.restore();
    }
  });
});
