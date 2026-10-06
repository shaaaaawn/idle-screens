import { describe, expect, it, vi } from 'vitest';

const loaderState = vi.hoisted(() => ({
  instances: [] as Array<{ disposed: boolean }>,
}));

vi.mock('three/examples/jsm/loaders/DRACOLoader.js', () => ({
  DRACOLoader: class {
    disposed = false;

    constructor() {
      loaderState.instances.push(this);
    }

    setDecoderPath(): this { return this; }
    setWorkerLimit(): this { return this; }
    dispose(): this { this.disposed = true; return this; }
  },
}));

import { __withDracoLoaderForTest } from './tank';

describe('shared Draco decoder lifetime', () => {
  it('stays alive until every concurrent decode on a path finishes', async () => {
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => { finishFirst = resolve; });
    const secondGate = new Promise<void>((resolve) => { finishSecond = resolve; });
    let firstLoader: unknown;
    let secondLoader: unknown;

    const first = __withDracoLoaderForTest('/shared', async (loader) => {
      firstLoader = loader;
      await firstGate;
    });
    const second = __withDracoLoaderForTest('/shared', async (loader) => {
      secondLoader = loader;
      await secondGate;
    });

    expect(firstLoader).toBe(secondLoader);
    const instance = loaderState.instances.at(-1)!;
    finishFirst();
    await first;
    expect(instance.disposed).toBe(false);

    finishSecond();
    await second;
    expect(instance.disposed).toBe(true);
  });

  it('releases the decoder when parsing rejects', async () => {
    const before = loaderState.instances.length;
    await expect(__withDracoLoaderForTest('/reject', async () => {
      throw new Error('decode failed');
    })).rejects.toThrow('decode failed');
    expect(loaderState.instances).toHaveLength(before + 1);
    expect(loaderState.instances.at(-1)!.disposed).toBe(true);
  });
});
