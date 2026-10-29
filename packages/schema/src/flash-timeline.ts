/**
 * Flash safety for a timeline's COMBINED effect on the frame.
 *
 * The validator's timeline rule is per path: distinct key times on one path
 * sit at least `minTimelineKeyInterval` (200 ms) apart. That holds one field
 * to 2.5 flashes a second only while each key time is one change. A jump that
 * lands on another key of the same path is two: a step (`dur: 0`) keyed with a
 * glide at the same `t`, every 200 ms, is a full-frame sawtooth at 5 a second
 * that the floor allows — so the counts below weigh those times twice (see
 * `lumaTracks`). Several paths keyed out of step can also combine into a
 * faster flicker. Example: a top layer's opacity choosing
 * between its own colour and the colour of the layer beneath, each of the three
 * keyed at the floor, 67 ms apart, flickers the whole frame 5 times a second.
 * Each path is legal on its own (X589).
 *
 * This resolves the frame where that is possible and runs the WCAG 2.3.1
 * analyzer from `@idle-screens/validator` over it. It is a publish-time check,
 * not part of `validateSpec`, which runs on every viewer mount. It only looks
 * where some one-second window holds enough key boundaries on
 * luminance-bearing paths to reach more than 3 flashes, so almost every scene
 * costs nothing, and it is capped at {@link MAX_TOTAL_SAMPLES} frames.
 *
 * Before sampling a dense window it asks the same question per grid cell:
 * the analyzer fails only when a quarter of its cells flash, and a cell can
 * only flash when the paths that paint IT reach the boundary count. A
 * staggered wave of small static dots is dense across the frame but sparse
 * in every cell, so it passes without a frame resolved (F125 regression).
 *
 * `flashSamplingForecast` takes the same walk and resolves nothing, for a
 * caller that needs to know whether the check would run out of budget (and so
 * refuse) without paying for the frames.
 */
import { analyzeFlashes, srgbToLinear } from '@idle-screens/validator';
import { layerCellFootprints, luminanceGrid } from './perceive';
import { TRANSFORM_FIELDS, transformRangeOf, type TransformField, type TransformRange } from './paint';
import { DEFAULT_KEY_DUR, timelineTracks, withoutTimeline } from './timeline';
import type { LayerTransform, SaverSpec, TimelineKey } from './types';

export interface TimelineFlashReport {
  /** More than 3 flashes in some one-second window over at least a quarter of the frame (WCAG 2.3.1). */
  fails: boolean;
  /** Worst flashes per second any part of the frame reaches (0 when nothing was dense enough to check). */
  flashesPerSecond: number;
  /** Fraction of the frame flashing more than 3 times a second. */
  flashingArea: number;
  /** Start (scene ms, within the lap) of the worst window checked, or null when none was checked. */
  at: number | null;
  /**
   * Set (with `fails`) when dense sections remained beyond the
   * {@link MAX_TOTAL_SAMPLES} budget: unchecked is never reported as safe.
   * `flashesPerSecond` and `flashingArea` then describe only what was checked
   * (often nothing), so a message must say the timeline was too dense to
   * verify, not quote them as a strobe.
   */
  incomplete?: true;
  /** With `incomplete`: the paint-key boundaries in the busiest second of the window left unchecked. */
  boundariesPerSecond?: number;
}

/** Paths whose value changes what a pixel's luminance is (paint), as opposed to where things are. */
const LUMA_PATH = /(^|\.)(opacity|alpha|color|colors|stops|bands|gradient|stroke|fill|background|draw)(\.|$)|(^|\.)(sprite|parts?)$|^layers\.\d+$/;
/** More than 3 flashes is at least 8 reversals; allow one that starts just before the window. */
const MIN_BOUNDARIES = 7;
/** Frames analysed together (one run of the WCAG analyzer). */
export const MAX_SAMPLES = 64;
/** Frames resolved per scene, at most. Past it the report fails closed rather than pass what it did not look at. */
export const MAX_TOTAL_SAMPLES = 512;
const WINDOW = 1000;
/** The grid the analyzer runs over, and the share of its cells that must flash to fail (WCAG 2.3.1's quarter of the frame). */
const COLS = 16;
const ROWS = 9;
const AREA_THRESHOLD = 0.25;

/**
 * Each luminance-bearing path's key boundaries: a step changes at `t`, a
 * glide runs from `t` to `t + dur`. Under `loop`, a second lap so a window
 * can straddle the wrap. `lap` is 0 without `loop`.
 *
 * `jumps` are the times where the path changes twice at once: a jump (a
 * `dur: 0` key, or a `step`-eased key landing at `t + dur`) that falls on
 * another key's boundary on the same path. The value snaps there and glides
 * on from it, so a count of distinct times sees one change where the frame
 * shows two.
 */
