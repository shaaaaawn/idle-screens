import type {
  Backend,
  Capabilities,
  CapabilityTier,
  CostTier,
  SaverEligibility,
  SaverInfo,
} from './types';

const BACKEND_RANK: Record<Backend, number> = { css: 0, canvas2d: 1, webgl2: 2, webgpu: 3 };
const COST_RANK: Record<CostTier, number> = { idle: 0, low: 1, medium: 2, high: 3 };
const TIER_ORDER: CapabilityTier[] = ['minimal', 'basic', 'standard', 'high'];

/** Does the device provide `min` (or any higher backend, which implies the lower ones)? */
export function backendSupported(caps: Capabilities, min: Backend = 'css'): boolean {
  const need = BACKEND_RANK[min];
  return (Object.keys(caps.backends) as Backend[]).some(
    (b) => caps.backends[b] && BACKEND_RANK[b] >= need,
  );
}

/** The best backend the device has. */
function topBackend(caps: Capabilities): Backend {
  let best: Backend = 'css';
  for (const b of Object.keys(caps.backends) as Backend[]) {
    if (caps.backends[b] && BACKEND_RANK[b] > BACKEND_RANK[best]) best = b;
  }
  return best;
}

function step(tier: CapabilityTier, by: number): CapabilityTier {
  const i = Math.max(0, Math.min(TIER_ORDER.length - 1, TIER_ORDER.indexOf(tier) + by));
  return TIER_ORDER[i];
}

/**
 * Compute a compute-capability tier. The BASE comes from the best available backend
 * (the reliable, cross-browser signal). Optional refinements (save-data, low memory,
 * few cores, a small coarse-pointer screen) can only LOWER it — never raise it, and
 * their ABSENCE never lowers it. This keeps non-Chromium devices from being mis-tiered.
 */
export function computeTier(caps: Capabilities): CapabilityTier {
  const base: CapabilityTier =
    topBackend(caps) === 'webgpu'
      ? 'high'
      : topBackend(caps) === 'webgl2'
        ? 'standard'
        : topBackend(caps) === 'canvas2d'
          ? 'basic'
          : 'minimal';

  let tier = base;
  if (caps.saveData === true) tier = step(tier, -1);
  if (caps.deviceMemoryGb !== undefined && caps.deviceMemoryGb < 4) tier = step(tier, -1);
  if (caps.hardwareConcurrency !== undefined && caps.hardwareConcurrency <= 2) tier = step(tier, -1);
  // Small mobile screens (coarse pointer + little area) tend to have weaker GPUs.
  if (caps.coarsePointer === true && caps.screen && caps.screen.w * caps.screen.h <= 640 * 960) {
    tier = step(tier, -1);
  }
  // Never exceed what the backend can actually do.
  if (TIER_ORDER.indexOf(tier) > TIER_ORDER.indexOf(base)) tier = base;
  return tier;
}

/** Max cost tier a device of this capability tier should run. */
export function costBudget(tier: CapabilityTier): CostTier {
  switch (tier) {
    case 'high':
      return 'high';
    case 'standard':
      return 'medium';
    case 'basic':
      return 'low';
    case 'minimal':
    default:
      return 'idle';
  }
}

function affordable(cost: CostTier, budget: CostTier): boolean {
  return COST_RANK[cost] <= COST_RANK[budget];
}

/**
 * Evaluate one saver against a device:
 *  - blocked: the device lacks the required backend, the cost exceeds the budget, or
 *    reduced-motion is on AND the saver's fallback is 'hide'.
 *  - degraded: reduced-motion is on and the saver has a non-hide fallback (it still
 *    runs, but statically/slowly) — this RESPECTS the manifest's declared a11y intent
 *    rather than blanket-blocking energetic savers.
 *  - ok: runs at full fidelity.
 */
export function evaluateSaver(saver: SaverInfo, caps: Capabilities): SaverEligibility {
  const reasons: string[] = [];
  let status: SaverEligibility['status'] = 'ok';
  const block = (r: string): void => {
    status = 'blocked';
    reasons.push(r);
  };
  const degrade = (r: string): void => {
    if (status !== 'blocked') status = 'degraded';
    reasons.push(r);
  };

  const min = saver.minBackend ?? 'css';
  if (!backendSupported(caps, min)) block(`needs ${min}, which this device lacks`);

  if (saver.costTier) {
    const budget = costBudget(computeTier(caps));
    if (!affordable(saver.costTier, budget)) {
      block(`cost "${saver.costTier}" exceeds the device budget "${budget}"`);
    }
  }

  if (caps.reducedMotion) {
    const fallback = saver.reducedMotionFallback;
    const movesALot = saver.motionIntensity === 'moderate' || saver.motionIntensity === 'energetic';
    if (fallback === 'hide') {
      block('reduced-motion: this saver hides');
    } else if (movesALot) {
      // moderate/energetic savers run, but in their reduced form — calm savers are
      // left fully eligible even if they declare a (no-op) fallback.
      degrade(`reduced-motion: uses "${fallback ?? 'static'}" fallback`);
    }
  }

  return { id: saver.id, status, reasons };
}

export function eligibleSavers(savers: SaverInfo[], caps: Capabilities): SaverEligibility[] {
  return savers.map((s) => evaluateSaver(s, caps));
}

/** The savers that are not blocked (ok or degraded). */
export function playableSavers(savers: SaverInfo[], caps: Capabilities): SaverInfo[] {
  return savers.filter((s) => evaluateSaver(s, caps).status !== 'blocked');
}
