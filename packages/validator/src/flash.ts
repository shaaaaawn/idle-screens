/**
 * WCAG 2.3.1 (general flash) + an approximate red-flash check, computed PER TILE so a
 * localized strobe cannot be masked by whole-frame averaging.
 *
 * Definitions used (general flash, per WCAG "Three Flashes or Below Threshold"):
 *  - A *transition* is a maximal monotonic change in relative luminance of >= 0.10
 *    where the darker of the two levels is < 0.80.
 *  - A *flash* is a PAIR of opposing transitions. In any sliding 1-second window,
 *    flashes = floor(transitions / 2) (pairing removes the phase-dependent off-by-one
 *    that plain transition-counting suffers).
 *  - Content fails if MORE THAN 3 flashes occur in any 1-second window, over a flashing
 *    area at least `areaThreshold` of the frame (full-screen savers get no small-area
 *    exemption; a tiny sparkle below the area threshold is allowed).
 *
 * Red flash reuses the same machinery on an APPROXIMATE saturated-red signal (see
 * luminance.redness) — a red-flash failure here means "needs a closer look", not a
 * normative WCAG red-flash determination.
 */

export interface FlashSample {
  /** milliseconds from start; must be non-decreasing. */
  t: number;
  /** per-tile relative luminance (row-major, same length every sample). */
  lum: number[];
  /** per-tile redness (optional). */
  red?: number[];
}

export interface FlashOptions {
  /** Min opposing luminance swing to count a transition. Default 0.10 (WCAG). */
  swingThreshold?: number;
  /** A transition only counts if the darker level is below this. Default 0.80 (WCAG). */
  darkMax?: number;
  /** Fail above this many flashes in any 1-s window. Default 3 (WCAG). */
  maxFlashesPerSecond?: number;
  /** Fraction of the frame that must flash to fail. Default 0.25. */
  areaThreshold?: number;
  /** Min opposing redness swing for the approximate red-flash check. Default 0.20. */
  redSwingThreshold?: number;
}

export interface ChannelReport {
  fails: boolean;
  /** worst single tile's max flashes-per-second (for visibility even when passing). */
  worstTileFlashesPerSecond: number;
  /** fraction of tiles that exceed the flash limit. */
  flashingAreaFraction: number;
}

export interface FlashReport {
  passes: boolean;
  fps: number;
  tiles: number;
  samples: number;
  durationMs: number;
  maxFlashesPerSecond: number;
  areaThreshold: number;
  general: ChannelReport;
  /** Approximate — NOT a normative WCAG red-flash determination. */
  red: ChannelReport & { approximate: true };
}

/** Timestamps of qualifying opposing transitions in one tile's luminance series. */
function transitionTimes(series: number[], times: number[], swing: number, darkMax: number): number[] {
  const out: number[] = [];
  let dir = 0; // 0 = no direction yet, +1 rising, -1 falling
  let extreme = series[0]; // last registered peak/valley
  for (let i = 1; i < series.length; i++) {
    const l = series[i];
    if (dir === 0) {
      const d = l - extreme;
      if (Math.abs(d) >= swing && Math.min(l, extreme) < darkMax) {
        dir = d > 0 ? 1 : -1;
        out.push(times[i]);
        extreme = l;
      }
      // else: still searching for the first move; `extreme` stays the anchor
    } else if ((l - extreme) * dir >= 0) {
      // still moving in the current direction (or flat): extend the extreme
      extreme = l;
    } else {
      // moving opposite to `dir`
      const d = l - extreme; // opposite sign to dir
      if (Math.abs(d) >= swing && Math.min(l, extreme) < darkMax) {
        dir = -dir;
        out.push(times[i]);
        extreme = l;
      }
    }
  }
  return out;
}

/** Max flashes in any sliding 1-second window: floor(maxTransitionsInWindow / 2). */
function maxFlashesPerSecond(transitions: number[]): number {
  let best = 0;
  let e = 0;
  for (let s = 0; s < transitions.length; s++) {
    if (e < s) e = s;
    while (e < transitions.length && transitions[e] < transitions[s] + 1000) e++;
    const count = e - s;
    const flashes = Math.floor(count / 2);
    if (flashes > best) best = flashes;
  }
  return best;
}

function analyzeChannel(
  samples: FlashSample[],
  pick: (s: FlashSample) => number[] | undefined,
  swing: number,
  darkMax: number,
  limit: number,
  areaThreshold: number,
): ChannelReport {
  const times = samples.map((s) => s.t);
  const first = pick(samples[0]);
  if (!first) return { fails: false, worstTileFlashesPerSecond: 0, flashingAreaFraction: 0 };
  const tiles = first.length;
  let worst = 0;
  let dangerous = 0;
  const series = new Array<number>(samples.length);
  for (let tile = 0; tile < tiles; tile++) {
    for (let i = 0; i < samples.length; i++) {
      const arr = pick(samples[i]);
      series[i] = arr ? arr[tile] : 0;
    }
    const fps = maxFlashesPerSecond(transitionTimes(series, times, swing, darkMax));
    if (fps > worst) worst = fps;
    if (fps > limit) dangerous++;
  }
  const flashingAreaFraction = tiles > 0 ? dangerous / tiles : 0;
  return {
    fails: flashingAreaFraction >= areaThreshold,
    worstTileFlashesPerSecond: worst,
    flashingAreaFraction,
  };
}

/** Analyze a per-tile luminance timeline for WCAG 2.3.1 flash safety. */
export function analyzeFlashes(samples: FlashSample[], opts: FlashOptions = {}): FlashReport {
  const swing = opts.swingThreshold ?? 0.1;
  const darkMax = opts.darkMax ?? 0.8;
  const limit = opts.maxFlashesPerSecond ?? 3;
  const areaThreshold = opts.areaThreshold ?? 0.25;
  const redSwing = opts.redSwingThreshold ?? 0.2;

  const tiles = samples[0]?.lum.length ?? 0;
  const durationMs = samples.length > 1 ? samples[samples.length - 1].t - samples[0].t : 0;
  const fps = durationMs > 0 ? ((samples.length - 1) / durationMs) * 1000 : 0;

  const general = analyzeChannel(samples, (s) => s.lum, swing, darkMax, limit, areaThreshold);
  const redBase = analyzeChannel(samples, (s) => s.red, redSwing, 1.1, limit, areaThreshold);
  const red = { ...redBase, approximate: true as const };

  return {
    passes: !general.fails && !red.fails,
    fps,
    tiles,
    samples: samples.length,
    durationMs,
    maxFlashesPerSecond: limit,
    areaThreshold,
    general,
    red,
  };
}
