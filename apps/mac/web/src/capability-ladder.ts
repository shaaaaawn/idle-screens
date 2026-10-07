/**
 * What this device should be asked to render.
 *
 * The native hosts (Mac menu-bar app, Linux Wayland overlay) point a WebView at
 * this page and, until now, it mounted whatever saver was next in the list.
 * That is fine on a laptop and wrong on a Raspberry Pi: Mesa V3D advertises
 * WebGL2, so `detectCapabilities()` reports tier "standard" and metaquarium gets
 * mounted on a box that renders it at a crawl.
 *
 * tvOS already solved this (`apps/ios/IdleScreens/Render/CapabilityTier.swift`)
 * and the split it makes is the part worth copying: one axis decides WHICH
 * renderer/saver you may use, a separate axis sizes the budgets. We cannot copy
 * its t0–t3 ladder literally — there is one renderer here, the WebView, and it
 * renders strictly more than the tvOS native subset — so the equivalent is:
 *
 *   1. preflight gating (this module): drop savers the device cannot afford,
 *      honouring a ceiling the native host declares;
 *   2. runtime step-down (`frame-watchdog.ts`): when frames overrun anyway,
 *      move to something cheaper rather than keeping a slideshow on screen.
 *
 * Everything here is pure and takes `Capabilities` as input. Detection touches
 * canvas/navigator and so lives at the edge in `main.ts`, which also keeps this
 * unit-testable under vitest's node environment.
 */
import type { Capabilities, SaverInfo } from '@idle-screens/capabilities';
import { computeTier, costBudget, evaluateSaver } from '@idle-screens/capabilities';

/** Weakest → strongest. Mirrors `Backend` in @idle-screens/capabilities. */
const BACKEND_ORDER = ['css', 'canvas2d', 'webgl2', 'webgpu'] as const;
export type BackendName = (typeof BACKEND_ORDER)[number];

export function isBackendName(value: string): value is BackendName {
  return (BACKEND_ORDER as readonly string[]).includes(value);
}

/**
 * Clamp what the page believes the device can do down to a ceiling the native
 * host declares (`?maxBackend=canvas2d`).
 *
 * This exists because feature detection cannot see a *weak* GPU — only a
 * missing one. A Pi 5 answers "yes" to WebGL2 truthfully and still cannot drive
 * three.js at fullscreen. The host knows what box it is on (Linux reads
 * /proc/device-tree, Mac reads hw.model) and that knowledge has to reach the
 * page somehow; a URL parameter is the channel both hosts already use for
 * seed/saver/cycle/brightness.
 *
 * Clamping the *capabilities* rather than passing a tier around is deliberate:
 * tier, cost budget and per-saver eligibility are all derived from this object,
 * so one honest statement ("treat canvas2d as this device's best backend")
 * propagates correctly through all three without duplicating the policy.
 */
export function clampCapabilities(caps: Capabilities, ceiling: BackendName | null): Capabilities {
  if (!ceiling) return caps;
  const max = BACKEND_ORDER.indexOf(ceiling);
  const allowed = (name: BackendName): boolean => BACKEND_ORDER.indexOf(name) <= max;
  return {
    ...caps,
    backends: {
      ...caps.backends,
      canvas2d: caps.backends.canvas2d && allowed('canvas2d'),
      webgl2: caps.backends.webgl2 && allowed('webgl2'),
      webgpu: caps.backends.webgpu && allowed('webgpu'),
    },
  };
}

export interface GateResult<T> {
  /**
   * Savers to offer, in the original order. Empty only when every saver is
   * blocked by a hard requirement (missing backend, reduced-motion hide).
   */
  playable: readonly T[];
  /** Dropped savers with the reason, for the log. */
  blocked: readonly { id: string; reasons: readonly string[] }[];
  tier: ReturnType<typeof computeTier>;
  budget: ReturnType<typeof costBudget>;
  /**
   * True when the cost budget alone would have left nothing and we kept the
   * cheapest saver anyway. A screensaver that renders nothing is worse than one
   * that renders badly, so the ladder has a floor — but only for cost.
   */
  fallback: boolean;
}