function lumaTracks(spec: SaverSpec): { tracks: Array<{ path: string; times: number[]; jumps: number[] }>; lap: number } {
  const tl = spec.timeline;
  if (!tl) return { tracks: [], lap: 0 };
  const lap = tl.loop && tl.duration ? tl.duration : 0;
  const tracks: Array<{ path: string; times: number[]; jumps: number[] }> = [];
  const laps = (ts: number[]): number[] => (lap ? [...ts, ...ts.map((b) => b + lap)] : ts);
  for (const [path, keys] of timelineTracks(spec)) {
    if (!LUMA_PATH.test(path)) continue;
    const bounds: number[] = [];
    const owners = new Map<number, Set<number>>();
    const jumpAt: Array<[number, number]> = [];
    keys.forEach((k, i) => {
      const dur = k.dur ?? DEFAULT_KEY_DUR;
      const own = (t: number): void => { bounds.push(t); owners.set(t, (owners.get(t) ?? new Set()).add(i)); };
      own(k.t);
      if (dur > 0) own(k.t + dur);
      if (dur <= 0) jumpAt.push([k.t, i]);
      else if (k.ease === 'step') jumpAt.push([k.t + dur, i]);
    });
    // Under `loop` the wrap is a boundary too: a key at 0 meets the lap's last glide ending at `lap`.
    const shared = (t: number, i: number): boolean => [...(owners.get(t) ?? []), ...(lap && t === 0 ? owners.get(lap) ?? [] : [])].some((j) => j !== i);
    const jumps = [...new Set(jumpAt.filter(([t, i]) => shared(t, i)).map(([t]) => t))];
    tracks.push({ path, times: laps(bounds), jumps: laps(jumps) });
  }
  return { tracks, lap };
}

/** Distinct boundary times, each weighted by the changes it carries (1, plus 1 where some path jumps on a boundary). */
function weighted(tracks: Array<{ times: number[]; jumps: number[] }>): { times: number[]; weight: (t: number) => number } {
  const extra = new Set(tracks.flatMap((tr) => tr.jumps));
  return { times: [...new Set(tracks.flatMap((tr) => tr.times))].sort((a, b) => a - b), weight: (t) => (extra.has(t) ? 2 : 1) };
}

/** Key boundaries on luminance-bearing paths, sorted and distinct (see `lumaTracks`). */
export function lumaKeyTimes(spec: SaverSpec): { times: number[]; lap: number } {
  const { tracks, lap } = lumaTracks(spec);
  return { times: weighted(tracks).times, lap };
}

/**
 * Leaves that change how a layer's ink looks without moving, resizing or
 * reshaping it, or changing how many seeded draws it takes: opacity, colour,
 * a gradient, a part's fill. `colors` is not one — its length is a draw.
 */
const PAINT_LEAF = /(^|\.)(opacity|alpha|color|fill)(\.\d+)?$|(^|\.)gradient(\.|$)|(^|\.)draw\.(start|end)$/;

/** Eases whose glide stays between its two ends (no overshoot): a keyed transform sweeps no further than its values. */
const MONOTONE_EASES: ReadonlySet<string | undefined> = new Set([undefined, 'step', 'linear', 'smooth', 'in', 'out', 'spring']);

/**
 * Widen `r` to hold every value the keys on `field` (`null`: whole-object
 * keys on the transform itself) glide through, from `base`. False when some
 * key cannot be bounded: an ease that may overshoot, a value that is not a
 * finite number, a field that is not a numeric transform field, or an
 * `origin` change (it moves the pivot).
 */
function widenTransform(r: TransformRange, base: LayerTransform | undefined, field: string | null, keys: TimelineKey[]): boolean {
  const take = (f: TransformField, v: unknown): boolean => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    r[f] = [Math.min(r[f][0], v), Math.max(r[f][1], v)];
    return true;
  };
  for (const k of keys) {
    if (!MONOTONE_EASES.has(k.ease)) return false;
    if (field !== null) {
      if (!(field in TRANSFORM_FIELDS) || !take(field as TransformField, k.value)) return false;
      continue;
    }
    const v = k.value;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const o = v as Record<string, unknown>;
    for (const name of Object.keys(o)) if (name !== 'origin' && !(name in TRANSFORM_FIELDS)) return false;
    if (o.origin !== base?.origin) return false;
    // A glide between two transforms fills a field either side omits with its identity (steer's alignTransform).
    for (const f of Object.keys(TRANSFORM_FIELDS) as TransformField[]) if (!take(f, o[f] ?? TRANSFORM_FIELDS[f])) return false;
  }
  return true;
}

