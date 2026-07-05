/** Render backends a saver can require, cheapest -> most capable. */
export type Backend = 'css' | 'canvas2d' | 'webgl2' | 'webgpu';

/** Perf/cost budget class (mirrors a saver manifest's costTier). */
export type CostTier = 'idle' | 'low' | 'medium' | 'high';

export type MotionIntensity = 'calm' | 'moderate' | 'energetic';
export type ReducedMotionFallback = 'static' | 'slow' | 'hide';

/** Which backends the current device actually provides. */
export interface BackendSupport {
  css: boolean;
  canvas2d: boolean;
  webgl2: boolean;
  webgpu: boolean;
}

/**
 * A snapshot of device capabilities. `backends` is always probed; EVERYTHING ELSE is
 * OPTIONAL — deviceMemory / connection.saveData / effectiveType are Chromium-only and
 * absent in Safari/Firefox, so consumers must have a defined "unknown" behavior and
 * these may only ever *lower* a tier, never gate on their absence.
 */
export interface Capabilities {
  backends: BackendSupport;
  reducedMotion?: boolean;
  dpr?: number;
  coarsePointer?: boolean;
  screen?: { w: number; h: number };
  hardwareConcurrency?: number;
  /** Chromium-only, privacy-capped ladder (0.25..8). Optional refinement. */
  deviceMemoryGb?: number;
  /** Chromium-only. Optional refinement. */
  saveData?: boolean;
  /** Chromium-only (navigator.connection.effectiveType). */
  effectiveType?: string;
  colorScheme?: 'light' | 'dark' | 'no-preference';
}

/** Compute-capability tier, independent of the backend availability axis. */
export type CapabilityTier = 'minimal' | 'basic' | 'standard' | 'high';

/** The subset of a saver manifest the tiering needs (structurally SaverManifest). */
export interface SaverInfo {
  id: string;
  minBackend?: Backend;
  costTier?: CostTier;
  motionIntensity?: MotionIntensity;
  reducedMotionFallback?: ReducedMotionFallback;
}

export type EligibilityStatus = 'ok' | 'degraded' | 'blocked';

export interface SaverEligibility {
  id: string;
  status: EligibilityStatus;
  /** Human-readable reasons (why blocked / degraded). */
  reasons: string[];
}
