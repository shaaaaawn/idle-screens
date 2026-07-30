import { describe, it, expect } from 'vitest';
import { effectivePixelRatio, isSoftwareGL, qualityFor } from './quality';

describe('metaquarium quality tiers', () => {
  it('high tier gets the full tank', () => {
    const q = qualityFor('high');
    expect(q).toEqual({
      maxPixelRatio: 1.25,
      antialias: true,
      fishCap: 24,
      pixelBudget: 1_800_000,
    });
  });

  it('effectivePixelRatio enforces the pixel budget at fullscreen sizes', () => {
    const q = qualityFor('high');
    expect(effectivePixelRatio(1280, 720, 2, q)).toBeCloseTo(1.25);
    const pr = effectivePixelRatio(2560, 1440, 2, q);
    expect(2560 * pr * (1440 * pr)).toBeLessThanOrEqual(q.pixelBudget * 1.01);
    expect(pr).toBeGreaterThanOrEqual(0.5);
  });

  it('standard tier trades resolution for headroom', () => {
    const q = qualityFor('standard');
    expect(q.maxPixelRatio).toBeLessThan(1.25);
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
