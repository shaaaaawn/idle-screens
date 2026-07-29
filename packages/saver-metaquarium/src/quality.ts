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
      return { maxPixelRatio: 2, antialias: true, bloomScale: 1, fishCap: 24 };
    case 'standard':
      return { maxPixelRatio: 1.5, antialias: true, bloomScale: 0.5, fishCap: 16 };
    default:
      // basic/minimal shouldn't normally mount (webgl2 floor) — degrade hard.
      return { maxPixelRatio: 1, antialias: false, bloomScale: 0.5, fishCap: 8 };
  }
}
