import { createRng } from './rng';
import type { ControlTrack, SaverContext, SaverInstance, SaverPlugin } from './types';

/** Main thread → Worker messages. */
export type WorkerInbound =
  | {
      type: 'mount';
      canvas: OffscreenCanvas;
      saverId: string;
      width: number;
      height: number;
      seed: number;
      dpr: number;
      reducedMotion: boolean;
      /** Display refresh rate (Hz) for the rAF polyfill on browsers that lack
       *  Worker requestAnimationFrame (Safari). Defaults to 60. */
      refreshRate?: number;
      /** Force the setTimeout-based rAF polyfill even when native rAF exists.
       *  Used by tests to verify the polyfill drives frames. */
      forceRafPolyfill?: boolean;
    }
  | {
      type: 'mount-spec';
      canvas: OffscreenCanvas;
      spec: unknown;
      width: number;
      height: number;
      seed: number;
      dpr: number;
      reducedMotion: boolean;
      refreshRate?: number;
      forceRafPolyfill?: boolean;
    }
  | { type: 'resize'; width: number; height: number; dpr: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'track'; track: ControlTrack }
  | { type: 'sample' }
  | { type: 'dispose' };

/** Worker → main thread messages. */
export type WorkerOutbound =
  | { type: 'mounted' }
  | { type: 'sampled'; hasContent: boolean }
  | { type: 'error'; message: string };

/** Options for {@link runIdleWorker}. */
export interface RunIdleWorkerOpts {
  /** Spec compiler for `mount-spec` messages. Pass `compileSaver` from
   *  `@idle-screens/schema` to enable schema-based savers in this Worker. */
  compiler?: (spec: unknown) => SaverPlugin;
}

/**
 * Run inside a dedicated Worker. Accepts a registry of worker-ready saver plugins
 * and listens for lifecycle messages from the main thread.
 *
 * Usage (in the Worker entry file):
 * ```ts
 * import { runIdleWorker } from '@idle-screens/core';
 * import { warp } from './warp';
 * runIdleWorker({ warp });
 * ```
 */
export function runIdleWorker(
  registry: Record<string, SaverPlugin>,
  opts?: RunIdleWorkerOpts,
): void {
  let instance: SaverInstance | null = null;
  let activeCanvas: OffscreenCanvas | null = null;
  let usingPolyfill = false;

  const post = (msg: WorkerOutbound): void => {
    self.postMessage(msg);
  };

  const installRafPolyfill = (refreshRate?: number): void => {
    const g = globalThis as Record<string, unknown>;
    const interval = refreshRate ? Math.round(1000 / refreshRate) : 16;
    g.requestAnimationFrame = (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), interval) as unknown as number;
    g.cancelAnimationFrame = (id: number) => clearTimeout(id);
    usingPolyfill = true;
  };

  if (typeof requestAnimationFrame === 'undefined') {
    installRafPolyfill();
  }

  const mountPlugin = (
    plugin: SaverPlugin,
    canvas: OffscreenCanvas,
    msg: {
      width: number; height: number; seed: number;
      dpr: number; reducedMotion: boolean;
      refreshRate?: number; forceRafPolyfill?: boolean;
    },
  ): void => {
    if (msg.forceRafPolyfill) {
      installRafPolyfill(msg.refreshRate);
    } else if (usingPolyfill && msg.refreshRate) {
      installRafPolyfill(msg.refreshRate);
    }

    activeCanvas = canvas;
    const hostStub = new Proxy({} as HTMLElement, {
      get(_target, prop) {
        throw new Error(
          `Saver accessed host.${String(prop)} in a Worker — ` +
          `Workers have no DOM. Use ctx.surface instead of creating your own canvas.`,
        );
      },
    });
    const ctx: SaverContext = {
      host: hostStub,
      surface: canvas,
      dpr: msg.dpr,
      width: msg.width,
      height: msg.height,
      rng: createRng(msg.seed),
      seed: msg.seed,
      reducedMotion: msg.reducedMotion,
    };
    try {
      const result = plugin.mount(ctx);
      if (result instanceof Promise) {
        result.then((inst) => {
          instance = inst;
          post({ type: 'mounted' });
        }).catch((err: unknown) => {
          post({ type: 'error', message: String(err) });
        });
      } else {
        instance = result;
        post({ type: 'mounted' });
      }
    } catch (err: unknown) {
      post({ type: 'error', message: String(err) });
    }
  };

  self.addEventListener('message', (raw: MessageEvent<WorkerInbound>) => {
    const msg = raw.data;
    switch (msg.type) {
      case 'mount': {
        const plugin = registry[msg.saverId];
        if (!plugin) {
          post({ type: 'error', message: `unknown saver: ${msg.saverId}` });
          return;
        }
        mountPlugin(plugin, msg.canvas, msg);
        break;
      }
      case 'mount-spec': {
        if (!opts?.compiler) {
          post({ type: 'error', message: 'no compiler provided for mount-spec' });
          return;
        }
        try {
          const plugin = opts.compiler(msg.spec);
          mountPlugin(plugin, msg.canvas, msg);
        } catch (err: unknown) {
          post({ type: 'error', message: String(err) });
        }
        break;
      }
      case 'resize':
        instance?.resize(msg.width, msg.height, msg.dpr);
        break;
      case 'pause':
        instance?.setPaused(msg.paused);
        break;
      case 'track':
        instance?.applyTrack?.(msg.track);
        break;
      case 'sample': {
        if (!activeCanvas) {
          post({ type: 'sampled', hasContent: false });
          return;
        }
        const c2d = activeCanvas.getContext('2d');
        if (!c2d) {
          post({ type: 'sampled', hasContent: false });
          return;
        }
        const cw = activeCanvas.width;
        const ch = activeCanvas.height;
        let hasContent = false;
        const COLS = 10;
        const ROWS = 10;
        for (let r = 0; r < ROWS && !hasContent; r++) {
          const y = Math.floor((ch * (r + 1)) / (ROWS + 1));
          for (let c = 0; c < COLS && !hasContent; c++) {
            const x = Math.floor((cw * (c + 1)) / (COLS + 1));
            const data = c2d.getImageData(x, y, 1, 1).data;
            if (data[0]! > 0 || data[1]! > 0 || data[2]! > 0) hasContent = true;
          }
        }
        post({ type: 'sampled', hasContent });
        break;
      }
      case 'dispose':
        instance?.dispose();
        instance = null;
        activeCanvas = null;
        break;
    }
  });
}
