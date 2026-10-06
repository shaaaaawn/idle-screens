import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRng } from '@idle-screens/core';
import type { SaverContext, SaverInstance } from '@idle-screens/core';

// mount() routes on opts.backend === 'lofi' by dynamically importing either
// './lofi-tank' or './tank' (metaquarium.ts:22-35). The manifest-only tests
// below don't exercise that branch, so a routing regression (lofi mounting
// the three.js tank, or the default loading lofi) would pass them all green.
// Mock both mount targets and assert which one mount() actually calls, in
// each direction. vi.mock calls are hoisted above this file's imports, so
// `createMetaquarium`'s own dynamic `import('./tank')` / `import('./lofi-tank')`
// resolve to these mocks just like a static import would.
const mountState = vi.hoisted(() => ({ tankCalls: 0, lofiCalls: 0 }));

vi.mock('./tank', () => ({
  mountTank: (): SaverInstance => {
    mountState.tankCalls++;
    return { setPaused() {}, resize() {}, dispose() {} };
  },
}));

vi.mock('./lofi-tank', () => ({
  mountLofi: (): SaverInstance => {
    mountState.lofiCalls++;
    return { setPaused() {}, resize() {}, dispose() {} };
  },
}));

vi.mock('@idle-screens/capabilities', () => ({
  detectCapabilities: async () => ({}),
  computeTier: () => 'mid',
}));

import { createMetaquarium } from './metaquarium';

function fakeCtx(): SaverContext {
  return {
    host: {} as unknown as SaverContext['host'],
    dpr: 1,
    width: 100,
    height: 100,
    rng: createRng(1),
    seed: 1,
    reducedMotion: false,
  };
}

describe('createMetaquarium manifest wiring', () => {
  it('defaults to the webgl2 tank manifest', () => {
    const { manifest } = createMetaquarium();
    expect(manifest.minBackend).toBe('webgl2');
    expect(manifest.costTier).toBe('medium');
  });

  it('the lofi backend only claims what its Canvas2D renderer needs, so capability gating never blocks it on WebGL2-less devices', () => {
    const { manifest } = createMetaquarium({ backend: 'lofi' });
    expect(manifest.minBackend).toBe('canvas2d');
    expect(manifest.costTier).toBe('low');
  });

  it('rejects a custom catalog on the lofi backend instead of silently discarding it — lofi resolves icons by id from the live asset set, never from a FishEntry[]', () => {
    expect(() => createMetaquarium({ backend: 'lofi', catalog: [] })).toThrow(/lofi/i);
  });
});

describe('createMetaquarium mount routing', () => {
  beforeEach(() => {
    mountState.tankCalls = 0;
    mountState.lofiCalls = 0;
  });

  it('mounts the three.js tank by default, and never touches the lofi module', async () => {
    await createMetaquarium().mount(fakeCtx());
    expect(mountState.tankCalls).toBe(1);
    expect(mountState.lofiCalls).toBe(0);
  });

  it("mounts the lofi tank for backend: 'lofi', and never pulls in the three.js tank module", async () => {
    await createMetaquarium({ backend: 'lofi' }).mount(fakeCtx());
    expect(mountState.lofiCalls).toBe(1);
    expect(mountState.tankCalls).toBe(0);
  });
});
