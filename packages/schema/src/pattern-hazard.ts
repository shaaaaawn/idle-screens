/**
 * Spatial-pattern photosensitivity: regular stripes, gratings and grids.
 *
 * WCAG 2.3.1 covers flashes only, and the flash checks here implement it on a
 * 16×9 tile grid. A tile's mean stays flat under a fine grating, still or
 * turning, so a frame-filling field of high-contrast lines passes every flash
 * check while being the kind of image that provokes pattern-sensitive
 * seizures. ITU-R BT.1702-3 (Annex 1) has a separate rule for it, which this
 * implements:
 *
 *   - a pattern is potentially harmful when it has MORE THAN FIVE light-dark
 *     pairs of discernible stripes, in any orientation: parallel or radial,
 *     straight or curved, or rows of repeated elements such as dots;
 *   - the stripes are discernible when light and dark differ at flash level
 *     (the WCAG pair: a swing of at least 0.1 relative luminance with the
 *     darker side below 0.8, the validator's own constants);
 *   - it is harmful when it covers more than 40 % of the screen while it
 *     stays still, or more than 25 % when it moves, oscillates, rotates,
 *     flashes or reverses;
 *   - a pattern flowing smoothly one way across, into or out of the screen
 *     is exempt from the moving rule. Here it is judged as a still pattern
 *     (40 %) instead of being exempt, and its forecast flicker is checked:
 *     stripes crossing a point at f = v⊥ / pitch flicker it, and more than
 *     3 a second over 25 % of the frame is a flash hazard.
 *
 * Method. The scene is drawn by the analytic perception raster
 * (`luminanceGrid`) at {@link PATTERN_GRID_SHORT_SIDE} cells on the short
 * side — about 5 px per cell at 1080p — and converted to linear light. Every
 * row and column is scanned for alternating light/dark extrema with the flash
 * swing as hysteresis. A run of at least {@link PATTERN_MIN_PAIRS} light (or
 * dark) stripes whose spacing changes by no more than a third (plus a cell
 * of sampling slack) from one stripe to the next is a stripe run: a radial
 * or perspective pattern still counts, a random starfield does not. Runs on
 * scan lines up to a pitch apart, overlapping and of the same pitch, form a
 * patch, which is a pattern when it reaches {@link PATTERN_MIN_EXTENT}
 * pitches across its stripes (a grating's lines, a dot lattice's rows; not a
 * single row of objects) and its pitch, measured square to the stripes, is
 * at most {@link PATTERN_MAX_PITCH} of the short side. The pattern's area is
 * the union of its runs, widened by half a pitch on each side, on a grid of
 * 4×4-cell blocks.
 *
 * Motion is read from the spec: a layer spins, rocks, orbits, bounces,
 * wanders, follows a path, pulses, grows, emits, cycles or is keyed by the
 * timeline (moving), or it drifts or rises one way (flow), or it stays put.
 * When the whole-scene pattern lands between the two area limits, the moving
 * layers are drawn on their own over flat ground to measure the moving
 * pattern, and the next 60 fps frame measures the flicker: per four
 * stripe periods, mean |ΔL / Δt| over twice the stripe contrast is the
 * frequency at which the stripes cross a point (exact for a sine or a square
 * grating; fast enough motion only reads higher, never lower).
 *
 * Deliberate limits, stated so nothing claims more than this checks:
 *   - Text (`text`, `textBlock`) is left out. The raster draws a text box as
 *     a block of averaged ink, so lines of copy would read as bars; glyph
 *     shapes themselves are not analysed. Emoji are kept.
 *   - Stripes finer than about 8 px at 1080p (1/135 of the short side) are
 *     not reliably resolved: the raster's area averaging takes their
 *     contrast, and under two cells they average to grey. Stripes coarser
 *     than {@link PATTERN_MAX_PITCH} are not counted. `pattern-hazard.test.ts`
 *     pins the measured floor (8 px, at 0, 30, 45 and 88 degrees).
 *   - `ghosting` is removed before drawing (its smear only lowers contrast),
 *     so a smeared pattern is judged at full contrast: conservative.
 *   - The scene is sampled at t = 5 s and at up to
 *     {@link PATTERN_MAX_SAMPLE_TIMES} − 1 points where timeline keys
 *     settle; past that cap the settle times are subsampled evenly. A
 *     pattern that exists only between those instants is not seen.
 *   - One viewport (1920×1080 by default). Pass another to check a portrait
 *     or ultra-wide screen.
 *   - The flicker forecast reads a 60 fps screen: stripes moving a whole
 *     pitch (or a multiple) per frame look still on it and are not counted.
 *
 * It is a publish-time check like `timelineFlashReport`: not part of
 * `validateSpec` or `compileSaver`, which run on every viewer mount. One
 * check draws 1 to 3 rasters per sample time.
 */
