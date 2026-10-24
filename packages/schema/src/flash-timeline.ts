/**
 * Flash safety for a timeline's COMBINED effect on the frame.
 *
 * The validator's timeline rule is per path: distinct key times on one path
 * sit at least `minTimelineKeyInterval` (200 ms) apart, so no single field can
 * strobe faster than 2.5 flashes a second. Several paths keyed out of step can
 * still combine into a faster flicker. Example: a top layer's opacity choosing
 * between its own colour and the colour of the layer beneath, each of the three
 * keyed at the floor, 67 ms apart, flickers the whole frame 5 times a second.
 * Each path is legal on its own (X589).
 *
 * This resolves the frame where that is possible and runs the WCAG 2.3.1
 * analyzer from `@idle-screens/validator` over it. It is a publish-time check,
 * not part of `validateSpec`, which runs on every viewer mount. It only looks
 * where some one-second window holds enough key boundaries on
 * luminance-bearing paths to reach more than 3 flashes, so almost every scene
 * costs nothing, and it is capped at {@link MAX_SAMPLES} frames.
 */
import { analyzeFlashes, srgbToLinear } from '@idle-screens/validator';
import { luminanceGrid } from './perceive';
import { DEFAULT_KEY_DUR, timelineTracks } from './timeline';
import type { SaverSpec } from './types';

export interface TimelineFlashReport {
  /** More than 3 flashes in some one-second window over at least a quarter of the frame (WCAG 2.3.1). */
  fails: boolean;
  /** Worst flashes per second any part of the frame reaches (0 when nothing was dense enough to check). */
  flashesPerSecond: number;
  /** Fraction of the frame flashing more than 3 times a second. */
  flashingArea: number;
  /** Start (scene ms, within the lap) of the worst window checked, or null when none was checked. */
  at: number | null;
  /** Set (with `fails`) when dense sections remained beyond the {@link MAX_TOTAL_SAMPLES} budget: unchecked is never reported as safe. */
  incomplete?: true;
}

/** Paths whose value changes what a pixel's luminance is (paint), as opposed to where things are. */
const LUMA_PATH = /(^|\.)(opacity|alpha|color|colors|stops|bands|gradient|stroke|fill|background)(\.|$)|(^|\.)(sprite|parts?)$|^layers\.\d+$/;
/** More than 3 flashes is at least 8 reversals; allow one that starts just before the window. */
const MIN_BOUNDARIES = 7;
/** Frames analysed together (one run of the WCAG analyzer). */
export const MAX_SAMPLES = 64;
/** Frames resolved per scene, at most. Past it the report fails closed rather than pass what it did not look at. */
export const MAX_TOTAL_SAMPLES = 512;
/** Frames shared between consecutive chunks so a flash straddling a chunk edge is still seen. */
const OVERLAP = 8;
const WINDOW = 1000;

export function timelineFlashReport(spec: SaverSpec): TimelineFlashReport {
  const pass: TimelineFlashReport = { fails: false, flashesPerSecond: 0, flashingArea: 0, at: null };
  const tl = spec.timeline;
  if (!tl) return pass;
  const lap = tl.loop && tl.duration ? tl.duration : 0;

  // Key boundaries on luminance-bearing paths: a step changes at `t`, a glide
  // runs from `t` to `t + dur`. Under `loop`, a second lap so a window can
  // straddle the wrap.
  const bounds: number[] = [];
  for (const [path, keys] of timelineTracks(spec)) {
    if (!LUMA_PATH.test(path)) continue;
    for (const k of keys) {
      const dur = k.dur ?? DEFAULT_KEY_DUR;
      bounds.push(k.t);
      if (dur > 0) bounds.push(k.t + dur);
    }
  }
  const times = [...new Set(lap ? [...bounds, ...bounds.map((b) => b + lap)] : bounds)].sort((a, b) => a - b);

  // Dense windows, densest first, merged where they overlap.
  const dense: Array<{ from: number; to: number; n: number }> = [];
  for (let i = 0, e = 0; i < times.length; i++) {
    while (e < times.length && times[e]! < times[i]! + WINDOW) e++;
    if (e - i < MIN_BOUNDARIES) continue;
    const last = dense[dense.length - 1];
    if (last && times[i]! <= last.to) {
      last.to = Math.max(last.to, times[e - 1]!);
      last.n = Math.max(last.n, e - i);
    } else dense.push({ from: times[i]!, to: times[e - 1]!, n: e - i });
  }
  if (dense.length === 0) return pass;
  dense.sort((a, b) => b.n - a.n);

  let budget = MAX_TOTAL_SAMPLES;
  let worst = pass;
  for (const w of dense) {
    // Just before and just after every boundary in the window (a step key
    // changes at its exact time), plus the middle of each gap (a glide's
    // midpoint): enough to see each reversal, never every frame.
    const inWindow = times.filter((t) => t >= w.from && t <= w.to);
    const ts = new Set<number>();
    inWindow.forEach((t, i) => {
      ts.add(t - 1);
      ts.add(t + 1);
      const next = inWindow[i + 1];
      if (next !== undefined && next - t > 4) ts.add((t + next) / 2);
    });
    const sampleTimes = [...ts].sort((a, b) => a - b);
    for (let from = 0; from < sampleTimes.length - 1; from += MAX_SAMPLES - OVERLAP) {
      const chunk = sampleTimes.slice(from, from + MAX_SAMPLES);
      if (chunk.length < 2) break;
      if (chunk.length > budget) return { ...worst, fails: true, at: lap ? w.from % lap : w.from, incomplete: true };
      budget -= chunk.length;
      // The grid carries gamma-encoded luma; WCAG flashes are measured in linear light (exact for greys, close for chroma).
      const samples = chunk.map((t) => ({ t, lum: luminanceGrid(spec, { t, cols: 16, rows: 9 }).cells.flat().map((v) => srgbToLinear(v * 255)) }));
      const r = analyzeFlashes(samples);
      if (r.general.worstTileFlashesPerSecond > worst.flashesPerSecond || (!worst.fails && r.general.fails)) {
        worst = {
          fails: r.general.fails,
          flashesPerSecond: r.general.worstTileFlashesPerSecond,
          flashingArea: r.general.flashingAreaFraction,
          at: lap ? w.from % lap : w.from,
        };
      }
      if (worst.fails) return worst;
      if (from + MAX_SAMPLES >= sampleTimes.length) break;
    }
  }
  return worst;
}
