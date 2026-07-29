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
  /** HARD ceiling on backing-store pixels. Fullscreen 5K through a bloom
   *  chain is where "one fish at 40fps" comes from — render internally at
   *  the budget and let the browser upscale; a soft underwater scene hides
   *  the difference completely. */
  pixelBudget: number;
}

export function qualityFor(tier: CapabilityTier): TankQuality {
  switch (tier) {
    case 'high':
      return { maxPixelRatio: 1.5, antialias: true, bloomScale: 0.5, fishCap: 24, pixelBudget: 2_400_000 };
    case 'standard':
      return { maxPixelRatio: 1.25, antialias: true, bloomScale: 0.5, fishCap: 16, pixelBudget: 1_700_000 };
    default:
      // basic/minimal (incl. software GL) — cheapest possible tank.
      return { maxPixelRatio: 1, antialias: false, bloomScale: 0.5, fishCap: 8, pixelBudget: 900_000 };
  }
}

/** Pixel ratio that respects DPR, the tier cap, AND the pixel budget. */
export function effectivePixelRatio(
  width: number,
  height: number,
  dpr: number,
  q: TankQuality,
): number {
  const area = Math.max(1, width * height);
  return Math.max(0.5, Math.min(dpr, q.maxPixelRatio, Math.sqrt(q.pixelBudget / area)));
}

/** Software rasterizers (SwiftShader in headless CI, llvmpipe, SwANGLE)
 *  report webgl2 but run it on the CPU — every real-GPU assumption inverts.
 *  Callers should drop to the cheapest tier and skip post-processing. */
export function isSoftwareGL(renderer: string): boolean {
  return /swiftshader|llvmpipe|software|swangle/i.test(renderer);
}