import { FLASH_DARK_MAX, FLASH_MAX_PER_SECOND, FLASH_SWING_THRESHOLD, srgbToLinear } from '@idle-screens/validator';
import { luminanceGrid } from './perceive';
import { DEFAULT_KEY_DUR, resolveTimelineAt, timelineTracks } from './timeline';
import type { LayerSpec, SaverSpec } from './types';

/** Raster cells across the viewport's short side. */
export const PATTERN_GRID_SHORT_SIDE = 216;
/** Cap on the long side (an ultra-wide viewport gets wider cells rather than more of them). */
const PATTERN_GRID_MAX_SIDE = 400;
/** "More than five light-dark pairs": six stripes of one tone, each between stripes of the other. */
export const PATTERN_MIN_PAIRS = 6;
/** A still pattern is harmful above this fraction of the screen. */
export const PATTERN_STATIONARY_AREA = 0.4;
/** A moving, oscillating, rotating or reversing pattern is harmful above this fraction. */
export const PATTERN_MOVING_AREA = 0.25;
/** Forecast flicker above {@link FLASH_MAX_PER_SECOND} a second over this fraction fails. */
export const PATTERN_FLICKER_AREA = 0.25;
/** Most sample times one check draws (t = 5 s plus timeline settle points). */
export const PATTERN_MAX_SAMPLE_TIMES = 6;
/** Consecutive stripe periods may differ by at most this ratio (radial and perspective patterns change gradually). */
const PERIOD_RATIO = 4 / 3;
/**
 * Stripes coarser than this (fraction of the short side) are not counted as
 * discernible stripes. BT.1702 sets no upper bound on stripe size; this one
 * is a judgment call, pending review: six stripes this coarse span most of
 * the frame's width (a row of tiles, a shelf of windows) rather than reading
 * as a grating. Lowering it to Infinity applies the standard's letter.
 */
export const PATTERN_MAX_PITCH = 0.15;
/** A patch of runs must reach this many pitches across its stripes to be a pattern (a row of six objects is one pitch deep). */
export const PATTERN_MIN_EXTENT = 2;
/** Neighbouring scan lines confirm a run when their pitch agrees within this fraction. */
const NEIGHBOUR_PITCH = 0.25;
/** Area is counted on blocks of this many cells a side. */
const BLOCK = 4;
/**
 * The second frame of the flicker forecast, ms after the first: the next
 * frame of a 60 fps screen. The forecast is what that screen shows: stripes
 * moving a whole pitch per frame look still on it, and faster motion
 * aliases to the flicker the frames actually carry (at most 30 a second).
 * One frame is also long enough that a slow edge crosses some of the
 * raster's sub-cell scanlines, whose coverage moves in steps.
 */
const DELTA_MS = 1000 / 60;
/** Stripe periods per stretch of the flicker estimate (8 edges: enough to average the raster's steps). */
const FLICKER_PERIODS = 4;
/** The base sample time: past every typical `life.enter`, as the perception channels use. */
const BASE_T = 5000;

export type PatternHazardKind = 'pattern' | 'moving-pattern' | 'flicker';

export interface PatternHazardReport {
  /** Refuse: a pattern over its BT.1702 area limit, or forecast flicker over 25 % of the frame. */
  fails: boolean;
  /** Which rule failed (null when it passes). */
  kind: PatternHazardKind | null;
  /** Scene time (ms) of the finding, or of the most patterned sample when it passes; null for a scene with no stripes at all. */
  at: number | null;
  /** Fraction of the frame covered by discernible stripes (the worst sample). */
  area: number;
  /** Of it, the fraction drawn by moving layers (measured only when `area` is between the two limits; else 0). */
  movingArea: number;
  /** Fraction of the frame forecast to flicker above 3 Hz (measured only when needed; else 0). */
  flickerArea: number;
  /** Fastest forecast flicker in a patterned region, flashes a second (0 when not measured). */
  flickerHz: number;
  /** Most stripes of one tone in any single run (a run qualifies at {@link PATTERN_MIN_PAIRS}). */
  pairs: number;
  /** That run's pitch, as a fraction of the viewport's short side (null without a qualifying run). */
  pitch: number | null;
  /** That run's mean light-dark swing in relative luminance (0..1, linear light). */
  contrast: number;
  /** Rasters drawn: the check's cost in units of one perception frame. */
  rasters: number;
  /** With `fails`: why, worded for the author, with what would pass. */
  message?: string;
}