/**
 * Split savers into what this device should be offered and what it should not.
 *
 * A `SaverManifest` is structurally a `SaverInfo` (same optional minBackend /
 * costTier / motionIntensity / reducedMotionFallback fields), so manifests pass
 * straight to `evaluateSaver` with no adapter. 21 of the classic savers already
 * declare these, which is what makes gating meaningful rather than theoretical.
 */
export function gateSavers<T extends { manifest: SaverInfo }>(
  savers: readonly T[],
  caps: Capabilities,
): GateResult<T> {
  const tier = computeTier(caps);
  const budget = costBudget(tier);
  const playable: T[] = [];
  const blocked: { id: string; reasons: readonly string[] }[] = [];

  for (const saver of savers) {
    const verdict = evaluateSaver(saver.manifest, caps);
    // 'degraded' still runs — it is the manifest's own declared reduced form,
    // and dropping it would override an accessibility intent, not respect it.
    if (verdict.status === 'blocked') blocked.push({ id: verdict.id, reasons: verdict.reasons });
    else playable.push(saver);
  }

  if (playable.length === 0 && savers.length > 0) {
    // Only a saver blocked purely on the cost budget may be kept anyway: that is
    // a judgement about speed, and the watchdog covers it. A missing backend
    // cannot mount at all, and a reduced-motion `hide` is an accessibility
    // choice — overriding either would trade a slow screen for a broken one.
    const costOnly = savers.filter((s) => {
      const b = blocked.find((x) => x.id === s.manifest.id);
      return b !== undefined && b.reasons.every((r) => r.startsWith('cost '));
    });
    if (costOnly.length > 0) {
      const cheapest = cheapestSaver(costOnly);
      return {
        playable: [cheapest],
        // The kept saver is playable, so it is not reported as skipped.
        blocked: blocked.filter((b) => b.id !== cheapest.manifest.id),
        tier,
        budget,
        fallback: true,
      };
    }
  }
  return { playable, blocked, tier, budget, fallback: false };
}

/** Lowest declared cost, then weakest required backend. Stable on ties. */
function cheapestSaver<T extends { manifest: SaverInfo }>(savers: readonly T[]): T {
  const costRank = (s: SaverInfo): number =>
    ['idle', 'low', 'medium', 'high'].indexOf(s.costTier ?? 'idle');
  const backendRank = (s: SaverInfo): number => BACKEND_ORDER.indexOf(s.minBackend ?? 'css');
  return savers.reduce((best, s) => {
    const d = costRank(s.manifest) - costRank(best.manifest);
    if (d !== 0) return d < 0 ? s : best;
    return backendRank(s.manifest) < backendRank(best.manifest) ? s : best;
  });
}

/**
 * Synchronous capability probe.
 *
 * `detectCapabilities()` from @idle-screens/capabilities is async purely because
 * it awaits `navigator.gpu.requestAdapter()`. The host page is built as an IIFE
 * so it can run from `file://`, which rules out top-level await, and making the
 * whole startup async to learn one boolean would restructure main.ts for little
 * gain. So: probe the three synchronous backends honestly and treat WebGPU as
 * present when `navigator.gpu` exists.
 *
 * That last part can overclaim — the object can exist while `requestAdapter()`
 * returns null. It is safe here because gating only ever *blocks* on a missing
 * backend: an over-offered WebGPU saver fails at mount, and `mountSaver`'s
 * existing `skipOnFail` moves to the next one. Performance problems, which a
 * capability probe cannot see at all, are the frame watchdog's job.
 */
export function probeCapabilitiesSync(): Capabilities {
  const canGet = (kind: '2d' | 'webgl2'): boolean => {
    try {
      return document.createElement('canvas').getContext(kind) !== null;
    } catch {
      return false;
    }
  };
  return {
    backends: {
      css: true,
      canvas2d: canGet('2d'),
      webgl2: canGet('webgl2'),
      webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
    },
    reducedMotion:
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  } as Capabilities;
}
