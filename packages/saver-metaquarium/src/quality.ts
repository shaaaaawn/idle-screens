import type { CapabilityTier } from '@idle-screens/capabilities';

/**
 * Device-tier → render-quality mapping. `minBackend: 'webgl2'` is the floor;
 * WebGPU-class hardware (tier `high`) is the "bleeding edge" upgrade lane —
 * it buys resolution, AA, full-res bloom, and a fuller tank rather than a
 * different renderer.
 */
export interface TankQuality {
  /** Cap applied to the context DPR. */
  maxPixelRatio: number;
  antialias: boolean;
  /** Bloom render-target scale (1 = full res; the original halves on mobile). */
  bloomScale: number;
  /** Ceiling on simultaneously visible fish, before the fishCount param. */
  fishCap: number;
}

export function qualityFor(tier: CapabilityTier): TankQuality {
  switch (tier) {
    case 'high':
      // 1.5, not devicePixelRatio: retina-full is ~15 Mpix through the bloom
      // chain — the difference reads as slight softness, the cost as 20fps.
      return { maxPixelRatio: 1.5, antialias: true, bloomScale: 0.5, fishCap: 24 };
    case 'standard':
      return { maxPixelRatio: 1.25, antialias: true, bloomScale: 0.5, fishCap: 16 };
    default:
      // basic/minimal (incl. software GL) — cheapest possible tank.
      return { maxPixelRatio: 1, antialias: false, bloomScale: 0.5, fishCap: 8 };
  }
}

/** Software rasterizers (SwiftShader in headless CI, llvmpipe, SwANGLE)
 *  report webgl2 but run it on the CPU — every real-GPU assumption inverts.
 *  Callers should drop to the cheapest tier and skip post-processing. */
export function isSoftwareGL(renderer: string): boolean {
  return /swiftshader|llvmpipe|software|swangle/i.test(renderer);
}