export interface PatternHazardOptions {
  /** Default 1920×1080. */
  viewport?: { width: number; height: number };
  seed?: number;
  /** Sample times (ms) instead of t = 5 s plus the timeline's settle points. */
  times?: number[];
}

// ---------------------------------------------------------------------------
// Raster
// ---------------------------------------------------------------------------

interface Raster {
  cols: number;
  rows: number;
  /** Cell width and height as fractions of the viewport's short side. */
  cellX: number;
  cellY: number;
  /** Row-major relative luminance, linear light. */
  lum: Float64Array;
}

const isText = (l: LayerSpec): boolean => l.sprite.kind === 'text' || l.sprite.kind === 'textBlock';

/**
 * The scene at `t` with the timeline resolved, `ghosting` removed and every
 * layer `keep` rejects painted at opacity 0 — hidden, but still dealt from
 * the seeded stream, so the layers that stay land exactly where they do in
 * the whole scene. `flat` swaps the background for a solid grey of luma `flat`.
 */
function prepared(spec: SaverSpec, t: number, keep: (l: LayerSpec, i: number) => boolean, flat?: number): SaverSpec {
  const resolved = resolveTimelineAt(spec, t);
  const out: SaverSpec = { ...resolved, layers: resolved.layers.map((l, i) => (keep(l, i) && !isText(l) ? l : { ...l, opacity: 0 })) };
  delete (out as { ghosting?: number }).ghosting;
  if (flat !== undefined) {
    const v = Math.round(Math.max(0, Math.min(1, flat)) * 255).toString(16).padStart(2, '0');
    out.background = { type: 'solid', color: `#${v}${v}${v}` };
  }
  return out;
}

function gridSize(viewport: { width: number; height: number }): { cols: number; rows: number } {
  const { width: w, height: h } = viewport;
  const short = Math.max(1, Math.min(w, h));
  const fit = (side: number): number => Math.max(8, Math.min(PATTERN_GRID_MAX_SIDE, Math.round((side / short) * PATTERN_GRID_SHORT_SIDE)));
  return { cols: fit(w), rows: fit(h) };
}

function raster(spec: SaverSpec, t: number, opts: Required<Pick<PatternHazardOptions, 'viewport'>> & { seed?: number }): Raster & { meanGround: number } {
  const { cols, rows } = gridSize(opts.viewport);
  const g = luminanceGrid(spec, { viewport: opts.viewport, seed: opts.seed, t, cols, rows }, PATTERN_GRID_MAX_SIDE);
  const lum = new Float64Array(g.cells.length);
  for (let i = 0; i < lum.length; i++) lum[i] = srgbToLinear(g.cells[i]! * 255);
  const short = Math.min(opts.viewport.width, opts.viewport.height);
  const bg = g.backgroundCells ?? g.background;
  return {
    cols: g.cols,
    rows: g.rows,
    cellX: opts.viewport.width / g.cols / short,
    cellY: opts.viewport.height / g.rows / short,
    lum,
    meanGround: bg.reduce((a, b) => a + b, 0) / Math.max(1, bg.length),
  };
}

// ---------------------------------------------------------------------------
// Stripe runs
// ---------------------------------------------------------------------------

interface Extremum {
  /** Position along the scan line, in cells (a plateau's centre). */
  x: number;
  v: number;
  light: boolean;
}

/**
 * Alternating light/dark extrema along one scan line, with the WCAG flash
 * pair as hysteresis: a reversal registers once the signal has come back at
 * least {@link FLASH_SWING_THRESHOLD} from the running extreme and the darker
 * side is below {@link FLASH_DARK_MAX} — the same rule the validator applies
 * to a tile's luminance over time, here over space. The last running extreme
 * is not registered: nothing confirmed it.
 */