/**
 * Which grid cells each luminance-bearing path can change, or null when some
 * key cannot be pinned to cells. A layer path reaches its layer's footprint; a
 * group path its members'; a background path every cell. A key that moves or
 * resizes a layer makes that layer's footprint the whole grid, and (unless it
 * is a paint `transform`, which takes no draws) every later layer's too: the
 * seeded stream is shared, so a count or a range there re-deals them.
 *
 * Keys on a layer's own `transform`, or its group's, are bounded instead
 * (X681): the footprint becomes everywhere the drawing can be carried while
 * each keyed field ranges over its base and keyed values — a tile turning
 * about its anchor stays in its own cells, an x glide reaches the cells it
 * sweeps. A key it cannot bound keeps the whole grid.
 *
 * Exported for tests only (not from the package index).
 */
export function pathCells(spec: SaverSpec): Map<string, number[] | null> | null {
  const layers = spec.layers ?? [];
  const volatile = new Set<number>();
  const members = (g: string): number[] => layers.flatMap((l, i) => (l.group === g ? [i] : []));
  const reach = new Map<string, number[] | 'all'>();
  // Per keyed transform: the range its fields sweep, or null once some key on it cannot be bounded.
  const layerRanges = new Map<number, TransformRange | null>();
  const groupRanges = new Map<string, TransformRange | null>();
  /** Widen the range for a keyed transform (seeded with its base values); false, and null from then on, when a key cannot be bounded. */
  const bound = <K>(ranges: Map<K, TransformRange | null>, id: K, base: LayerTransform | undefined, rest: string[], keys: TimelineKey[]): boolean => {
    if (rest.length > 2) return false;
    if (!ranges.has(id)) ranges.set(id, transformRangeOf(base));
    const r = ranges.get(id);
    if (!r || !widenTransform(r, base, rest[1] ?? null, keys)) {
      ranges.set(id, null);
      return false;
    }
    return true;
  };
  for (const [path, keys] of timelineTracks(spec)) {
    const [root, id, ...rest] = path.split('.');
    const leaf = rest.join('.');
    let to: number[] | 'all';
    if (root === 'layers' && /^\d+$/.test(id ?? '')) {
      const n = Number(id);
      to = [n];
      if (!PAINT_LEAF.test(leaf)) {
        if (rest[0] === 'transform') {
          if (!bound(layerRanges, n, layers[n]?.transform, rest, keys)) volatile.add(n);
        } else for (let i = n; i < layers.length; i++) volatile.add(i);
      }
    } else if (root === 'groups' && id !== undefined) {
      to = members(id);
      if (leaf !== 'opacity' && !(rest[0] === 'transform' && bound(groupRanges, id, spec.groups?.[id]?.transform, rest, keys))) for (const i of to) volatile.add(i);
    } else if (root === 'background') to = 'all';
    else return null; // a scene-wide field: no cell is safe from it
    if (LUMA_PATH.test(path)) reach.set(path, to);
  }
  if (reach.size === 0) return new Map();
  // A range that went unbounded after an earlier key bounded it: its layers reach every cell.
  for (const [n, r] of layerRanges) if (!r) volatile.add(n);
  for (const [g, r] of groupRanges) if (!r) for (const i of members(g)) volatile.add(i);
  const sweep = new Map<number, { layer?: TransformRange; group?: TransformRange }>();
  layers.forEach((l, i) => {
    const own = layerRanges.get(i) ?? undefined;
    const grp = l.group !== undefined && spec.groups?.[l.group] ? groupRanges.get(l.group) ?? undefined : undefined;
    if (own || grp) sweep.set(i, { layer: own, group: grp });
  });
  const footprints = layerCellFootprints(withoutTimeline(spec), { cols: COLS, rows: ROWS }, sweep);
  const out = new Map<string, number[] | null>();
  for (const [path, to] of reach) {
    if (to === 'all' || to.some((i) => volatile.has(i) || !footprints[i])) out.set(path, null);
    else out.set(path, [...new Set(to.flatMap((i) => footprints[i]!))]);
  }
  return out;
}

/**
 * Grid cells that could flash more than 3 times a second inside `[from, to]`:
 * a cell's luminance changes only at the boundaries of the paths that paint it
 * and runs one way between them (the premise the sampling already rests on),
 * so it needs {@link MIN_BOUNDARIES} of them within a second (2 ms of slack
 * for the ±1 ms samples). Paths with no cells reach every cell.
 */
