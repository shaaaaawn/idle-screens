import { describe, expect, it, vi } from 'vitest';

const loaderState = vi.hoisted(() => ({
  instances: [] as Array<{ disposed: boolean; path?: string }>,
}));

vi.mock('three/examples/jsm/loaders/DRACOLoader.js', () => ({
  DRACOLoader: class {
    disposed = false;
    path?: string;

    constructor() {
      loaderState.instances.push(this);
    }

    setDecoderPath(p: string): this { this.path = p; return this; }
    setWorkerLimit(): this { return this; }
    dispose(): this { this.disposed = true; return this; }
  },
}));

import { __withDracoLoaderForTest } from './tank';

// The page the tank mounts on: relative decoder paths are on its origin.
vi.stubGlobal('location', { href: 'https://host.example/app/' });

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

  it('a foreign dracoPath never reaches the decoder: it falls back to the shipped copy, logged once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let foreign: { path?: string } | undefined;
    let fallback: { path?: string } | undefined;
    await __withDracoLoaderForTest('https://evil.example/draco/', async (loader) => {
      foreign = loader as unknown as { path?: string };
      await __withDracoLoaderForTest('', async (l) => { fallback = l as unknown as { path?: string }; });
    });
    await __withDracoLoaderForTest('https://evil.example/draco/', async () => {});
    expect(foreign).toBe(fallback);
    expect(foreign!.path).not.toContain('evil.example');
    expect(foreign!.path).toMatch(/\/draco\/$/);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('dracoPath'))).toHaveLength(1);
    warn.mockRestore();
  });

  it('a same-origin dracoPath is used as given', async () => {
    let path: string | undefined;
    await __withDracoLoaderForTest('/draco', async (loader) => { path = (loader as unknown as { path?: string }).path; });
    expect(path).toBe('/draco/');
  });
});