export function stripeExtrema(line: ArrayLike<number>): Extremum[] {
  const n = line.length;
  const out: Extremum[] = [];
  if (n < 3) return out;
  let lo = line[0]!, loAt = 0, hi = line[0]!, hiAt = 0;
  let dir = 0;
  let cand = 0, candFrom = 0, candTo = 0;
  for (let i = 1; i < n; i++) {
    const v = line[i]!;
    if (dir === 0) {
      if (v > hi) { hi = v; hiAt = i; }
      if (v < lo) { lo = v; loAt = i; }
      if (hi - lo >= FLASH_SWING_THRESHOLD && lo < FLASH_DARK_MAX) {
        // The first extreme is whichever came first; the walk goes on from the
        // other, the running extreme of [0, i] (this is the first i at which
        // the swing is reached, so nothing between the two reversed).
        if (loAt < hiAt) { out.push({ x: loAt, v: lo, light: false }); dir = 1; cand = hi; candFrom = candTo = hiAt; }
        else { out.push({ x: hiAt, v: hi, light: true }); dir = -1; cand = lo; candFrom = candTo = loAt; }
      }
      continue;
    }
    if (dir === 1 ? v > cand : v < cand) { cand = v; candFrom = candTo = i; continue; }
    if (v === cand) { if (candTo === i - 1) candTo = i; continue; }
    const swing = dir === 1 ? cand - v : v - cand;
    if (swing >= FLASH_SWING_THRESHOLD && Math.min(cand, v) < FLASH_DARK_MAX) {
      out.push({ x: (candFrom + candTo) / 2, v: cand, light: dir === 1 });
      dir = -dir;
      cand = v; candFrom = candTo = i;
    }
  }
  return out;
}

export interface StripeRun {
  /** Scan line index (a row for `axis: 'x'`, a column for `axis: 'y'`). */
  line: number;
  axis: 'x' | 'y';
  /** First and last stripe centre along the line, in cells. */
  from: number;
  to: number;
  /** Median spacing of the run's stripes, in cells along the line. */
  period: number;
  /** Stripes of one tone in the run, and which tone. */
  count: number;
  light: boolean;
  /** Mean light-dark swing between neighbouring extrema in the run (linear light). */
  contrast: number;
  /** Set once the run is in a pattern: the stripes' pitch square to them, as a fraction of the short side. */
  pitch?: number;
}

/**
 * Two stripe spacings (in cells) agree within `frac` of the smaller, plus one
 * cell: a pitch that is not a whole number of cells is sampled as a mix of
 * the two nearest (2.4 cells reads 2, 3, 2, 2, 3), and that quantisation is
 * not irregularity.
 */
function similarSpacing(a: number, b: number, frac: number): boolean {
  return Math.abs(a - b) <= 1 + frac * Math.min(a, b);
}

/**
 * The stripe runs along one scan line: maximal stretches of light extrema
 * (and separately of dark ones) whose consecutive spacings stay within
 * {@link PERIOD_RATIO} of each other, at least {@link PATTERN_MIN_PAIRS} long.
 * Counting each tone apart makes the count independent of what lies beyond
 * the pattern: six bright bars on a dark ground are six pairs whether the
 * ground at either end is a stripe or not.
 */
export function stripeRuns(ext: Extremum[], line: number, axis: 'x' | 'y'): StripeRun[] {
  const runs: StripeRun[] = [];
  for (const light of [true, false]) {
    const idx: number[] = [];
    ext.forEach((e, i) => { if (e.light === light) idx.push(i); });
    let start = 0;
    const close = (end: number): void => {
      // idx[start..end] inclusive is regular.
      const count = end - start + 1;
      if (count >= PATTERN_MIN_PAIRS) {
        const xs = idx.slice(start, end + 1).map((i) => ext[i]!.x);
        const periods = xs.slice(1).map((x, k) => x - xs[k]!).sort((a, b) => a - b);
        const first = idx[start]!, last = idx[end]!;
        let swing = 0, pairs = 0;
        for (let k = Math.max(0, first - 1); k < Math.min(ext.length - 1, last + 1); k++) { swing += Math.abs(ext[k + 1]!.v - ext[k]!.v); pairs++; }
        runs.push({ line, axis, from: xs[0]!, to: xs[xs.length - 1]!, period: periods[periods.length >> 1]!, count, light, contrast: pairs ? swing / pairs : 0 });
      }
    };
    for (let k = 1; k < idx.length; k++) {
      if (k >= 2) {
        const p0 = ext[idx[k - 1]!]!.x - ext[idx[k - 2]!]!.x;
        const p1 = ext[idx[k]!]!.x - ext[idx[k - 1]!]!.x;
        if (!similarSpacing(p0, p1, PERIOD_RATIO - 1)) {
          // The spacing broke between idx[k-1] and idx[k]: close what ran to k-1, restart at k-1.
          close(k - 1);
          start = k - 1;
        }
      }
    }
    if (idx.length) close(idx.length - 1);
  }
  return runs;
}

