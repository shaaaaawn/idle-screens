import type { CapabilityTier } from '@idle-screens/capabilities';

export interface TankQuality {
  maxPixelRatio: number;
  antialias: boolean;
  fishCap: number;
  pixelBudget: number;
}

export function qualityFor(tier: CapabilityTier): TankQuality {
  switch (tier) {
    case 'high':
      return { maxPixelRatio: 1.25, antialias: true, fishCap: 24, pixelBudget: 1_800_000 };
    case 'standard':
      return { maxPixelRatio: 1, antialias: true, fishCap: 16, pixelBudget: 1_200_000 };
    default:
      return { maxPixelRatio: 1, antialias: false, fishCap: 8, pixelBudget: 900_000 };
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
