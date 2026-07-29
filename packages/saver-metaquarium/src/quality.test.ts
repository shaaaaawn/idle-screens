import { describe, it, expect } from 'vitest';
import { isSoftwareGL, qualityFor } from './quality';

describe('metaquarium quality tiers', () => {
  it('high tier (WebGPU-class) gets the full tank — but never retina-full pixels', () => {
    const q = qualityFor('high');
    // 1.5 cap + half-res bloom: retina-full through the bloom chain measured
    // ~20fps on an M1 Max; this config measures 60.
    expect(q).toEqual({ maxPixelRatio: 1.5, antialias: true, bloomScale: 0.5, fishCap: 24 });
  });

  it('standard tier (WebGL2) trades resolution for headroom', () => {
    const q = qualityFor('standard');
    expect(q.maxPixelRatio).toBeLessThan(1.5);
    expect(q.bloomScale).toBe(0.5);
    expect(q.fishCap).toBe(16);
  });

  it('recognizes software rasterizers', () => {
    expect(isSoftwareGL('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)))')).toBe(true);
    expect(isSoftwareGL('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareGL('ANGLE Metal Renderer: Apple M1 Max')).toBe(false);
  });

  it('basic/minimal degrade hard but never block', () => {
    for (const tier of ['basic', 'minimal'] as const) {
      const q = qualityFor(tier);
      expect(q.antialias).toBe(false);
      expect(q.fishCap).toBeLessThanOrEqual(8);
    }
  });
});