/** Runs on every row and column of the raster, keeping those in a patch deep enough to be a pattern. */
function scanRaster(r: Raster): StripeRun[] {
  const rowLine = new Float64Array(r.cols);
  const colLine = new Float64Array(r.rows);
  const perLine = (axis: 'x' | 'y', n: number): StripeRun[][] => {
    const lines: StripeRun[][] = [];
    for (let k = 0; k < n; k++) {
      if (axis === 'x') { for (let c = 0; c < r.cols; c++) rowLine[c] = r.lum[k * r.cols + c]!; }
      else { for (let q = 0; q < r.rows; q++) colLine[q] = r.lum[q * r.cols + k]!; }
      const line = axis === 'x' ? rowLine : colLine;
      lines.push(stripeRuns(stripeExtrema(line), k, axis));
    }
    return lines;
  };
  const all: StripeRun[][][] = [perLine('x', r.rows), perLine('y', r.cols)];
  const kept: StripeRun[] = [];
  for (const lines of all) {
    // Patches: runs linked across scan lines no further apart than a pitch
    // (rows of dots leave runless lines between them) with overlapping spans
    // and the same pitch. A patch is a pattern only when it reaches at least
    // PATTERN_MIN_EXTENT pitches across its stripes: a grating's lines, a
    // dot lattice's rows. A single row of objects (six figures on a bench)
    // stays one pitch deep however regular it is, and is not a stripe pattern.
    const flat = lines.flat();
    const at = new Map<StripeRun, number>();
    flat.forEach((run, i) => at.set(run, i));
    const parent = flat.map((_, i) => i);
    const find = (i: number): number => { while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!; return i; };
    const across = (run: StripeRun): number => run.period * (run.axis === 'x' ? r.cellX / r.cellY : r.cellY / r.cellX);
    for (const run of flat) {
      const reach = Math.max(1, Math.ceil(across(run)));
      for (let k = run.line + 1; k <= run.line + reach && k < lines.length; k++) {
        for (const q of lines[k]!) {
          const overlap = Math.min(run.to, q.to) - Math.max(run.from, q.from);
          if (overlap >= 0.5 * Math.min(run.to - run.from, q.to - q.from) && similarSpacing(run.period, q.period, NEIGHBOUR_PITCH)) {
            parent[find(at.get(q)!)] = find(at.get(run)!);
          }
        }
      }
    }
    // Each patch's extent across its lines, and its stripes' slant: how far
    // the stripes step along the line per line across (0 for stripes square
    // to the scan, 1 cell per cell at 45 degrees), from adjacent linked runs.
    const span = new Map<number, { lo: number; hi: number; across: number; periods: number[]; slants: number[] }>();
    for (const run of flat) {
      const root = find(at.get(run)!);
      const s0 = span.get(root);
      const a = across(run);
      if (!s0) span.set(root, { lo: run.line, hi: run.line, across: a, periods: [run.period], slants: [] });
      else { s0.lo = Math.min(s0.lo, run.line); s0.hi = Math.max(s0.hi, run.line); s0.across = Math.max(s0.across, a); s0.periods.push(run.period); }
    }
    for (const run of flat) {
      for (const q of lines[run.line + 1] ?? []) {
        if (q.light !== run.light || find(at.get(q)!) !== find(at.get(run)!)) continue;
        const d = q.from - run.from;
        span.get(find(at.get(run)!))!.slants.push(Math.abs(d - run.period * Math.round(d / run.period)));
      }
    }
    const median = (xs: number[]): number => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1]! : 0);
    // Each patch's medians, sorted once: the patch is complete by now, and
    // sorting it again for each of its runs made the scan quadratic in patch size.
    const medians = new Map<number, { period: number; slant: number }>();
    for (const run of flat) {
      const root = find(at.get(run)!);
      const sp = span.get(root)!;
      if (sp.hi - sp.lo + 1 < PATTERN_MIN_EXTENT * sp.across) continue;
      let med = medians.get(root);
      if (!med) medians.set(root, (med = { period: median(sp.periods), slant: median(sp.slants) }));
      // The pitch square to the stripes: the period along the line, foreshortened by their slant.
      const [along, step] = run.axis === 'x' ? [r.cellX, r.cellY] : [r.cellY, r.cellX];
      const slant = med.slant * along;
      run.pitch = med.period * along * (step / Math.hypot(slant, step));
      if (run.pitch <= PATTERN_MAX_PITCH) kept.push(run);
    }
  }
  return kept;
}

