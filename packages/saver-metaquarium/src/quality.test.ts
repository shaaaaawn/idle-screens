import { describe, it, expect } from 'vitest';
import { qualityFor } from './quality';

describe('metaquarium quality tiers', () => {
  it('high tier (WebGPU-class) gets the full tank', () => {
    const q = qualityFor('high');
    expect(q).toEqual({ maxPixelRatio: 2, antialias: true, bloomScale: 1, fishCap: 24 });
  });

  it('standard tier (WebGL2) trades resolution for headroom', () => {
    const q = qualityFor('standard');
    expect(q.maxPixelRatio).toBeLessThan(2);
    expect(q.bloomScale).toBe(0.5);
    expect(q.fishCap).toBe(16);
  });

  it('basic/minimal degrade hard but never block', () => {
    for (const tier of ['basic', 'minimal'] as const) {
      const q = qualityFor(tier);
      expect(q.antialias).toBe(false);
      expect(q.fishCap).toBeLessThanOrEqual(8);
    }
  });
});
