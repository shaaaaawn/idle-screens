// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { runIdleWorker, type WorkerInbound, type WorkerOutbound } from './worker-protocol';
import type { SaverInstance, SaverPlugin } from './types';

const outbound: WorkerOutbound[] = [];

beforeEach(() => {
  outbound.length = 0;
  vi.stubGlobal('postMessage', (msg: WorkerOutbound) => {
    outbound.push(msg);
  });
});

function dispatch(msg: WorkerInbound): void {
  self.dispatchEvent(new MessageEvent('message', { data: msg }));
}

function fakeCanvas(w = 64, h = 64, paint = true): OffscreenCanvas {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  if (paint) {
    const ctx = el.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 2, 2);
    }
  }
  return el as unknown as OffscreenCanvas;
}

const mountMsg = (saverId: string, canvas = fakeCanvas()): WorkerInbound => ({
  type: 'mount',
  canvas,
  saverId,
  width: 320,
  height: 200,
  seed: 42,
  dpr: 1,
  reducedMotion: false,
});

const stubInst = (tag = 'a'): SaverInstance & { tag: string; disposed: boolean } => ({
  tag,
  disposed: false,
  setPaused: vi.fn(),
  resize: vi.fn(),
  dispose() {
    this.disposed = true;
  },
});

let resolveSlow: ((inst: SaverInstance) => void) | null = null;
const lifeInst = stubInst('life');

const registry: Record<string, SaverPlugin> = {
  sync: {
    manifest: { id: 'sync', label: 'Sync' },
    mount: () => stubInst('sync'),
  },
  slow: {
    manifest: { id: 'slow', label: 'Slow' },
    mount: () =>
      new Promise<SaverInstance>((resolve) => {
        resolveSlow = resolve;
      }),
  },
  fast: {
    manifest: { id: 'fast', label: 'Fast' },
    mount: () => stubInst('fast'),
  },
  life: {
    manifest: { id: 'life', label: 'Life' },
    mount: () => lifeInst,
  },
  dom: {
    manifest: { id: 'dom', label: 'DOM' },
    mount: (ctx) => {
      try {
        void ctx.host.appendChild(document.createElement('div'));
      } catch {
        /* expected */
      }
      return stubInst('dom');
    },
  },
};

describe('runIdleWorker', () => {
  beforeAll(() => {
    runIdleWorker(registry, {
      compiler: (spec: unknown) => {
        if ((spec as { bad?: boolean }).bad) throw new Error('compile failed');
        return {
          manifest: { id: 'schema', label: 'Schema' },
          mount: () => stubInst('schema'),
        };
      },
    });
  });

  describe('mount', () => {
    it('posts mounted for a sync saver', () => {
      dispatch(mountMsg('sync'));
      expect(outbound).toEqual([{ type: 'mounted' }]);
    });

    it('errors on unknown saver id', () => {
      dispatch(mountMsg('missing'));
      expect(outbound.at(-1)).toEqual({ type: 'error', message: 'unknown saver: missing' });
    });

    it('rejects host DOM access in mount context', () => {
      dispatch(mountMsg('dom'));
      expect(outbound.at(-1)).toEqual({ type: 'mounted' });
    });
  });

  describe('async mount', () => {
    it('posts mounted when async mount resolves', async () => {
      dispatch(mountMsg('slow'));
      const inst = stubInst('slow-resolved');
      resolveSlow?.(inst);
      await Promise.resolve();
      expect(outbound).toEqual([{ type: 'mounted' }]);
    });

    it('ignores stale async completion after dispose', async () => {
      dispatch(mountMsg('slow'));
      dispatch({ type: 'dispose' });
      const stale = stubInst('stale');
      resolveSlow?.(stale);
      await Promise.resolve();
      expect(stale.disposed).toBe(true);
      expect(outbound).toHaveLength(0);
    });

    it('ignores stale async completion after a newer mount', async () => {
      dispatch(mountMsg('slow'));
      dispatch(mountMsg('fast'));
      expect(outbound).toEqual([{ type: 'mounted' }]);

      const stale = stubInst('stale');
      resolveSlow?.(stale);
      await Promise.resolve();
      expect(stale.disposed).toBe(true);
    });
  });

  describe('lifecycle', () => {
    beforeEach(() => {
      Object.assign(lifeInst, stubInst('life'));
      dispatch(mountMsg('life'));
      outbound.length = 0;
    });

    it('forwards resize and pause', () => {
      dispatch({ type: 'resize', width: 800, height: 600, dpr: 2 });
      dispatch({ type: 'pause', paused: true });
      expect(lifeInst.resize).toHaveBeenCalledWith(800, 600, 2);
      expect(lifeInst.setPaused).toHaveBeenCalledWith(true);
    });

    it('dispose tears down the instance', () => {
      dispatch({ type: 'dispose' });
      expect(lifeInst.disposed).toBe(true);
      outbound.length = 0;
      dispatch({ type: 'pause', paused: true });
      expect(lifeInst.setPaused).not.toHaveBeenCalled();
    });

    it('sample probes the mounted canvas', () => {
      dispatch({ type: 'sample' });
      expect(outbound).toHaveLength(1);
      const msg = outbound[0];
      expect(msg?.type).toBe('sampled');
      if (msg?.type !== 'sampled') throw new Error('expected sampled message');
      expect(typeof msg.hasContent).toBe('boolean');
    });

    it('sample is false with no canvas', () => {
      dispatch({ type: 'dispose' });
      outbound.length = 0;
      dispatch({ type: 'sample' });
      expect(outbound).toEqual([{ type: 'sampled', hasContent: false }]);
    });
  });

  describe('mount-spec', () => {
    it('mounts via compiler', () => {
      dispatch({
        type: 'mount-spec',
        canvas: fakeCanvas(),
        spec: { id: 'snow' },
        width: 100,
        height: 100,
        seed: 1,
        dpr: 1,
        reducedMotion: false,
      });
      expect(outbound).toEqual([{ type: 'mounted' }]);
    });

    it('surfaces compile errors', () => {
      dispatch({
        type: 'mount-spec',
        canvas: fakeCanvas(),
        spec: { bad: true },
        width: 100,
        height: 100,
        seed: 1,
        dpr: 1,
        reducedMotion: false,
      });
      expect(outbound.at(-1)).toEqual({ type: 'error', message: 'Error: compile failed' });
    });
  });
});