/** The blocks a run (or a stretch [from, to] of it) covers, widened by half a pitch each way. */
function runBlocks(r: Raster, run: StripeRun, from = run.from, to = run.to): { bx0: number; bx1: number; by0: number; by1: number } {
  const half = run.period / 2;
  // The pitch is in cells along the run; across it, convert by the cell aspect.
  const across = run.axis === 'x' ? half * (r.cellX / r.cellY) : half * (r.cellY / r.cellX);
  const [x0, x1, y0, y1] = run.axis === 'x'
    ? [from - half, to + half, run.line - across, run.line + across]
    : [run.line - across, run.line + across, from - half, to + half];
  const bw = Math.ceil(r.cols / BLOCK), bh = Math.ceil(r.rows / BLOCK);
  const clampB = (v: number, blocks: number): number => Math.max(0, Math.min(blocks - 1, Math.floor(v / BLOCK)));
  return { bx0: clampB(x0, bw), bx1: clampB(x1, bw), by0: clampB(y0, bh), by1: clampB(y1, bh) };
}

/** Fraction of the frame's cells inside marked blocks. */
function markedArea(r: Raster, marked: Uint8Array): number {
  const bw = Math.ceil(r.cols / BLOCK);
  let cells = 0;
  marked.forEach((m, i) => {
    if (!m) return;
    const bx = i % bw, by = Math.floor(i / bw);
    cells += (Math.min(r.cols, (bx + 1) * BLOCK) - bx * BLOCK) * (Math.min(r.rows, (by + 1) * BLOCK) - by * BLOCK);
  });
  return cells / (r.cols * r.rows);
}

function patternArea(r: Raster, runs: StripeRun[]): number {
  const bw = Math.ceil(r.cols / BLOCK), bh = Math.ceil(r.rows / BLOCK);
  const marked = new Uint8Array(bw * bh);
  for (const run of runs) {
    const b = runBlocks(r, run);
    for (let y = b.by0; y <= b.by1; y++) for (let x = b.bx0; x <= b.bx1; x++) marked[y * bw + x] = 1;
  }
  return markedArea(r, marked);
}

/**
 * The flicker forecast: per stretch of {@link FLICKER_PERIODS} stripe periods along each run,
 * the frequency at which stripes cross a point, from two frames `dt` ms
 * apart. A pattern translating at v⊥ across stripes of pitch p swings each
 * point between light and dark f = v⊥ / p times a second, and its mean
 * |∂L/∂t| over whole periods is 2·f·(light − dark), so f = mean|ΔL/Δt| / (2 ×
 * contrast). Rotation is translation varying across the frame (v⊥ = ω·r),
 * which the per-stretch estimate follows.
 */
function flicker(a: Raster, b: Raster, runs: StripeRun[], dt: number): { area: number; hz: number } {
  const bw = Math.ceil(a.cols / BLOCK), bh = Math.ceil(a.rows / BLOCK);
  const marked = new Uint8Array(bw * bh);
  let worst = 0;
  for (const run of runs) {
    if (run.contrast <= 0) continue;
    const span = Math.max(8, FLICKER_PERIODS * run.period);
    for (let s = run.from; s < run.to; s += span) {
      const e = Math.min(run.to, s + span);
      const c0 = Math.max(0, Math.floor(s)), c1 = Math.min((run.axis === 'x' ? a.cols : a.rows) - 1, Math.ceil(e));
      let sum = 0;
      for (let c = c0; c <= c1; c++) {
        const i = run.axis === 'x' ? run.line * a.cols + c : c * a.cols + run.line;
        sum += Math.abs(b.lum[i]! - a.lum[i]!);
      }
      const hz = sum / (c1 - c0 + 1) / (dt / 1000) / (2 * run.contrast);
      worst = Math.max(worst, hz);
      if (hz > FLASH_MAX_PER_SECOND) {
        const bl = runBlocks(a, run, s, e);
        for (let y = bl.by0; y <= bl.by1; y++) for (let x = bl.bx0; x <= bl.bx1; x++) marked[y * bw + x] = 1;
      }
    }
  }
  return { area: markedArea(a, marked), hz: worst };
}

// ---------------------------------------------------------------------------
// Motion, from the spec
// ---------------------------------------------------------------------------

export type PatternMotion = 'static' | 'flow' | 'moving';

const nonZero = (v: number | [number, number] | undefined): boolean =>
  v !== undefined && (Array.isArray(v) ? v[0] !== 0 || v[1] !== 0 : v !== 0);