function cellsThatCanFlash(tracks: Array<{ path: string; times: number[]; jumps: number[] }>, cellsOf: Map<string, number[] | null>, from: number, to: number): number {
  const perCell: Array<Array<{ times: number[]; jumps: number[] }>> = Array.from({ length: COLS * ROWS }, () => []);
  for (const tr of tracks) {
    const ts = tr.times.filter((t) => t >= from && t <= to);
    if (ts.length === 0) continue;
    const part = { times: ts, jumps: tr.jumps };
    const cells = cellsOf.get(tr.path);
    if (cells === null || cells === undefined) for (const list of perCell) list.push(part);
    else for (const c of cells) perCell[c]!.push(part);
  }
  let n = 0;
  for (const parts of perCell) {
    if (parts.length === 0) continue;
    const { times: ts, weight } = weighted(parts);
    if (denseRun(ts, weight, WINDOW + 2) !== null) n++;
  }
  return n;
}

/**
 * The first run of times inside `span` whose weights reach
 * {@link MIN_BOUNDARIES}, as [first index, end index), or null.
 */
function denseRun(ts: number[], weight: (t: number) => number, span: number): [number, number] | null {
  let sum = 0;
  for (let i = 0, e = 0; i < ts.length; i++) {
    while (e < ts.length && ts[e]! - ts[i]! <= span) sum += weight(ts[e++]!);
    if (sum >= MIN_BOUNDARIES) return [i, e];
    sum -= weight(ts[i]!);
  }
  return null;
}

/**
 * Just before and just after every boundary (a step key changes at its exact
 * time), plus the middle of each gap (a glide's midpoint): enough to see each
 * reversal, never every frame.
 */
export function flashSampleTimes(boundaries: number[]): number[] {
  const ts = new Set<number>();
  boundaries.forEach((t, i) => {
    ts.add(t - 1);
    ts.add(t + 1);
    const next = boundaries[i + 1];
    if (next !== undefined && next - t > 4) ts.add((t + next) / 2);
  });
  return [...ts].sort((a, b) => a - b);
}

/** One chunk of frames the flash check resolves together, from the walk both {@link timelineFlashReport} and {@link flashSamplingForecast} take. */
interface SampleChunk {
  /** Scene times to resolve (2 to {@link MAX_SAMPLES} of them). */
  times: number[];
  /** The dense window's start, within the lap. */
  at: number;
  /** Paint-key changes in the window's busiest second. */
  n: number;
  /** Past the {@link MAX_TOTAL_SAMPLES} budget: this chunk, and every one after it, would not be resolved. */
  over: boolean;
}

/**
 * The flash check's walk, without drawing: the dense windows (by changes,
 * densest first), each kept only where enough cells can flash for a quarter
 * of the frame to, cut into chunks of sample times that overlap by a full
 * {@link WINDOW}. The only place the sample budget is kept. Draws nothing:
 * the report resolves the frames of each chunk it is handed.
 */
function* flashSampleChunks(spec: SaverSpec): Generator<SampleChunk> {
  if (!spec.timeline) return;
  const { tracks, lap } = lumaTracks(spec);
  const { times, weight } = weighted(tracks);

  // Dense windows (by changes, not distinct times), densest first, merged where they overlap.
  const dense: Array<{ from: number; to: number; n: number }> = [];
  for (let i = 0, e = 0, sum = 0; i < times.length; i++) {
    while (e < times.length && times[e]! < times[i]! + WINDOW) sum += weight(times[e++]!);
    if (sum >= MIN_BOUNDARIES) {
      const last = dense[dense.length - 1];
      if (last && times[i]! <= last.to) {
        last.to = Math.max(last.to, times[e - 1]!);
        last.n = Math.max(last.n, sum);
      } else dense.push({ from: times[i]!, to: times[e - 1]!, n: sum });
    }
    sum -= weight(times[i]!);
  }
  if (dense.length === 0) return;
  dense.sort((a, b) => b.n - a.n);

  let budget = MAX_TOTAL_SAMPLES;
  let over = false;
  const cellsOf = pathCells(spec);
  for (const w of dense) {
    // Too few cells can flash here for a quarter of the frame to: nothing to resolve.
    if (cellsOf && cellsThatCanFlash(tracks, cellsOf, w.from, w.to) < Math.ceil(AREA_THRESHOLD * COLS * ROWS)) continue;
    const at = lap ? w.from % lap : w.from;
    const sampleTimes = flashSampleTimes(times.filter((t) => t >= w.from && t <= w.to));
    // Consecutive chunks share a full WINDOW of time, not a fixed sample count,
    // so a burst straddling a chunk edge is analysed whole however dense the keys.
    for (let from = 0; from < sampleTimes.length - 1; ) {
      const chunk = sampleTimes.slice(from, from + MAX_SAMPLES);
      if (chunk.length < 2) break;
      if (chunk.length > budget) over = true;
      if (!over) budget -= chunk.length;
      yield { times: chunk, at, n: w.n, over };
      if (from + MAX_SAMPLES >= sampleTimes.length) break;
      const resume = chunk[chunk.length - 1]! - WINDOW;
      let next = from + 1;
      while (sampleTimes[next]! < resume) next++;
      from = next;
    }
  }
}

