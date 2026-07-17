// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { createRng } from '@idle-screens/core';
import { gpuMainThreadEligible } from './gpu-eligible';

const ctx = (overrides: Partial<{ surface: OffscreenCanvas }> = {}) => ({
  host: document.createElement('div'),
  dpr: 1,
  width: 100,
  height: 100,
  rng: createRng(1),
  seed: 1,
  reducedMotion: false,
  ...overrides,
});

describe('gpuMainThreadEligible', () => {
  afterEach(() => {
    delete (window as unknown as { __idleScreensMac?: unknown }).__idleScreensMac;
  });

  it('returns false when a worker surface is provided', () => {
    const surface = new OffscreenCanvas(1, 1);
    expect(gpuMainThreadEligible(ctx({ surface }))).toBe(false);
  });

  it('returns false in the mac WKWebView host', () => {
    (window as unknown as { __idleScreensMac: object }).__idleScreensMac = {};
    expect(gpuMainThreadEligible(ctx())).toBe(false);
  });

  it('returns true on a normal main-thread host', () => {
    expect(gpuMainThreadEligible(ctx())).toBe(true);
  });
});