/**
 * How a layer's drawing changes over time, as BT.1702 sorts it: still,
 * flowing one way (`drift` without `bob` or `bidirectional`, `rise` without
 * `sway`, `warp`), or moving in any other way — spin, rock, orbit, bounce,
 * wander, path, pulse, grow, emit, a sprite `cycle`, or any timeline key on
 * the layer or its group. Anything this does not recognise is `moving`.
 */
export function layerPatternMotion(spec: SaverSpec, index: number): PatternMotion {
  const l = spec.layers[index];
  if (!l) return 'static';
  const keyed = keyedLayers(spec);
  if (keyed.has(index)) return 'moving';
  const sprite = l.sprite as { cycle?: unknown };
  if (nonZero(l.spin) || l.rock || l.pulse || l.grow || l.emit || sprite.cycle) return 'moving';
  const m = l.motion as { type: string; speed?: [number, number]; bob?: number; bidirectional?: boolean; sway?: number };
  const moves = !!m.speed && nonZero(m.speed);
  switch (m.type) {
    case 'static':
      return 'static';
    case 'drift':
      if (!moves) return (m.bob ?? 0) !== 0 ? 'moving' : 'static';
      return (m.bob ?? 0) !== 0 || m.bidirectional ? 'moving' : 'flow';
    case 'rise':
      if (!moves) return (m.sway ?? 0) !== 0 ? 'moving' : 'static';
      return (m.sway ?? 0) !== 0 ? 'moving' : 'flow';
    case 'warp':
      return moves ? 'flow' : 'static';
    default:
      return 'moving';
  }
}

/** Layers some timeline key touches (directly, or through their group); -1 stands for the scene itself (background and scene-wide fields). */
function keyedLayers(spec: SaverSpec): Set<number> {
  const out = new Set<number>();
  if (!spec.timeline) return out;
  for (const path of timelineTracks(spec).keys()) {
    const [root, id] = path.split('.');
    if (root === 'layers' && /^\d+$/.test(id ?? '')) out.add(Number(id));
    else if (root === 'groups' && id !== undefined) spec.layers.forEach((l, i) => { if (l.group === id) out.add(i); });
    else out.add(-1);
  }
  return out;
}

function backgroundMotion(spec: SaverSpec): PatternMotion {
  if (keyedLayers(spec).has(-1)) return 'moving';
  const bg = spec.background as { type?: string; drift?: { amount?: number } | unknown } | undefined;
  if (!bg) return 'static';
  const drift = (bg as { drift?: { amount?: number } }).drift;
  if (bg.type === 'field') return drift && (drift as { amount?: number }).amount !== 0 ? 'flow' : 'static';
  return drift ? 'flow' : 'static';
}

// ---------------------------------------------------------------------------
// Sample times
// ---------------------------------------------------------------------------

/**
 * t = 5 s, plus each time a timeline key settles (where a keyed-in pattern
 * is at its fullest), within the first lap of a looping timeline. Past
 * {@link PATTERN_MAX_SAMPLE_TIMES} the settle times are subsampled evenly,
 * always keeping the last.
 */
