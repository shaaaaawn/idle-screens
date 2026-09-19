import type { CapabilityTier } from '@idle-screens/capabilities';

export interface TankQuality {
  maxPixelRatio: number;
  antialias: boolean;
  fishCap: number;
  pixelBudget: number;
  /** Plankton motes at moteDensity=1 — scaled down by the param, zero cost
   *  at the default 0. Vertex-shader driven, so the per-frame cost is GPU
   *  vertex work only. */
  moteCap: number;
  /** Budget for environment layers (see environments.ts LAYER_COST): the
   *  ceiling costs 1, rays 2, terrain is free. A weak device keeps the
   *  ceiling and loses the rays. */
  envBudget: number;
  /** Scenery budget: clusters in the scene, shards in one cluster, and
   *  whether shards get their halo shell (it doubles their draw calls). */
  props: { clusters: number; shards: number; halo: boolean };
  /** Point lights that ride glow parts in lit mode. Every one is a term in
   *  every lit fragment, so the weakest tier lights by key + fill alone. */
  glowLights: number;
}

export function qualityFor(tier: CapabilityTier): TankQuality {
  switch (tier) {
    case 'high':
      return { maxPixelRatio: 1.25, antialias: true, fishCap: 24, pixelBudget: 1_800_000, moteCap: 400, envBudget: 3, props: { clusters: 12, shards: 32, halo: true }, glowLights: 4 };
    case 'standard':
      return { maxPixelRatio: 1, antialias: true, fishCap: 16, pixelBudget: 1_200_000, moteCap: 250, envBudget: 2, props: { clusters: 8, shards: 20, halo: true }, glowLights: 3 };
    default:
      return { maxPixelRatio: 1, antialias: false, fishCap: 8, pixelBudget: 900_000, moteCap: 120, envBudget: 1, props: { clusters: 4, shards: 12, halo: false }, glowLights: 0 };
  }
}

export function effectivePixelRatio(
  width: number,
  height: number,
  dpr: number,
  q: TankQuality,
): number {
  const area = Math.max(1, width * height);
  return Math.max(0.5, Math.min(dpr, q.maxPixelRatio, Math.sqrt(q.pixelBudget / area)));
}

export function isSoftwareGL(renderer: string): boolean {
  return /swiftshader|llvmpipe|software|swangle/i.test(renderer);
}

/** Probe the default GL context for a software renderer before creating a
 *  WebGLRenderer so antialias/quality tier match from the first frame. */
export function probeSoftwareGL(): boolean {
  if (typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) return false;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(
    dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  );
  return isSoftwareGL(renderer);
}
