// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { runIdleWorker, type WorkerOutbound } from './worker-protocol';

const outbound: WorkerOutbound[] = [];

beforeAll(() => {
  vi.stubGlobal('postMessage', (msg: WorkerOutbound) => outbound.push(msg));
  runIdleWorker({ sync: { manifest: { id: 'sync', label: 'Sync' }, mount: () => ({ setPaused() {}, resize() {}, dispose() {} }) } });
});

describe('runIdleWorker without compiler', () => {
  it('errors on mount-spec when no compiler is configured', () => {
    const canvas = document.createElement('canvas') as unknown as OffscreenCanvas;
    self.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'mount-spec',
          canvas,
          spec: {},
          width: 100,
          height: 100,
          seed: 1,
          dpr: 1,
          reducedMotion: false,
        },
      }),
    );
    expect(outbound.at(-1)).toEqual({ type: 'error', message: 'no compiler provided for mount-spec' });
  });
});