export function patternSampleTimes(spec: SaverSpec): number[] {
  const tl = spec.timeline;
  if (!tl) return [BASE_T];
  const lap = tl.loop && tl.duration ? tl.duration : 0;
  const settle = new Set<number>();
  for (const keys of timelineTracks(spec).values()) {
    for (const k of keys) {
      const end = k.t + Math.max(0, k.dur ?? DEFAULT_KEY_DUR);
      settle.add(lap ? end % lap : end);
    }
  }
  settle.delete(BASE_T);
  const ts = [...settle].sort((a, b) => a - b);
  const room = PATTERN_MAX_SAMPLE_TIMES - 1;
  const picked = ts.length <= room ? ts : Array.from({ length: room }, (_, i) => ts[Math.round(((i + 1) * (ts.length - 1)) / room)]!);
  return [BASE_T, ...new Set(picked)];
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

const pct = (f: number): string => `${Math.round(f * 100)}%`;

function describeRun(run: StripeRun): string {
  const p = run.pitch ?? 0;
  return `${run.count} light-dark pairs of stripes at a pitch of ${p.toFixed(3)} of the short side (about ${Math.round(p * 1080)} px at 1080p), luminance swing ${run.contrast.toFixed(2)}`;
}

const REMEDY =
  'To pass: lower the stripes\' contrast (keep light and dark within 0.1 relative luminance of each other), use five or fewer stripes, ' +
  'break the regular spacing, or confine the pattern to a smaller part of the frame.';

/**
 * BT.1702 spatial-pattern check for one scene. Pure and deterministic (same
 * spec, seed and viewport ⇒ same report). Fails closed nowhere: every
 * finding is a measurement. See the module comment for what it does not see.
 */
export function patternHazardReport(spec: SaverSpec, opts: PatternHazardOptions = {}): PatternHazardReport {
  const viewport = opts.viewport ?? { width: 1920, height: 1080 };
  const ro = { viewport, seed: opts.seed };
  const motion = spec.layers.map((_, i) => layerPatternMotion(spec, i));
  const bgMotion = backgroundMotion(spec);
  const anyMotion = bgMotion !== 'static' || motion.some((m, i) => m !== 'static' && !isText(spec.layers[i]!));
  const best: PatternHazardReport = { fails: false, kind: null, at: null, area: 0, movingArea: 0, flickerArea: 0, flickerHz: 0, pairs: 0, pitch: null, contrast: 0, rasters: 0 };
  let rasters = 0;
  for (const t of opts.times ?? patternSampleTimes(spec)) {
    const full = raster(prepared(spec, t, () => true), t, ro);
    rasters++;
    const runs = scanRaster(full);
    const area = patternArea(full, runs);
    const top = runs.reduce<StripeRun | null>((a, b) => (!a || b.count > a.count ? b : a), null);
    const found: PatternHazardReport = {
      fails: false, kind: null, at: runs.length ? t : null, area, movingArea: 0, flickerArea: 0, flickerHz: 0,
      pairs: top?.count ?? 0, pitch: top?.pitch ?? null, contrast: top?.contrast ?? 0, rasters: 0,
    };
    const where = `at t = ${Math.round(t)} ms`;
    if (top && area > PATTERN_STATIONARY_AREA) {
      return {
        ...found, fails: true, kind: 'pattern', rasters,
        message:
          `pattern hazard (photosensitivity): ${where} the frame shows a regular stripe pattern (${describeRun(top)}) over ${pct(area)} of the frame. ` +
          `ITU-R BT.1702 treats more than five light-dark pairs of such stripes as harmful above 40% of the screen when still, and above 25% when they move, turn or oscillate. ${REMEDY}`,
      };
    }
    if (top && area > PATTERN_MOVING_AREA) {
      // Between the two limits: what does the pattern do over time?
      const movers = motion.map((m) => m === 'moving');
      if (movers.some((m, i) => m && !isText(spec.layers[i]!)) || bgMotion === 'moving') {
        const flat = bgMotion === 'moving' ? undefined : full.meanGround;
        const own = raster(prepared(spec, t, (_, i) => movers[i]!, flat), t, ro);
        rasters++;
        const ownRuns = scanRaster(own);
        found.movingArea = patternArea(own, ownRuns);
        if (found.movingArea > PATTERN_MOVING_AREA) {
          const ownTop = ownRuns.reduce<StripeRun | null>((a, b) => (!a || b.count > a.count ? b : a), null) ?? top;
          return {
            ...found, fails: true, kind: 'moving-pattern', rasters,
            message:
              `pattern hazard (photosensitivity): ${where} a regular stripe pattern (${describeRun(ownTop)}) that moves, turns or oscillates covers ${pct(found.movingArea)} of the frame. ` +
              `ITU-R BT.1702 limits a moving pattern of more than five light-dark pairs to 25% of the screen (40% when still). ${REMEDY} Or hold it still.`,
          };
        }
      }
      if (anyMotion) {
        const later = raster(prepared(spec, t + DELTA_MS, () => true), t + DELTA_MS, ro);
        rasters++;
        const f = flicker(full, later, runs, DELTA_MS);
        found.flickerArea = f.area;
        found.flickerHz = f.hz;
        if (f.area > PATTERN_FLICKER_AREA) {
          return {
            ...found, fails: true, kind: 'flicker', rasters,
            message:
              `pattern hazard (photosensitivity): ${where} a regular stripe pattern (${describeRun(top)}) moves across its stripes fast enough that ${pct(f.area)} of the frame flickers ` +
              `more than ${FLASH_MAX_PER_SECOND} times a second (up to ${Math.round(f.hz)}): each point turns light and dark as the stripes pass, at speed ÷ pitch. More than 3 a second over 25% of the frame is a flash hazard. ` +
              'Slow it (under 3 stripe pitches a second), widen the pitch, lower the contrast, or shrink the patterned area.',
          };
        }
      }
    }
    if (area > best.area || (best.at === null && found.at !== null)) Object.assign(best, found);
  }
  best.rasters = rasters;
  return best;
}