const PASS: Readonly<TimelineFlashReport> = { fails: false, flashesPerSecond: 0, flashingArea: 0, at: null };

/** The fail-closed report for a walk that ran past the budget at `c`, after `worst` was checked. */
const failClosed = (worst: TimelineFlashReport, c: SampleChunk): TimelineFlashReport =>
  ({ ...worst, fails: true, at: c.at, incomplete: true, boundariesPerSecond: c.n });

export function timelineFlashReport(spec: SaverSpec): TimelineFlashReport {
  let worst: TimelineFlashReport = { ...PASS };
  for (const c of flashSampleChunks(spec)) {
    if (c.over) return failClosed(worst, c);
    // The grid carries gamma-encoded luma; WCAG flashes are measured in linear light (exact for greys, close for chroma).
    const samples = c.times.map((t) => ({ t, lum: luminanceGrid(spec, { t, cols: COLS, rows: ROWS }).cells.flat().map((v) => srgbToLinear(v * 255)) }));
    const r = analyzeFlashes(samples);
    if (r.general.worstTileFlashesPerSecond > worst.flashesPerSecond || (!worst.fails && r.general.fails)) {
      worst = {
        fails: r.general.fails,
        flashesPerSecond: r.general.worstTileFlashesPerSecond,
        flashingArea: r.general.flashingAreaFraction,
        at: c.at,
      };
    }
    if (worst.fails) return worst;
  }
  return worst;
}

export interface FlashSamplingForecast {
  /**
   * The check would run out of frames to resolve. {@link timelineFlashReport}
   * is then certain to fail: with `incomplete` at this `at` and
   * `boundariesPerSecond`, unless it finds a flash in the frames it does
   * resolve first. False means it is never `incomplete`, and its verdict
   * turns on the pixels.
   */
  exhausted: boolean;
  /** With `exhausted`: start (scene ms, within the lap) of the window the budget runs out in; otherwise null. */
  at: number | null;
  /** With `exhausted`: paint-key changes in that window's busiest second. */
  boundariesPerSecond?: number;
  /** Frames the check resolves if it finds no flash: at most `budget`. */
  samples: number;
  /** Frames the whole walk would take with no budget (more than `budget` exactly when `exhausted`). */
  needed: number;
  /** The check's frame budget ({@link MAX_TOTAL_SAMPLES}). */
  budget: number;
  /**
   * The report {@link timelineFlashReport} returns if it finds no flash: the
   * pass, or the fail-closed `incomplete` one (its `flashesPerSecond` and
   * `flashingArea` are 0 here; the real report carries whatever it checked).
   */
  report: TimelineFlashReport;
}

/**
 * {@link timelineFlashReport}'s sampling plan, with no frame resolved: the
 * same dense windows, per-cell pre-check and budgeted walk, so whether the
 * check will run out of budget is known for the cost of the arithmetic. A
 * caller that cannot afford the full check (it resolves up to
 * {@link MAX_TOTAL_SAMPLES} luminance grids) can refuse `exhausted` scenes
 * outright: publishing refuses them too.
 */
export function flashSamplingForecast(spec: SaverSpec): FlashSamplingForecast {
  let samples = 0;
  let needed = 0;
  let first: SampleChunk | undefined;
  for (const c of flashSampleChunks(spec)) {
    needed += c.times.length;
    if (!c.over) samples += c.times.length;
    else first ??= c;
  }
  const base = { samples, needed, budget: MAX_TOTAL_SAMPLES };
  if (!first) return { exhausted: false, at: null, ...base, report: { ...PASS } };
  return { exhausted: true, at: first.at, boundariesPerSecond: first.n, ...base, report: failClosed({ ...PASS }, first) };
}
