/**
 * Perception tools for non-vision agents. Everything here is computed
 * ANALYTICALLY from the spec — positions, sizes, and alphas are pure functions
 * of (seed, t), so no canvas or renderer is involved: these run in Node, are
 * fully deterministic, and are cheap enough to call in an authoring loop.
 *
 * The design premise: a text model doesn't need mimicked eyes, it needs vision
 * translated into modalities it is already strong in —
 * - a compact PICTURE it can actually read (braille luminance map: each Unicode
 *   braille char encodes a 2×4 dot cell, ~8× ASCII resolution per token),
 * - 1D structure (row/column luminance profiles — the skeleton of a composition),
 * - OBJECT-level ranking (dominance: where does the eye go),
 * - RELATIVE judgement (diffScenes: "is B better than A" beats "is A good"),
 * - MOTION as numbers (per-layer displacement stats).
 */
import { createRng } from '@idle-screens/core';
import { adviseSpec } from './advise';
import { cohesionOf, type LayerCohesion } from './cohesion';
import { backgroundLuma, backgroundRgb, hexLuma, hexRgb, spriteHex, spriteLuma } from './luma';
import { fieldRgbAt, fieldSampleTime, rgb255Luma } from './field';
import { barBox, barFraction, flattenSprite, gradientSpace, isPathPolygon, pathFrame, isShapedSprite, partInkArea, pathInkArea, pathLength, pathParts, polygonArea, type ResolvedPart, polygonFill, polygonFillRule, polygonPoints, strokeSamples, strokeTaper, strokeWidthPx, type PolygonSprite } from './shapes';
import { trailEchoes, trailFillBudget } from './trail';
import {
  alphaAt,
  breakTextBlock,
  buildEntities,
  headingAt,
  lifeAlphaAt,
  linkEdges,
  linkMaxDistPx,
  positionAt,
  revealState,
  rotationAt,
  sizeAt,
  textBlockAnchorOffset,
  textMetricsClassFor,
  entityScales,
  type Entity,
} from './simulate';
import { bedRenderSeed, normalizeSeed, resolveSegment, segmentRenderSeed } from './sequence';
import { paintMap, paintOpacity, paintRotation, paintSize, type Pt } from './paint';
import { resolveTimelineAt } from './timeline';
import { LIMITS, type IdleSequence, type LayerSpec, type PathGradient, type SaverSpec } from './types';

// ---------------------------------------------------------------------------
// Calibration constants
//
// The knob that tunes how closely this analytical model matches the real
// canvas. Kept at module level so a calibration pass has one place to look —
// it is not a per-entity detail. (A second, GLOW_SPREAD, modelled an additive
// halo past a soft sprite's radius; the canvas draws none, and pixel truth
// removed it — perception-lab S1-03b, S1-07.)
// ---------------------------------------------------------------------------

/**
 * How much more visually prominent line-like ink is than the same area of fill.
 * Rings, streaks and link lines catch the eye far more than their pixel area
 * implies, so weighting dominance by raw area alone makes a bright ring lose to
 * a dim disc. Also a first-pass estimate.
 */
const LINE_SALIENCE = 3.5;

/**
 * How many past-frame samples model the `ghosting` smear. The live renderer
 * composites every 60 fps frame with persistence `g`, so ink from m frames ago
 * survives at weight g^m; the analytic model samples that decay at GHOST_TAPS
 * points across the visible window (until weight falls below 1/255, capped at
 * LIMITS.maxGhostReplayFrames — the same bound as the renderer's seek warm-up
 * replay), each tap carrying its bracket's summed weight. More taps sharpen the
 * smear's shape; the total energy is set by `g`, not by this constant.
 */
const GHOST_TAPS = 12;

/**
 * A polygon whose bounding diameter spans at least this many grid cells is
 * rasterized by its real outline; below it, it splats as its circumscribed
 * disc weighted by `polygonFill`, exactly as before. The two do NOT agree at
 * the boundary: the disc path lights every cell whose centre is within half a
 * cell of the rim at full weight, so it over-reports a small glyph's ink (12
 * hexagons just under 3 cells: mean deviation 0.022 against an analytic 0.014;
 * the outline gives 0.013). Circles carry the same dilation, and keeping it
 * for small polygons keeps a hexagon and a disc of one size reading alike.
 * Above the threshold the disc is materially wrong for any non-round glyph — a
 * full-width flat band reads as a circle, a ridge silhouette as a dome.
 */
const POLYGON_OUTLINE_CELLS = 3;

/** Sub-scanlines per grid row when rasterizing a polygon outline. */
const POLYGON_SCANLINES = 4;

// ---------------------------------------------------------------------------
// Shared scene construction (mirrors describeScene/adviseSpec)
// ---------------------------------------------------------------------------

interface BuiltScene {
  w: number;
  h: number;
  scale: number;
  /** Normalized exactly like `SpecInstance.seed` (0 is falsy, so it lands on 1). */
  seed: number;
  layers: Array<{ layer: LayerSpec; entities: Entity[] }>;
  byKey: Map<string, Entity[]>;
  /** Entities of layers with a paint `transform` — null (every scene without one) skips the lookup. */
  transforms: Map<Entity, (p: Pt) => Pt> | null;
}


export interface PerceiveOptions {
  viewport?: { width: number; height: number };
  seed?: number;
  /** Sample time in ms. Default 5000 (past all typical life.enter staging). */
  t?: number;
}

function buildScene(spec: SaverSpec, opts: PerceiveOptions): BuiltScene {
  const { width: w, height: h } = opts.viewport ?? { width: 1920, height: 1080 };
  // Normalized exactly like `SpecInstance.seed` — a valid `seed: 0` lands on 1,
  // matching the renderer, and this same normalized value is reused for field
  // background sampling (see `luminanceGrid`) so both agree on one seed.
  const seed = normalizeSeed(opts.seed ?? spec.seed ?? 42);
  const { scale, countScale } = entityScales(spec, w, h);
  const rng = createRng(seed);
  const layers = spec.layers.map((layer) => ({ layer, entities: buildEntities(layer, rng, w, h, scale, countScale) }));
  const byKey = new Map<string, Entity[]>();
  for (const { layer, entities } of layers) if (layer.key) byKey.set(layer.key, entities);
  let transforms: Map<Entity, (p: Pt) => Pt> | null = null;
  for (const { layer, entities } of layers) {
    // Layer transform (about its origin) wrapped by its group's — see paint.ts.
    const map = paintMap(spec, layer, w, h, scale);
    if (!map) continue;
    transforms ??= new Map();
    for (const e of entities) transforms.set(e, map);
  }
  return { w, h, scale, seed, layers, byKey, transforms };
}

/** Position with layer-parented-orbit resolution (matches the renderer). */
function posOf(scene: BuiltScene, e: Entity, t: number): { x: number; y: number } {
  const p = positionAt(e, t, scene.w, scene.h);
  if (e.orbitParent) {
    const parent = scene.byKey.get(e.orbitParent)?.[0];
    if (parent) {
      const pp = positionAt(parent, t, scene.w, scene.h);
      p.x += pp.x;
      p.y += pp.y;
    }
  }
  const map = scene.transforms?.get(e);
  return map ? map(p) : p;
}

/**
 * Text bounding box + anchor, matching the renderer's font rule: a CSS
 * shorthand containing a px size overrides the seeded per-entity size.
 * Returns the box CENTRE (accounting for align/baseline) and half-extents.
 */
/**
 * The renderer's font scale (compile.ts fontScale): a font's own px size is
 * authored for the reference viewport and drawn at min(w, h) / reference of it.
 */
function fontScaleFor(spec: SaverSpec, w: number, h: number): number {
  return spec.units === 'px' ? 1 : Math.min(w, h) / (spec.referenceViewport ?? LIMITS.referenceViewport);
}

/** Px size a text sprite draws at: its font's px × the font scale, else the entity's size. */
function textFontPx(s: Extract<LayerSpec['sprite'], { kind: 'text' }>, size: number, fontScale: number): number {
  const m = s.font ? /(\d+(?:\.\d+)?)px/.exec(s.font) : null;
  return m ? Number(m[1]) * fontScale : size;
}

function textBox(
  s: Extract<LayerSpec['sprite'], { kind: 'text' }>,
  e: Entity,
  p: { x: number; y: number },
  fontScale: number,
  unitScale: number,
): { cx: number; cy: number; halfX: number; halfY: number } {
  const fh = textFontPx(s, e.size, fontScale);
  const str = s.strings[e.spriteIndex] ?? s.strings[0] ?? '';
  // `maxWidth` squeezes the string to fit (fillText's maxWidth), so the box does too.
  const est = Math.max(fh, 0.62 * fh * Math.min(str.length, 48));
  const fw = s.maxWidth ? Math.min(est, s.maxWidth * unitScale) : est;
  const align = s.align ?? 'center';
  const baseline = s.baseline ?? 'middle';
  return {
    cx: align === 'left' ? p.x + fw / 2 : align === 'right' ? p.x - fw / 2 : p.x,
    cy: baseline === 'top' ? p.y + fh * 0.6 : baseline === 'bottom' ? p.y - fh * 0.6 : p.y,
    halfX: fw / 2,
    halfY: fh * 0.6,
  };
}

function textBlockBox(
  s: Extract<LayerSpec['sprite'], { kind: 'textBlock' }>,
  _e: Entity,
  p: { x: number; y: number },
  w: number,
  h: number,
): { cx: number; cy: number; halfX: number; halfY: number } {
  const unitScale = Math.min(w, h);
  const fsPx = s.fontSize * unitScale;
  const lh = (s.lineHeight ?? 1.4) * fsPx;
  const maxWPx = s.maxWidth * unitScale;
  const maxWEm = maxWPx / fsPx;
  const lines = breakTextBlock(s.text, maxWEm, textMetricsClassFor(s.font));
  const totalH = lines.length * lh;
  const maxLineW = lines.reduce((m, l) => Math.max(m, l.widthEm), 0) * fsPx;
  const align = s.align ?? 'left';
  const cx = align === 'center' ? p.x + maxWPx / 2
    : align === 'right' ? p.x + maxWPx - maxLineW / 2
    : p.x + maxLineW / 2;
  // Anchor moves the whole block the same way the renderer does (0,0 when absent).
  const { dx, dy } = textBlockAnchorOffset(s, maxWPx, maxLineW, totalH);
  return {
    cx: cx + dx,
    cy: p.y + totalH / 2 + dy,
    halfX: maxLineW / 2,
    halfY: totalH / 2,
  };
}

/**
 * Effective reveal fraction of a textBlock at time t (1 = fully shown).
 * Mirrors the renderer's `revealState` exactly — same line breaking, same
 * grapheme counting — so the perceived ink matches the painted ink.
 */
function textBlockRevealFraction(
  s: Extract<LayerSpec['sprite'], { kind: 'textBlock' }>,
  w: number,
  h: number,
  t: number,
): number {
  if (!s.reveal) return 1;
  const unitScale = Math.min(w, h);
  const maxWEm = (s.maxWidth * unitScale) / (s.fontSize * unitScale);
  const lines = breakTextBlock(s.text, maxWEm, textMetricsClassFor(s.font));
  const rs = revealState(lines, s.reveal, t);
  if (rs.glyphAlphas) {
    // glyphFade paints partial-alpha glyphs, so the ink fraction is the mean
    // glyph alpha, not the frontier progress.
    let sum = 0;
    let n = 0;
    for (const line of rs.glyphAlphas) for (const a of line) { sum += a; n++; }
    return n > 0 ? sum / n : 1;
  }
  return rs.progress;
}

// ---------------------------------------------------------------------------
// Polygon outline rasterization
// ---------------------------------------------------------------------------

/**
 * Fraction of each cell in the window [c0..c1]×[r0..r1] that a polygon fills,
 * row-major within the window. Scanline with the canvas's own `nonzero` rule:
 * each sub-scanline collects signed edge crossings (half-open in y, so a
 * horizontal edge or a vertex on the line is counted once), and the spans where
 * the winding is nonzero are split exactly across the cells they cross. So
 * coverage is exact horizontally and POLYGON_SCANLINES-sampled vertically, and
 * a self-intersecting outline fills both lobes, as `ctx.fill()` does.
 */
/** A path gradient at unit-box point (u, v): luma and opacity of the interpolated stop. */
function gradientAt(gr: PathGradient, u: number, v: number): { luma: number; opacity: number } {
  let t: number;
  if (gr.type === 'linear') {
    const dx = gr.to[0] - gr.from[0], dy = gr.to[1] - gr.from[1];
    const len2 = dx * dx + dy * dy || 1;
    t = ((u - gr.from[0]) * dx + (v - gr.from[1]) * dy) / len2;
  } else {
    t = Math.hypot(u - gr.center[0], v - gr.center[1]) / gr.radius;
  }
  const st = gr.stops;
  t = Math.max(st[0]!.at, Math.min(st[st.length - 1]!.at, t));
  let k = 0;
  while (k < st.length - 2 && t > st[k + 1]!.at) k++;
  const A = st[k]!, B = st[Math.min(k + 1, st.length - 1)]!;
  const w = B.at > A.at ? (t - A.at) / (B.at - A.at) : 0;
  return { luma: hexLuma(A.color) * (1 - w) + hexLuma(B.color) * w, opacity: (A.opacity ?? 1) * (1 - w) + (B.opacity ?? 1) * w };
}

function polygonCellCoverage(
  pts: Array<{ x: number; y: number }>,
  cellW: number,
  cellH: number,
  c0: number,
  c1: number,
  r0: number,
  r1: number,
  evenodd = false,
): Float64Array {
  const nc = c1 - c0 + 1;
  const cov = new Float64Array(nc * (r1 - r0 + 1));
  const xMin = c0 * cellW;
  const xMax = (c1 + 1) * cellW;
  const share = 1 / POLYGON_SCANLINES;
  const hits: Array<{ x: number; dir: number }> = [];
  const addSpan = (row: number, xa: number, xb: number): void => {
    const a = Math.max(xMin, xa);
    const b = Math.min(xMax, xb);
    if (!(b > a)) return;
    const first = Math.max(c0, Math.floor(a / cellW));
    const last = Math.min(c1, Math.floor(b / cellW));
    for (let c = first; c <= last; c++) {
      const len = Math.min(b, (c + 1) * cellW) - Math.max(a, c * cellW);
      if (len > 0) cov[row * nc + (c - c0)]! += (len / cellW) * share;
    }
  };
  for (let r = r0; r <= r1; r++) {
    for (let k = 0; k < POLYGON_SCANLINES; k++) {
      const y = (r + (k + 0.5) / POLYGON_SCANLINES) * cellH;
      hits.length = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!;
        const q = pts[(i + 1) % pts.length]!;
        const down = p.y <= y && q.y > y;
        if (!down && !(q.y <= y && p.y > y)) continue;
        hits.push({ x: p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x), dir: down ? 1 : -1 });
      }
      if (hits.length < 2) continue;
      hits.sort((m, n) => m.x - n.x);
      let wind = 0;
      let start = 0;
      const filled = (w: number): boolean => (evenodd ? (w & 1) !== 0 : w !== 0);
      for (const hit of hits) {
        const before = filled(wind);
        wind += hit.dir;
        const after = filled(wind);
        if (!before && after) start = hit.x;
        else if (before && !after) addSpan(r - r0, start, hit.x);
      }
    }
  }
  return cov;
}

// ---------------------------------------------------------------------------
// Luminance grid
// ---------------------------------------------------------------------------

export interface LuminanceGrid {
  cols: number;
  rows: number;
  /** Row-major luminance 0..1 including the background. */
  cells: number[];
  /** Per-row background luminance (what an empty scene would be). For a `field` background: each row's mean. */
  background: number[];
  /**
   * Per-cell background luminance, present only for a `field` background
   * (a solid or gradient varies by row alone, and `background` says it all).
   * Coverage, centroid and the profiles deviate from THIS, so the field's own
   * contours never count as content — a bright field is ground, not ink.
   */
  backgroundCells?: number[];
  meanLuminance: number;
  /** Fraction of cells deviating perceptibly (> 0.03) from the background. */
  coverage: number;
  /** Deviation-weighted centre of visual mass as viewport fractions, or null for a flat scene. */
  centroid: { x: number; y: number } | null;
  /** Mean deviation-from-background per row/column — 1D transects of the composition. */
  rowProfile: number[];
  colProfile: number[];
}

export interface LuminanceGridOptions extends PerceiveOptions {
  /** Grid resolution. Defaults 80×48 (→ a 40×12 braille map). */
  cols?: number;
  rows?: number;
}

/** The canvas's soft-sprite alpha at radius fraction u: stops 1 @ 0, 0.75 @ 0.35, 0 @ 1 (compile.ts). */
function softProfile(u: number): number {
  if (u <= 0) return 1;
  if (u >= 1) return 0;
  return u <= 0.35 ? 1 - (0.25 * u) / 0.35 : 0.75 * (1 - (u - 0.35) / 0.65);
}

/** Mean of softProfile over a disc's area, ∫₀¹ softProfile(u)·2u du. */
const SOFT_DISC_MEAN = 0.3783;

/**
 * The ink (0..1 of the cell's area) that a disc — or the annulus
 * rInner ≤ |p − (cx, cy)| ≤ rOuter — lays in the cell [x0, x0+cw) × [y0, y0+ch):
 * covered area, weighted by the soft gradient when `soft`. Exact when the cell
 * is wholly outside or inside the shape, or the shape wholly inside the cell;
 * otherwise sampled over the part of the cell the shape's box overlaps, at a
 * spacing set by the radius, so a disc smaller than a cell is never stepped
 * over (perception-lab S1-09: a field of 3 px soft dots read 6× too dark).
 */
function discCellInk(cx: number, cy: number, rOuter: number, rInner: number, soft: boolean, x0: number, y0: number, cw: number, ch: number): number {
  const nx = Math.max(x0, Math.min(cx, x0 + cw)) - cx;
  const ny = Math.max(y0, Math.min(cy, y0 + ch)) - cy;
  const near = Math.hypot(nx, ny);
  const fx = Math.max(Math.abs(x0 - cx), Math.abs(x0 + cw - cx));
  const fy = Math.max(Math.abs(y0 - cy), Math.abs(y0 + ch - cy));
  const far = Math.hypot(fx, fy);
  if (near >= rOuter || far <= rInner) return 0;
  if (far <= rOuter && near >= rInner) return soft ? softProfile(Math.hypot(x0 + cw / 2 - cx, y0 + ch / 2 - cy) / rOuter) : 1;
  if (cx - rOuter >= x0 && cx + rOuter <= x0 + cw && cy - rOuter >= y0 && cy + rOuter <= y0 + ch) {
    return (Math.PI * (soft ? rOuter * rOuter * SOFT_DISC_MEAN : rOuter * rOuter - rInner * rInner)) / (cw * ch);
  }
  const bx0 = Math.max(x0, cx - rOuter);
  const by0 = Math.max(y0, cy - rOuter);
  const sx = Math.min(x0 + cw, cx + rOuter) - bx0;
  const sy = Math.min(y0 + ch, cy + rOuter) - by0;
  if (sx <= 0 || sy <= 0) return 0;
  const step = Math.max(rOuter / 4, 1e-6);
  const ni = Math.max(4, Math.min(16, Math.ceil(sx / step)));
  const nj = Math.max(4, Math.min(16, Math.ceil(sy / step)));
  let ink = 0;
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      const d = Math.hypot(bx0 + ((i + 0.5) * sx) / ni - cx, by0 + ((j + 0.5) * sy) / nj - cy);
      if (d <= rOuter && d >= rInner) ink += soft ? softProfile(d / rOuter) : 1;
    }
  }
  return ((ink / (ni * nj)) * sx * sy) / (cw * ch);
}

/**
 * Sample the spec into a coarse luminance image — analytically, no renderer.
 * Persistence is modeled, not simulated: because positions are pure functions
 * of (seed, t), `ghosting` is a decayed sum of past-frame splats (weight g^m
 * for ink m frames old, mirroring the renderer's warm-up replay) and `trail`
 * re-uses drawTrail's sampling — past positions with decaying alpha and
 * shrinking radius. Polygons larger than POLYGON_OUTLINE_CELLS are scanned by
 * their real (rotated) outline; smaller ones splat as a fill-weighted disc.
 * Remaining approximations (documented, deliberate): background drift is
 * sampled at its rest position. Good enough to perceive composition, focus,
 * balance — and now smear.
 */
export function luminanceGrid(spec: SaverSpec, opts: LuminanceGridOptions = {}): LuminanceGrid {
  // A `timeline` resolves at the sample time; without one this is `spec` itself.
  spec = resolveTimelineAt(spec, opts.t ?? 5000);
  const scene = buildScene(spec, opts);
  const t = opts.t ?? 5000;
  const cols = Math.max(8, Math.min(200, opts.cols ?? 80));
  const rows = Math.max(8, Math.min(200, opts.rows ?? 48));
  const { w, h, scale } = scene;
  const cellW = w / cols;
  const cellH = h / rows;

  // Background: vertical gradient (or solid) + optional bottom band — or a
  // field, sampled per cell with the renderer's own function at the same
  // bucketed time, so the grid's ground IS what the raster paints.
  const bg = spec.background;
  const bgRow: number[] = new Array(rows).fill(0);
  let bgCells: number[] | undefined;
  if (!bg || bg.type === 'solid') {
    bgRow.fill(hexLuma(bg?.color ?? '#05050a'));
  } else if (bg.type === 'field') {
    bgCells = new Array<number>(cols * rows);
    const short = Math.max(1, Math.min(w, h));
    const seed = scene.seed;
    const ft = fieldSampleTime(bg, t);
    for (let r = 0; r < rows; r++) {
      let rowSum = 0;
      for (let c = 0; c < cols; c++) {
        const lum = rgb255Luma(fieldRgbAt(((c + 0.5) * cellW) / short, ((r + 0.5) * cellH) / short, ft, bg, seed));
        bgCells[r * cols + c] = lum;
        rowSum += lum;
      }
      bgRow[r] = rowSum / cols;
    }
  } else {
    const stops = [...bg.stops].sort((a, b) => a.at - b.at);
    for (let r = 0; r < rows; r++) {
      const y = (r + 0.5) / rows;
      let lum: number;
      if (y <= stops[0]!.at) lum = hexLuma(stops[0]!.color);
      else if (y >= stops[stops.length - 1]!.at) lum = hexLuma(stops[stops.length - 1]!.color);
      else {
        let i = 0;
        while (i < stops.length - 1 && stops[i + 1]!.at < y) i++;
        const a = stops[i]!;
        const b = stops[i + 1]!;
        const k = b.at === a.at ? 0 : (y - a.at) / (b.at - a.at);
        lum = hexLuma(a.color) + (hexLuma(b.color) - hexLuma(a.color)) * k;
      }
      bgRow[r] = lum;
    }
    if (bg.band) {
      const bandPx = bg.band.height * (spec.units === 'px' ? 1 : Math.min(w, h));
      const fromRow = Math.max(0, Math.floor((h - bandPx) / cellH));
      for (let r = fromRow; r < rows; r++) bgRow[r] = hexLuma(bg.band.color);
    }
  }

  const cells = new Array<number>(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells[r * cols + c] = bgCells ? bgCells[r * cols + c]! : bgRow[r]!;

  const compose = (idx: number, lum: number, a: number, blend: LayerSpec['blend']): void => {
    const cur = cells[idx]!;
    if (blend === 'lighter' || blend === 'screen') cells[idx] = Math.min(1, cur + lum * a);
    else if (blend === 'multiply') cells[idx] = cur * (1 - a * (1 - lum));
    else cells[idx] = cur * (1 - a) + lum * a;
  };

  // Afterglow behind a moving entity — the analytic mirror of the renderer's
  // drawTrail, from the same sampler (`trailEchoes`): past positions with
  // decaying alpha and shrinking radius, gap-filled where a fast mover's
  // echoes would part, stopping at wrap seams. A large polygon echoes as its
  // own outline (as the wall paints it); everything else splats a disc.
  const splatTrail = (layer: LayerSpec, e: Entity, tPass: number, lifeA: number, alphaScale: number, layerCount: number): void => {
    const trail = layer.trail;
    if (!trail) return;
    const headAlpha = alphaAt(e, tPass) * lifeA * alphaScale;
    const headSize = sizeAt(e, tPass);
    const lum = spriteLuma(layer, e);
    const soft = layer.sprite.kind === 'circle' && !!layer.sprite.soft;
    const echoes = trailEchoes(trail, tPass, headAlpha, headSize, (pt) => posOf(scene, e, pt), w, h, layer.wrap !== false,
      // As the renderer: a shape echoes at its time samples only; circles fill
      // (a hard circle's ribbon reads, on the coarse grid, as filled discs).
      isShapedSprite(layer.sprite) && layer.sprite.kind !== 'circle' ? 0 : trailFillBudget(layerCount), 0.004, layer.blend === 'lighter');
    for (const ec of echoes) {
      const a = ec.alpha;
      const rad = ec.r;
      if (layer.sprite.kind === 'polygon' && rad * 2 >= POLYGON_OUTLINE_CELLS * Math.min(cellW, cellH)) {
        splatPolygonOutline(layer, layer.sprite, e, ec, rad * 2, Math.min(1, a), lum, ec.t);
        continue;
      }
      const pos = ec;
      const c0 = Math.max(0, Math.floor((pos.x - rad) / cellW));
      const c1 = Math.min(cols - 1, Math.floor((pos.x + rad) / cellW));
      const r0 = Math.max(0, Math.floor((pos.y - rad) / cellH));
      const r1 = Math.min(rows - 1, Math.floor((pos.y + rad) / cellH));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          let wgt = 1;
          if (soft) {
            wgt = discCellInk(pos.x, pos.y, rad, 0, true, c * cellW, r * cellH, cellW, cellH);
            if (wgt <= 0) continue;
          } else {
            const d = Math.hypot((c + 0.5) * cellW - pos.x, (r + 0.5) * cellH - pos.y);
            if (d > rad + Math.min(cellW, cellH) / 2) continue;
          }
          compose(r * cols + c, lum, Math.min(1, a * wgt), layer.blend);
        }
      }
    }
  };

  // A polygon painted by its real outline — the renderer's path, rotated by
  // `rotationAt` about the entity — instead of its circumscribed disc. Weight
  // per cell is the fraction of it the outline fills; `soft` is the renderer's
  // radial gradient (centred on the entity, radius = circumradius) clipped to
  // that outline, additive or not — nothing reaches past it (perception-lab S1-07).
  const splatPolygonOutline = (layer: LayerSpec, s: PolygonSprite, e: Entity, p: { x: number; y: number }, sz: number, a: number, lum: number, tPass: number): void => {
    const radius = sz / 2;
    const rot = rotationAt(e, tPass) + paintRotation(spec, layer);
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    // A path drawing lands through its frame (span stretches, origin anchors);
    // everything below maps unit-box points with `mapUnit` and back with `unitAt`.
    const fr = isPathPolygon(s) ? pathFrame(s, radius, w, h) : { sx: radius, sy: radius, ox: 0, oy: 0, uniform: true };
    const mapUnit = (u: number, v: number): { x: number; y: number } => {
      const qx = (u - fr.ox) * fr.sx, qy = (v - fr.oy) * fr.sy;
      return { x: p.x + qx * cr - qy * sr, y: p.y + qx * sr + qy * cr };
    };
    const pts = isPathPolygon(s)
      ? flattenSprite(s).points.map(([u, v]) => mapUnit(u, v))
      : polygonPoints(s, radius).map((q) => ({ x: p.x + q.x * cr - q.y * sr, y: p.y + q.x * sr + q.y * cr }));
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const q of pts) {
      minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
    }
    // A part's stroke as px quads along its mapped lines, half-width from the uniform radius.
    const strokeQuadsPx = (part: ResolvedPart): Array<Array<{ x: number; y: number }>> => {
      if (!part.stroke) return [];
      const hw = (part.stroke.width * radius) / 2;
      const out: Array<Array<{ x: number; y: number }>> = [];
      for (const l of part.flat.lines) {
        const m = l.points.map(([u, v]) => mapUnit(u, v));
        const n = l.closed ? m.length : m.length - 1;
        for (let i = 0; i < n; i++) {
          const A = m[i]!, B = m[(i + 1) % m.length]!;
          const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
          const nx = (-dy / len) * hw, ny = (dx / len) * hw;
          out.push([{ x: A.x + nx, y: A.y + ny }, { x: B.x + nx, y: B.y + ny }, { x: B.x - nx, y: B.y - ny }, { x: A.x - nx, y: A.y - ny }]);
        }
      }
      return out;
    };
    if (isPathPolygon(s)) {
      // Strokes reach past the fill (and are all there is with fill: false).
      for (const part of pathParts(s)) for (const quad of strokeQuadsPx(part)) for (const q of quad) {
        minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
      }
    }
    const c0 = Math.max(0, Math.floor(minX / cellW));
    const c1 = Math.min(cols - 1, Math.floor(maxX / cellW));
    const r0 = Math.max(0, Math.floor(minY / cellH));
    const r1 = Math.min(rows - 1, Math.floor(maxY / cellH));
    if (c0 > c1 || r0 > r1) return;
    const nc = c1 - c0 + 1;
    const unitAt = (x: number, y: number): [number, number] => {
      const dx = x - p.x, dy = y - p.y;
      return [(dx * cr + dy * sr) / Math.max(fr.sx, 1e-6) + fr.ox, (-dx * sr + dy * cr) / Math.max(fr.sy, 1e-6) + fr.oy];
    };
    // Plain polygons (sides/points) keep the single-fill path below; path
    // polygons composite part by part, back to front, as the canvas paints them.
    const parts = isPathPolygon(s) ? pathParts(s) : null;
    const fillPass = (ring: Array<{ x: number; y: number }>, rule: boolean, partLum: number, partA: number, part: ResolvedPart | null): void => {
      const cov = polygonCellCoverage(ring, cellW, cellH, c0, c1, r0, r1, rule);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const f = cov[(r - r0) * nc + (c - c0)]!;
          if (!(f > 0)) continue;
          const x = (c + 0.5) * cellW;
          const y = (r + 0.5) * cellH;
          let cl = partLum, ca = 1;
          if (part?.gradient) {
            const [u, v] = unitAt(x, y);
            const [gu, gv] = gradientSpace(part, u, v);
            const g = gradientAt(part.gradient, gu, gv);
            cl = g.luma; ca = g.opacity;
          }
          const wgt = s.soft && !parts ? f * softProfile(Math.hypot(x - p.x, y - p.y) / Math.max(radius, 1e-6)) : f;
          if (wgt > 0) compose(r * cols + c, cl, a * partA * ca * Math.min(1, wgt), layer.blend);
        }
      }
    };
    if (!parts) {
      fillPass(pts, polygonFillRule(s) === 'evenodd', lum, 1, null);
      return;
    }
    for (const part of parts) {
      const partLum = part.color ? hexLuma(part.color) : lum;
      if (part.fill && part.flat.points.length >= 3) {
        fillPass(part.flat.points.map(([u, v]) => mapUnit(u, v)), part.rule === 'evenodd', partLum, part.opacity, part);
      }
      if (part.stroke) {
        const sa = (part.stroke.opacity ?? 1) * part.opacity;
        const sl = hexLuma(part.stroke.color);
        const scov = new Float64Array(nc * (r1 - r0 + 1));
        for (const qp of strokeQuadsPx(part)) {
          let qx0 = Infinity, qx1 = -Infinity, qy0 = Infinity, qy1 = -Infinity;
          for (const q of qp) { qx0 = Math.min(qx0, q.x); qx1 = Math.max(qx1, q.x); qy0 = Math.min(qy0, q.y); qy1 = Math.max(qy1, q.y); }
          const a0 = Math.max(c0, Math.floor(qx0 / cellW)), a1 = Math.min(c1, Math.floor(qx1 / cellW));
          const b0 = Math.max(r0, Math.floor(qy0 / cellH)), b1 = Math.min(r1, Math.floor(qy1 / cellH));
          if (a0 > a1 || b0 > b1) continue;
          const qc = polygonCellCoverage(qp, cellW, cellH, a0, a1, b0, b1);
          const qn = a1 - a0 + 1;
          for (let r = b0; r <= b1; r++) for (let c = a0; c <= a1; c++) {
            const i = (r - r0) * nc + (c - c0);
            scov[i] = Math.min(1, scov[i]! + qc[(r - b0) * qn + (c - a0)]!);
          }
        }
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
          const f = scov[(r - r0) * nc + (c - c0)]!;
          if (f > 0) compose(r * cols + c, sl, a * sa * f, layer.blend);
        }
      }
    }
  };

  // One composite pass at time tPass with all ink scaled by alphaScale — the
  // analytic mirror of the renderer's paintFrame. Ghost passes call this with
  // decayed weights; the live frame calls it with alphaScale 1.
  const splatPass = (tPass: number, alphaScale: number): void => {
  for (const { layer, entities } of scene.layers) {
    const lifeA = layer.opacity === undefined && layer.group === undefined ? lifeAlphaAt(layer.life, tPass) : lifeAlphaAt(layer.life, tPass) * paintOpacity(spec, layer);
    if (lifeA <= 0) continue;

    for (const e of entities) {
      splatTrail(layer, e, tPass, lifeA, alphaScale, entities.length);
      const a = Math.min(1, alphaAt(e, tPass) * lifeA) * alphaScale;
      if (a <= 0.004) continue;
      const lum = spriteLuma(layer, e);
      const p = posOf(scene, e, tPass);
      const sz = layer.transform || layer.group !== undefined ? sizeAt(e, tPass) * paintSize(spec, layer) : sizeAt(e, tPass);
      const s = layer.sprite;

      if (s.kind === 'polygon' && (sz >= POLYGON_OUTLINE_CELLS * Math.min(cellW, cellH) || (isPathPolygon(s) && ((s.span ?? 'box') !== 'box' || s.origin !== undefined)))) {
        splatPolygonOutline(layer, s, e, p, sz, a, lum, tPass);
        continue;
      }
      if (s.kind === 'stroke') {
        // Stamp along the sampled path, rotated like the renderer does.
        const pts = strokeSamples(s, sz / 2);
        let angle = rotationAt(e, tPass) + paintRotation(spec, layer);
        if (s.orient) angle += headingAt(e, tPass, w, h) ?? 0;
        const ca = Math.cos(angle);
        const sa = Math.sin(angle);
        const lw = strokeWidthPx(s, scale);
        const stampAt = (q: { x: number; y: number }, u: number): void => {
          const x = p.x + q.x * ca - q.y * sa;
          const y = p.y + q.x * sa + q.y * ca;
          const c = Math.floor(x / cellW);
          const r = Math.floor(y / cellH);
          if (c < 0 || c >= cols || r < 0 || r >= rows) return;
          const taper = s.taper ? strokeTaper(u) : 1;
          compose(r * cols + c, lum, a * Math.min(1, (lw * taper) / cellH), layer.blend);
        };
        // Rasterize each segment at half-cell steps so a long stroke leaves a
        // continuous line of ink, not a dotted one.
        const step = Math.min(cellW, cellH) / 2;
        stampAt(pts[0]!, 0);
        for (let i = 1; i < pts.length; i++) {
          const q0 = pts[i - 1]!;
          const q1 = pts[i]!;
          const segLen = Math.hypot(q1.x - q0.x, q1.y - q0.y);
          const sub = Math.max(1, Math.ceil(segLen / step));
          for (let k = 1; k <= sub; k++) {
            const f = k / sub;
            stampAt({ x: q0.x + (q1.x - q0.x) * f, y: q0.y + (q1.y - q0.y) * f }, (i - 1 + f) / (pts.length - 1));
          }
        }
        continue;
      }
      if (s.kind === 'streak') {
        // Stamp along the segment from tail to head, like the renderer: motion
        // heading plus the entity's own resolved rotation.
        const heading = (headingAt(e, tPass, w, h) ?? 0) + (rotationAt(e, tPass) + paintRotation(spec, layer));
        const steps = Math.max(2, Math.ceil(sz / Math.min(cellW, cellH)));
        const wgt = Math.min(1, ((s.width ?? (scale === 1 ? 2 : 0.002)) * scale) / cellH);
        for (let i = 0; i <= steps; i++) {
          const k = i / steps;
          const x = p.x - Math.cos(heading) * sz * (1 - k);
          const y = p.y - Math.sin(heading) * sz * (1 - k);
          const c = Math.floor(x / cellW);
          const r = Math.floor(y / cellH);
          if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
          compose(r * cols + c, lum, a * k * wgt, layer.blend);
        }
        continue;
      }

      let centerX = p.x;
      let centerY = p.y;
      let halfX = sz / 2;
      let halfY = s.kind === 'rect' ? ((e.size2 ?? sz) * (e.size > 0 ? sz / e.size : 1)) / 2 : sz / 2;
      if (s.kind === 'text') {
        const box = textBox(s, e, p, fontScaleFor(spec, w, h), scale);
        centerX = box.cx;
        centerY = box.cy;
        halfX = box.halfX;
        halfY = box.halfY;
      } else if (s.kind === 'textBlock') {
        const box = textBlockBox(s, e, p, w, h);
        centerX = box.cx;
        centerY = box.cy;
        halfX = box.halfX;
        halfY = box.halfY;
      } else if (s.kind === 'bar') {
        const len = sz * barFraction(s, e.barIndex ?? 0);
        if (len <= 0) continue;
        const th = e.size2 !== undefined ? e.size2 * (e.size > 0 ? sz / e.size : 1) : sz * 0.2;
        const box = barBox(s.direction ?? 'right', len, th);
        // The renderer rotates the bar about the entity with `spin`; rotate
        // the box's offset the same way and take the rotated box's AABB.
        const rot = rotationAt(e, tPass) + paintRotation(spec, layer);
        const cr = Math.cos(rot);
        const sr = Math.sin(rot);
        centerX = p.x + box.cx * cr - box.cy * sr;
        centerY = p.y + box.cx * sr + box.cy * cr;
        halfX = Math.abs(box.halfX * cr) + Math.abs(box.halfY * sr);
        halfY = Math.abs(box.halfX * sr) + Math.abs(box.halfY * cr);
      }
      const circular = s.kind === 'circle' || s.kind === 'ring' || s.kind === 'polygon';
      const soft = (s.kind === 'circle' || s.kind === 'polygon') && !!s.soft;
      // A small polygon (under POLYGON_OUTLINE_CELLS) fills only part of its
      // disc; a feathered rect only part of its box. Scale the splat weight
      // rather than trace the outline — large polygons took the outline path.
      const shapeWeight = s.kind === 'polygon'
        ? polygonFill(s, sz / 2)
        : s.kind === 'rect' && s.feather
          ? (1 - s.feather / 2) * (1 - s.feather / 2)
          : 1;
      // The canvas draws a soft sprite as a radial gradient that ends AT its
      // radius (compile.ts), additive or not — no halo (perception-lab S1-03b).
      const c0 = Math.max(0, Math.floor((centerX - halfX) / cellW));
      const c1 = Math.min(cols - 1, Math.floor((centerX + halfX) / cellW));
      const r0 = Math.max(0, Math.floor((centerY - halfY) / cellH));
      const r1 = Math.min(rows - 1, Math.floor((centerY + halfY) / cellH));
      // Glyphs don't fill their box — ink is sparse. A revealing textBlock
      // has proportionally less ink lit.
      const inkWeight = (s.kind === 'text' || s.kind === 'emoji' || s.kind === 'textBlock' ? 0.55 : 1)
        * (s.kind === 'textBlock' ? textBlockRevealFraction(s, w, h, t) * (s.opacity ?? 1) : 1);
      // rect and bar are fillRect: the canvas paints each cell in proportion
      // to the area the box covers. Without this a 2 px scan line darkened
      // its whole 22 px grid row at full alpha, and 270 of them read as a
      // black veil (mean 0.035 where the canvas paints 0.41).
      const byArea = s.kind === 'rect' || s.kind === 'bar' || s.kind === 'text' || s.kind === 'emoji' || s.kind === 'textBlock';
      for (let r = r0; r <= r1; r++) {
        const fy = byArea ? Math.max(0, Math.min((r + 1) * cellH, centerY + halfY) - Math.max(r * cellH, centerY - halfY)) / cellH : 1;
        if (fy <= 0) continue;
        for (let c = c0; c <= c1; c++) {
          if (circular) {
            const inner = s.kind === 'ring' ? Math.max(0, halfX - (s.width ?? (scale === 1 ? 2 : 0.002)) * scale) : 0;
            // The canvas averages each cell, so a disc (or ring) that covers a
            // quarter of a cell moves that cell's mean by a quarter of its
            // contrast — light it by the ink it lays there, as rect/bar are.
            const wgt = discCellInk(centerX, centerY, halfX, inner, soft, c * cellW, r * cellH, cellW, cellH);
            if (wgt <= 0) continue;
            compose(r * cols + c, lum, a * wgt * shapeWeight, layer.blend);
          } else if (byArea) {
            const fx = Math.max(0, Math.min((c + 1) * cellW, centerX + halfX) - Math.max(c * cellW, centerX - halfX)) / cellW;
            if (fx > 0) compose(r * cols + c, lum, a * inkWeight * shapeWeight * fx * fy, layer.blend);
          } else {
            compose(r * cols + c, lum, a * inkWeight * shapeWeight, layer.blend);
          }
        }
      }
    }

    // Link lines are visual mass too (for chain scenes they ARE the scene).
    if (layer.links) {
      const positions = entities.map((e) => posOf(scene, e, tPass));
      const motionWraps = ['drift', 'rise', 'wander'].includes(layer.motion.type);
      const edges = linkEdges(layer.links, positions, linkMaxDistPx(layer.links, scale), layer.wrap !== false && motionWraps, w, h);
      const la = Math.min(1, (layer.links.alpha ?? 0.6) * lifeA);
      const lum = layer.links.color ? hexLuma(layer.links.color) : 0.7;
      const defaultWidth = scale === 1 ? 1 : 1 / LIMITS.referenceViewport;
      const wgt = Math.min(1, ((layer.links.width ?? defaultWidth) * scale) / cellH) * la * alphaScale;
      for (const edge of edges) {
        const pi = positions[edge.i]!;
        const pj = positions[edge.j]!;
        const steps = Math.max(1, Math.ceil(edge.dist / Math.min(cellW, cellH)));
        for (let i = 0; i <= steps; i++) {
          const k = i / steps;
          const c = Math.floor((pi.x + (pj.x - pi.x) * k) / cellW);
          const r = Math.floor((pi.y + (pj.y - pi.y) * k) / cellH);
          if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
          compose(r * cols + c, lum, wgt, layer.blend);
        }
      }
    }
  }
  };

  // Ghosting: the renderer composites each 60 fps frame over the last with
  // persistence g, so ink from m frames ago survives at weight g^m. Sample
  // that decay across the visible window (weight ≥ 1/255, capped at the same
  // maxGhostReplayFrames bound as the renderer's seek replay), oldest first so
  // newer ink composites on top. Each tap stands in for the frames in its
  // bracket and carries their summed surviving weight (geometric sum).
  const ghost = spec.ghosting ?? 0;
  if (ghost > 0) {
    const dt = 1000 / 60;
    const windowFrames = Math.min(Math.ceil(Math.log(1 / 255) / Math.log(ghost)), LIMITS.maxGhostReplayFrames);
    const taps = Math.min(GHOST_TAPS, windowFrames);
    const spacing = windowFrames / taps;
    for (let i = taps; i >= 1; i--) {
      const tPass = t - i * spacing * dt;
      if (tPass < 0) continue;
      const bracketWeight =
        (Math.pow(ghost, (i - 1) * spacing + 1) * (1 - Math.pow(ghost, spacing))) / (1 - ghost);
      splatPass(tPass, Math.min(1, bracketWeight));
    }
  }
  splatPass(t, 1);

  // Deviation stats
  return finishGrid(cols, rows, cells, bgRow, bgCells);
}

/**
 * The stats every grid carries, from its cells and per-row background —
 * or, for a field, its per-cell background (`bgCells`), which deviation is
 * measured against instead so the field's own contours read as ground.
 */
function finishGrid(cols: number, rows: number, cells: number[], bgRow: number[], bgCells?: number[]): LuminanceGrid {
  let sum = 0;
  let covered = 0;
  let devSum = 0;
  let cxAcc = 0;
  let cyAcc = 0;
  const rowProfile = new Array<number>(rows).fill(0);
  const colProfile = new Array<number>(cols).fill(0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = cells[r * cols + c]!;
      sum += v;
      const dev = Math.abs(v - (bgCells ? bgCells[r * cols + c]! : bgRow[r]!));
      if (dev > 0.03) covered++;
      devSum += dev;
      cxAcc += dev * (c + 0.5);
      cyAcc += dev * (r + 0.5);
      rowProfile[r]! += dev;
      colProfile[c]! += dev;
    }
  }
  for (let r = 0; r < rows; r++) rowProfile[r] = rowProfile[r]! / cols;
  for (let c = 0; c < cols; c++) colProfile[c] = colProfile[c]! / rows;

  return {
    cols,
    rows,
    cells,
    background: bgRow,
    ...(bgCells ? { backgroundCells: bgCells } : {}),
    meanLuminance: sum / (cols * rows),
    coverage: covered / (cols * rows),
    centroid: devSum > 1e-6 ? { x: cxAcc / devSum / cols, y: cyAcc / devSum / rows } : null,
    rowProfile,
    colProfile,
  };
}

// ---------------------------------------------------------------------------
// Braille rendering
// ---------------------------------------------------------------------------

// Ordered-dither thresholds for a 2×4 braille cell (spatially spread).
const DITHER: number[][] = [
  [0.5 / 8, 4.5 / 8],
  [2.5 / 8, 6.5 / 8],
  [1.5 / 8, 5.5 / 8],
  [3.5 / 8, 7.5 / 8],
];
// Braille dot bit for (row 0..3, col 0..1): dots 1-2-3-7 left, 4-5-6-8 right.
const DOT_BIT: number[][] = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
];

/**
 * Auto-exposure curve for a grid: most savers live in the bottom of the
 * luminance range, so cells are normalized (min → 98th percentile) with a
 * slight gamma before quantizing — like a camera exposing for the scene. Stats
 * on the grid itself stay raw.
 *
 * Shared by every renderer below, deliberately: if the curve is ever
 * recalibrated (e.g. once a calibration constant moves coverage), the braille
 * and density views must move together or they'd silently disagree about the
 * same scene.
 */
function autoExpose(grid: LuminanceGrid): (v: number) => number {
  const sorted = [...grid.cells].sort((a, b) => a - b);
  const lo = sorted[0]!;
  const hi = Math.max(sorted[Math.floor(sorted.length * 0.98)]!, lo + 0.08);
  return (v: number): number => Math.pow(Math.max(0, Math.min(1, (v - lo) / (hi - lo))), 0.8);
}

/**
 * Encode a luminance grid as a braille "image": each output character is a 2×4
 * pixel cell, ordered-dithered so mid-tones render as dot density. A grid of
 * 80×48 becomes 12 lines of 40 chars — a picture a text model can read whole.
 */
export function renderBrailleMap(grid: LuminanceGrid): string {
  const expose = autoExpose(grid);

  const outRows: string[] = [];
  for (let br = 0; br < Math.floor(grid.rows / 4); br++) {
    let line = '';
    for (let bc = 0; bc < Math.floor(grid.cols / 2); bc++) {
      let bits = 0;
      for (let dr = 0; dr < 4; dr++) {
        for (let dc = 0; dc < 2; dc++) {
          const v = expose(grid.cells[(br * 4 + dr) * grid.cols + (bc * 2 + dc)]!);
          if (v > DITHER[dr]![dc]!) bits |= DOT_BIT[dr]![dc]!;
        }
      }
      line += String.fromCharCode(0x2800 + bits);
    }
    outRows.push(line);
  }
  return outRows.join('\n');
}

// Density ramp, dark → bright. One char per grid cell (vs braille's 2×4), so a
// higher-resolution grid reads as a sharper picture — the channel agents found
// most legible for structure (rings, grids, text blocks) that braille blurs.
const DENSITY_RAMP = ' .:-=+*#%@';

/**
 * Encode a luminance grid as a one-char-per-cell ASCII density map. Unlike the
 * braille map (compact, 2×4 dots/char) this is 1:1 with the grid, so pairing it
 * with a larger `cols`/`rows` gives a non-vision agent a genuinely higher-detail
 * read: 120×48 resolves concentric rings and text blocks braille smears into a
 * blob. Shares the braille map's auto-exposure so both views agree.
 */
export function renderDensityMap(grid: LuminanceGrid): string {
  const expose = autoExpose(grid);
  const ramp = DENSITY_RAMP;
  const lines: string[] = [];
  for (let r = 0; r < grid.rows; r++) {
    let line = '';
    for (let c = 0; c < grid.cols; c++) {
      const v = expose(grid.cells[r * grid.cols + c]!);
      line += ramp[Math.min(ramp.length - 1, Math.floor(v * ramp.length))]!;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Text sprite listing
// ---------------------------------------------------------------------------

export interface TextSpriteInfo {
  layerIndex: number;
  key: string | undefined;
  /** The literal strings this layer draws (glyphs are invisible in the maps). */
  strings: string[];
  /** How many entities carry text. */
  count: number;
  /** Representative rendered glyph height in px at the sample viewport. */
  sizePx: number;
  /** For a revealing textBlock: effective 0..1 fraction shown at sample t. */
  revealed?: number;
}

/**
 * List every text layer's actual strings and rendered size. No grid resolution
 * renders glyphs legibly, so a non-vision agent otherwise can't tell whether the
 * words it wrote are on screen, how big, or whether they'll overlap. This closes
 * that blind spot analytically.
 */
export function textSprites(spec: SaverSpec, opts: PerceiveOptions = {}): TextSpriteInfo[] {
  spec = resolveTimelineAt(spec, opts.t ?? 5000);
  const scene = buildScene(spec, opts);
  const t = opts.t ?? 5000;
  const out: TextSpriteInfo[] = [];
  scene.layers.forEach(({ layer, entities }, layerIndex) => {
    if (layer.sprite.kind === 'textBlock') {
      const s = layer.sprite;
      const unitScale = Math.min(scene.w, scene.h);
      const sizePx = s.fontSize * unitScale;
      const info: TextSpriteInfo = { layerIndex, key: layer.key, strings: [s.text], count: entities.length, sizePx: Math.round(sizePx) };
      if (s.reveal) info.revealed = Math.round(textBlockRevealFraction(s, scene.w, scene.h, t) * 100) / 100;
      out.push(info);
      return;
    }
    if (layer.sprite.kind !== 'text') return;
    const s = layer.sprite;
    const sizePx = textFontPx(s, entities[0] ? sizeAt(entities[0], t) : 0, fontScaleFor(spec, scene.w, scene.h));
    out.push({ layerIndex, key: layer.key, strings: [...s.strings], count: entities.length, sizePx: Math.round(sizePx) });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Dominance ranking
// ---------------------------------------------------------------------------

export interface DominanceEntry {
  rank: number;
  layerIndex: number;
  key: string | undefined;
  /** Normalized share of total visual weight, 0..1 (all entries sum to 1). */
  share: number;
  entityCount: number;
  meanLuma: number;
  factors: { area: number; contrast: number; blendBoost: number; motionBoost: number };
}

/**
 * Rank layers by estimated visual weight — where the eye goes. Weight is
 * on-screen area × alpha, scaled by contrast against the background, an
 * additive-glow boost, and a motion boost. Link lines count as area, and so
 * does persistence ink: trail ribbons and ghosting smear are modeled as swept
 * ribbons, so a comet layer is ranked by its comet, not just its head.
 */
export function dominanceRanking(spec: SaverSpec, opts: PerceiveOptions = {}): DominanceEntry[] {
  return rankDominance(rawDominance(spec, opts));
}

interface RawDominance {
  layerIndex: number;
  key: string | undefined;
  weight: number;
  entityCount: number;
  meanLuma: number;
  factors: DominanceEntry['factors'];
}

/** Normalize raw weights to shares and rank — shared by a scene and a composed sequence frame. */
function rankDominance(raw: RawDominance[]): DominanceEntry[] {
  const total = raw.reduce((s, r) => s + r.weight, 0) || 1;
  return raw
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((r, i) => ({
      rank: i + 1,
      layerIndex: r.layerIndex,
      key: r.key,
      share: r.weight / total,
      entityCount: r.entityCount,
      meanLuma: r.meanLuma,
      factors: r.factors,
    }));
}

/**
 * The fraction of an entity's extent inside the viewport. Its box is the
 * circumradius square (a path drawing's own frame, which `span`/`origin` can
 * stretch and shift), scaled by the paint transform `k`; a text box is judged
 * by the text checks, so text counts whole. Only what lands in the frame is
 * the scene's mass or colour (X616).
 */
function onScreenFraction(scene: BuiltScene, s: LayerSpec['sprite'], e: Entity, sz: number, k: number, t: number): number {
  if (s.kind === 'text' || s.kind === 'textBlock') return 1;
  const { w, h } = scene;
  const p = posOf(scene, e, t);
  let cx = p.x, cy = p.y, hx = (sz / 2) * k, hy = hx;
  if (s.kind === 'polygon' && isPathPolygon(s)) {
    const fr = pathFrame(s, sz / 2, w, h);
    cx -= fr.ox * fr.sx * k; cy -= fr.oy * fr.sy * k; hx = fr.sx * k; hy = fr.sy * k;
  }
  if (!(hx > 0) || !(hy > 0)) return 1;
  const fx = Math.max(0, Math.min(cx + hx, w) - Math.max(cx - hx, 0)) / (2 * hx);
  const fy = Math.max(0, Math.min(cy + hy, h) - Math.max(cy - hy, 0)) / (2 * hy);
  return fx * fy;
}

/** Per-layer un-normalized visual weight at `opts.t` — the body of dominanceRanking. */
function rawDominance(spec: SaverSpec, opts: PerceiveOptions = {}): RawDominance[] {
  spec = resolveTimelineAt(spec, opts.t ?? 5000);
  const scene = buildScene(spec, opts);
  const t = opts.t ?? 5000;
  const { w, h, scale } = scene;

  const bgMean = backgroundLuma(spec);


  // Persistence smears every moving sprite into a ribbon of real visual mass —
  // for a comet layer the trail IS the visual event. Model both effects as
  // swept ribbons (path length × stroke width × mean surviving alpha), using
  // the straight-line displacement as a lower-bound path length and skipping
  // wrap seams. First-pass fidelity, not yet checked against pixels.
  const ghost = spec.ghosting ?? 0;
  let ghostWindowMs = 0;
  let ghostMeanW = 0;
  if (ghost > 0) {
    const dt = 1000 / 60;
    const frames = Math.min(Math.ceil(Math.log(1 / 255) / Math.log(ghost)), LIMITS.maxGhostReplayFrames);
    ghostWindowMs = frames * dt;
    ghostMeanW = (ghost * (1 - Math.pow(ghost, frames))) / (1 - ghost) / frames;
  }
  const sweptDistance = (e: Entity, spanMs: number): number => {
    const span = Math.min(spanMs, t);
    if (span <= 0) return 0;
    const p0 = posOf(scene, e, t - span);
    const p1 = posOf(scene, e, t);
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    if (Math.abs(dx) > w / 2 || Math.abs(dy) > h / 2) return 0; // wrapped: ambiguous
    return Math.sqrt(dx * dx + dy * dy);
  };

  const raw = scene.layers.map(({ layer, entities }, layerIndex) => {
    const lifeA = layer.opacity === undefined && layer.group === undefined ? lifeAlphaAt(layer.life, t) : lifeAlphaAt(layer.life, t) * paintOpacity(spec, layer);
    const painted = layer.transform !== undefined || layer.group !== undefined;
    const areaScale = painted ? paintSize(spec, layer) ** 2 : 1;
    let area = 0;
    let lumAcc = 0;
    for (const e of entities) {
      const a = alphaAt(e, t) * lifeA;
      const sz = sizeAt(e, t);
      const s = layer.sprite;
      let entArea: number;
      if (s.kind === 'circle') entArea = Math.PI * (sz / 2) * (sz / 2);
      else if (s.kind === 'ring') entArea = Math.PI * sz * ((s.width ?? (scale === 1 ? 2 : 0.002)) * scale) * LINE_SALIENCE;
      else if (s.kind === 'streak') entArea = sz * ((s.width ?? (scale === 1 ? 2 : 0.002)) * scale) * LINE_SALIENCE;
      else if (s.kind === 'rect') {
        const h2 = e.size2 !== undefined ? e.size2 * (e.size > 0 ? sz / e.size : 1) : sz;
        const f = s.feather ? (1 - s.feather / 2) * (1 - s.feather / 2) : 1;
        entArea = sz * h2 * f;
      }
      else if (s.kind === 'polygon') {
        if (isPathPolygon(s)) {
          const fr = pathFrame(s, sz / 2, w, h);
          entArea = pathInkArea(s, fr.sx, fr.sy);
        } else entArea = polygonArea(polygonPoints(s, sz / 2));
      }
      else if (s.kind === 'bar') {
        const th = e.size2 !== undefined ? e.size2 * (e.size > 0 ? sz / e.size : 1) : sz * 0.2;
        entArea = sz * barFraction(s, e.barIndex ?? 0) * th;
      }
      else if (s.kind === 'stroke') {
        const meanTaper = s.taper ? 0.64 : 1; // ∫ sin(πu) du = 2/π
        entArea = pathLength(strokeSamples(s, sz / 2)) * strokeWidthPx(s, scale) * meanTaper * LINE_SALIENCE;
      }
      else if (s.kind === 'text') {
        const box = textBox(s, e, { x: 0, y: 0 }, fontScaleFor(spec, w, h), scale);
        entArea = box.halfX * 2 * box.halfY * 2 * 0.55;
      } else if (s.kind === 'textBlock') {
        const box = textBlockBox(s, e, { x: 0, y: 0 }, w, h);
        entArea = box.halfX * 2 * box.halfY * 2 * 0.55 * textBlockRevealFraction(s, w, h, t) * (s.opacity ?? 1);
      } else entArea = sz * sz * 0.55; // emoji

      // Only what lands in the frame counts: a layer parked off screen is
      // not the main mass, however big it is (X616).
      entArea *= onScreenFraction(scene, s, e, sz, painted ? paintSize(spec, layer) : 1, t);
      area += painted ? entArea * areaScale * a : entArea * a;

      // Trail ribbon: dots shrink to 0.3× and fade along the tail, so mean
      // width ≈ 0.65×size and mean alpha ≈ (1 - fade/2) of the head's.
      if (layer.trail) {
        const fade = layer.trail.fade ?? 1;
        const span = sweptDistance(e, layer.trail.length);
        area += span * sz * 0.65 * Math.max(0, 1 - fade / 2) * a;
      }
      // Ghost smear: ink from m frames back survives at g^m, so the sweep over
      // the visible window carries the window's mean surviving weight.
      if (ghost > 0) {
        area += sweptDistance(e, ghostWindowMs) * sz * ghostMeanW * a;
      }
      lumAcc += spriteLuma(layer, e);
    }
    if (layer.links && entities.length > 1) {
      const positions = entities.map((e) => posOf(scene, e, t));
      const motionWraps = ['drift', 'rise', 'wander'].includes(layer.motion.type);
      const edges = linkEdges(layer.links, positions, linkMaxDistPx(layer.links, scale), layer.wrap !== false && motionWraps, w, h);
      const la = (layer.links.alpha ?? 0.6) * lifeA;
      const defaultWidth = scale === 1 ? 1 : 1 / LIMITS.referenceViewport;
      const lw = (layer.links.width ?? defaultWidth) * scale;
      for (const edge of edges) area += edge.dist * lw * la * LINE_SALIENCE;
    }
    const meanLuma = entities.length ? lumAcc / entities.length : 0;
    const contrast = Math.abs(meanLuma - bgMean) + 0.1;
    const blendBoost = layer.blend === 'lighter' || layer.blend === 'screen' ? 1.3 : layer.blend === 'multiply' ? 1.1 : 1;
    const motionBoost = layer.motion.type === 'static' ? 1 : 1.2;
    const weight = (area / (w * h)) * contrast * blendBoost * motionBoost;
    return { layerIndex, key: layer.key, weight, entityCount: entities.length, meanLuma, factors: { area: area / (w * h), contrast, blendBoost, motionBoost } };
  });

  return raw;
}

// ---------------------------------------------------------------------------
// Motion stats
// ---------------------------------------------------------------------------

/**
 * Does each layer read as one merged form or as separate marks? The one thing
 * the luminance maps cannot answer — they measure ink, not edges, so a layer
 * that merged into a silhouette and one that stayed a pile of discs look
 * identical in every other channel. See `cohesion.ts`.
 */
export function layerCohesion(spec: SaverSpec, opts: PerceiveOptions = {}): LayerCohesion[] {
  spec = resolveTimelineAt(spec, opts.t ?? 5000);
  const scene = buildScene(spec, opts);
  return cohesionOf(scene.layers, opts.t ?? 5000, scene.w, scene.h);
}

export interface LayerMotionStats {
  layerIndex: number;
  key: string | undefined;
  /** Mean / max on-screen speed in px per second at the perceived size (wrap jumps excluded). */
  meanSpeed: number;
  maxSpeed: number;
  /**
   * The same speeds in **viewport units per second** — fractions of
   * min(w, h), the unit a spec's `speed` is authored in — so they do not
   * change with the size the scene is perceived at. 1.0 crosses the short side
   * of the screen every second.
   */
  meanSpeedVp: number;
  maxSpeedVp: number;
  /** meanSpeedVp above MOVING_FLOOR — the same answer at every preview size. */
  moving: boolean;
  /**
   * Direction the layer's mass is going, in screen degrees (0 = right,
   * 90 = down, 180 = left, 270 = up), or null when nothing moves. Sampling a
   * centroid over time gives the WRONG sign for a wrapping full-viewport
   * scatter, which is why this is reported directly.
   */
  heading: number | null;
  /**
   * 0 = every entity moves the same way (a conveyor — the "screen-wipe" the
   * schema warns about), 1 = headings cancel out (a scatter, an orbit, a
   * bounce field). |mean unit vector| inverted.
   */
  headingSpread: number | null;
}

/**
 * Below this many viewport units per second a layer reads as still (half a
 * pixel per second on a 1080 display — what the old px/s threshold of 0.5
 * meant at that one resolution).
 */
const MOVING_FLOOR = 0.0005;


/**
 * Per-layer displacement between t and t+dt — choreography as numbers.
 *
 * Samples the scene at both ends of the window separately (not just each
 * entity's own position within one scene) so a `timeline`-driven layer
 * `transform` — a camera pan or zoom with every entity otherwise static —
 * registers as motion instead of vanishing between two reads of the same
 * frozen transform.
 */
export function motionStats(spec: SaverSpec, opts: PerceiveOptions & { dt?: number } = {}): LayerMotionStats[] {
  const t = opts.t ?? 5000;
  const dt = opts.dt ?? 500;
  const scene0 = buildScene(resolveTimelineAt(spec, t), opts);
  const scene1 = spec.timeline ? buildScene(resolveTimelineAt(spec, t + dt), opts) : scene0;
  const { w, h } = scene0;
  const unit = Math.min(w, h);
  return scene0.layers.map(({ layer, entities }, layerIndex) => {
    const entities1 = scene1.layers[layerIndex]?.entities ?? entities;
    const spinVisible = layer.sprite.kind !== 'circle' && layer.sprite.kind !== 'ring';
    let acc = 0;
    let max = 0;
    let n = 0;
    let ux = 0;
    let uy = 0;
    let moversN = 0;
    entities.forEach((e, i) => {
      const p0 = posOf(scene0, e, t);
      const p1 = posOf(scene1, entities1[i] ?? e, t + dt);
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      if (Math.abs(dx) > w / 2 || Math.abs(dy) > h / 2) return; // wrap seam
      const dist = Math.sqrt(dx * dx + dy * dy);
      // A spinning shape moves its ink even when its centre stands still:
      // add the turn's speed at the mean ink radius (~1/3 of its size). A
      // circle or ring looks the same turned, so only shapes count (X607).
      const turn = spinVisible ? Math.abs(rotationAt(entities1[i] ?? e, t + dt) - rotationAt(e, t)) * (sizeAt(e, t) / 3) : 0;
      const speed = (Math.sqrt(dist * dist + turn * turn) / dt) * 1000;
      acc += speed;
      max = Math.max(max, speed);
      n++;
      if (dist > 0) {
        ux += dx / dist;
        uy += dy / dist;
        moversN++;
      }
    });
    const meanSpeed = n ? acc / n : 0;
    const meanSpeedVp = meanSpeed / unit;
    const maxSpeedVp = max / unit;
    const moving = meanSpeedVp > MOVING_FLOOR;
    let heading: number | null = null;
    let headingSpread: number | null = null;
    if (moving && moversN > 0) {
      const mx = ux / moversN;
      const my = uy / moversN;
      const mag = Math.sqrt(mx * mx + my * my);
      headingSpread = 1 - mag;
      heading = mag > 0.05 ? ((Math.atan2(my, mx) * 180) / Math.PI + 360) % 360 : null;
    }
    return { layerIndex, key: layer.key, meanSpeed, maxSpeed: max, meanSpeedVp, maxSpeedVp, moving, heading, headingSpread };
  });
}

// ---------------------------------------------------------------------------
// Colour — the channel edits are usually about
// ---------------------------------------------------------------------------

export interface SceneColour {
  /** Hue of the visible sprite mass in degrees (0 red, 120 green, 240 blue), null when unsaturated. */
  hue: number | null;
  /** HSL saturation 0..1 of the sprite mass. */
  saturation: number;
  /** red minus blue of the mean sprite colour, -1 (cold) .. 1 (warm). The "cooler/warmer" axis. */
  warmth: number;
  /** Mean sprite colour as hex, for a model that reads hex better than angles. */
  hex: string;
  /** The same three numbers for the background plate. */
  background: { hue: number | null; saturation: number; warmth: number; hex: string };
}

function rgbToHsl(c: { r: number; g: number; b: number }): { h: number | null; s: number; l: number } {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return { h: null, s: 0, l };
  const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === c.r) h = ((c.g - c.b) / d + (c.g < c.b ? 6 : 0)) * 60;
  else if (max === c.g) h = ((c.b - c.r) / d + 2) * 60;
  else h = ((c.r - c.g) / d + 4) * 60;
  return { h: sat < 0.05 ? null : h, s: sat, l };
}

function toHex(c: { r: number; g: number; b: number }): string {
  const q = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${q(c.r)}${q(c.g)}${q(c.b)}`;
}

function describeColour(c: { r: number; g: number; b: number }): { hue: number | null; saturation: number; warmth: number; hex: string } {
  const hsl = rgbToHsl(c);
  return { hue: hsl.h === null ? null : Math.round(hsl.h), saturation: +hsl.s.toFixed(3), warmth: +(c.r - c.b).toFixed(3), hex: toHex(c) };
}

/**
 * What colour the scene IS — the alpha × area weighted mean of every hex a
 * sprite paints with, beside the background plate. A luminance map cannot
 * carry this: a luma-matched red→cyan swap moves every other channel by
 * ~0.001 (comprehension eval 2026-07-28, P2 F3), and `meanLuminance` reads
 * plausible cool tones as *brighter* than the reds they replace, so "make it
 * cooler" pushed the only number an agent had in the wrong direction. Emoji
 * carry their own palette and are excluded; a scene of only emoji reports the
 * background.
 */
export function sceneColour(spec: SaverSpec, opts: PerceiveOptions = {}): SceneColour {
  const t = opts.t ?? 5000;
  // A timeline can animate colour: read the scene as it is at t.
  spec = resolveTimelineAt(spec, t);
  const scene = buildScene(spec, opts);
  let wr = 0;
  let wg = 0;
  let wb = 0;
  let wsum = 0;
  for (const { layer, entities } of scene.layers) {
    // Paint opacity (layer × group) weighs like alpha: a hidden prop adds no colour.
    const lifeA = lifeAlphaAt(layer.life, t) * (layer.opacity === undefined && layer.group === undefined ? 1 : paintOpacity(spec, layer));
    const k = layer.transform !== undefined || layer.group !== undefined ? paintSize(spec, layer) : 1;
    const add = (hex: string, weight: number): void => {
      if (weight <= 0) return;
      const c = hexRgb(hex);
      wr += c.r * weight;
      wg += c.g * weight;
      wb += c.b * weight;
      wsum += weight;
    };
    for (const e of entities) {
      const sz = sizeAt(e, t);
      const s = layer.sprite;
      const a = alphaAt(e, t) * lifeA * onScreenFraction(scene, s, e, sz, k, t);
      if (a <= 0) continue;
      // A path drawing is the colours its parts paint, by the ink each lays
      // down: a part at opacity 0 adds nothing (X609).
      if (s.kind === 'polygon' && isPathPolygon(s)) {
        const fr = pathFrame(s, sz / 2, scene.w, scene.h);
        const base = s.colors?.[e.colorIndex] ?? s.color;
        for (const part of pathParts(s)) {
          const ink = partInkArea(part, fr.sx, fr.sy);
          if (part.gradient) for (const st of part.gradient.stops) add(st.color, (a * ink.fill * (st.opacity ?? 1)) / part.gradient.stops.length);
          else add(part.color ?? base, a * ink.fill);
          if (part.stroke) add(part.stroke.color, a * ink.stroke);
        }
        continue;
      }
      const hex = spriteHex(layer, e);
      if (hex === null) continue;
      add(hex, a * (s.kind === 'circle' ? Math.PI * (sz / 2) * (sz / 2) : sz * sz));
    }
  }
  const bg = backgroundRgb(spec);
  const sprites = wsum > 0 ? { r: wr / wsum, g: wg / wsum, b: wb / wsum } : bg;
  return { ...describeColour(sprites), background: describeColour(bg) };
}

/** Signed shortest hue difference b − a in degrees (−180..180), null when either is unsaturated. */
function hueShift(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return Math.round(d);
}

// ---------------------------------------------------------------------------
// Scene diff — relative sight
// ---------------------------------------------------------------------------

const REGION_NAMES = [
  'top-left', 'top-center', 'top-right',
  'mid-left', 'center', 'mid-right',
  'bottom-left', 'bottom-center', 'bottom-right',
] as const;

function regionMeans(grid: LuminanceGrid): number[] {
  const out = new Array<number>(9).fill(0);
  const cnt = new Array<number>(9).fill(0);
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const idx = r * grid.cols + c;
      const region = Math.min(2, Math.floor((r / grid.rows) * 3)) * 3 + Math.min(2, Math.floor((c / grid.cols) * 3));
      // A field's own contours are ground, not content (see `backgroundCells`
      // on `LuminanceGrid`): deviate against the per-cell background where
      // one exists, the same rule `finishGrid` applies to coverage/centroid.
      out[region]! += Math.abs(grid.cells[idx]! - (grid.backgroundCells ? grid.backgroundCells[idx]! : grid.background[r]!));
      cnt[region]!++;
    }
  }
  return out.map((v, i) => (cnt[i]! ? v / cnt[i]! : 0));
}

export interface SceneDiff {
  t: number;
  coverage: { a: number; b: number; delta: number };
  meanLuminance: { a: number; b: number; delta: number };
  /** Shift of the visual-mass centroid from A to B, in viewport fractions. */
  balanceShift: { dx: number; dy: number } | null;
  /** Mean deviation-from-background per third-by-third region, with deltas. */
  regions: Array<{ region: (typeof REGION_NAMES)[number]; a: number; b: number; delta: number }>;
  /** Dominance changes, matched by layer key (falls back to index). Sorted by |share delta|. */
  dominance: Array<{ key: string; rankA: number | null; rankB: number | null; shareA: number; shareB: number }>;
  /**
   * The hue channel. `hueShift` is the signed shortest rotation A→B in
   * degrees; `warmthDelta` is the cooler/warmer axis (negative = B is cooler)
   * — read THIS for "cooler", not `meanLuminance`, which weights cool tones
   * brighter than the reds they replace.
   */
  colour: {
    a: SceneColour;
    b: SceneColour;
    hueShift: number | null;
    saturationDelta: number;
    warmthDelta: number;
    background: { hueShift: number | null; warmthDelta: number };
  };
  /**
   * The motion channel, in viewport units per second. `overall` is the
   * entity-weighted mean across layers; `layers` lists every layer whose speed
   * changed, largest change first. Halving every speed used to leave the diff
   * bit-identical (comprehension eval 2026-07-28, P2 F4).
   */
  motion: {
    overall: { a: number; b: number; delta: number };
    layers: Array<{ key: string; a: number; b: number; delta: number; headingA: number | null; headingB: number | null }>;
  };
  advisories: { added: string[]; removed: string[] };
}

/**
 * Compare two specs at the same time/viewport — relative perception. A text
 * model is far better at "is B better than A" than "is A good"; this returns
 * the deltas that question needs: coverage, balance, per-region visual mass,
 * dominance-rank movement, and advisory changes.
 */
export function diffScenes(a: SaverSpec, b: SaverSpec, opts: LuminanceGridOptions = {}): SceneDiff {
  const t = opts.t ?? 5000;
  const gridA = luminanceGrid(a, opts);
  const gridB = luminanceGrid(b, opts);
  const regsA = regionMeans(gridA);
  const regsB = regionMeans(gridB);
  const domA = dominanceRanking(a, opts);
  const domB = dominanceRanking(b, opts);

  const nameOf = (d: DominanceEntry): string => d.key ?? `layer-${d.layerIndex}`;
  const names = new Set<string>([...domA.map(nameOf), ...domB.map(nameOf)]);
  const dominance = [...names].map((key) => {
    const inA = domA.find((d) => nameOf(d) === key);
    const inB = domB.find((d) => nameOf(d) === key);
    return {
      key,
      rankA: inA?.rank ?? null,
      rankB: inB?.rank ?? null,
      shareA: inA?.share ?? 0,
      shareB: inB?.share ?? 0,
    };
  }).sort((x, y) => Math.abs(y.shareB - y.shareA) - Math.abs(x.shareB - x.shareA));

  // Advise at the diff's OWN viewport. This used to run at the 1920×1080
  // default while the caller previewed at 960×540, so the two tools disagreed
  // about the same spec's advisories (comprehension eval 2026-07-28, P3 F6).
  const vp = opts.viewport ?? { width: 1920, height: 1080 };
  const codesA = new Set(adviseSpec(a, vp).map((w) => w.code));
  const codesB = new Set(adviseSpec(b, vp).map((w) => w.code));

  const colA = sceneColour(a, opts);
  const colB = sceneColour(b, opts);
  const motA = motionStats(a, opts);
  const motB = motionStats(b, opts);
  const weighted = (stats: LayerMotionStats[], dom: DominanceEntry[]): number => {
    let acc = 0;
    let n = 0;
    for (const m of stats) {
      const c = dom.find((d) => d.layerIndex === m.layerIndex)?.entityCount ?? 1;
      acc += m.meanSpeedVp * c;
      n += c;
    }
    return n ? acc / n : 0;
  };
  const motNameOf = (m: LayerMotionStats): string => m.key ?? `layer-${m.layerIndex}`;
  const motionLayers = [...new Set([...motA.map(motNameOf), ...motB.map(motNameOf)])]
    .map((key) => {
      const ma = motA.find((m) => motNameOf(m) === key);
      const mb = motB.find((m) => motNameOf(m) === key);
      const va = ma?.meanSpeedVp ?? 0;
      const vb = mb?.meanSpeedVp ?? 0;
      return { key, a: va, b: vb, delta: vb - va, headingA: ma?.heading ?? null, headingB: mb?.heading ?? null };
    })
    .filter((m) => Math.abs(m.delta) > 1e-9 || m.headingA !== m.headingB)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const overallA = weighted(motA, domA);
  const overallB = weighted(motB, domB);

  return {
    t,
    coverage: { a: gridA.coverage, b: gridB.coverage, delta: gridB.coverage - gridA.coverage },
    meanLuminance: { a: gridA.meanLuminance, b: gridB.meanLuminance, delta: gridB.meanLuminance - gridA.meanLuminance },
    balanceShift: gridA.centroid && gridB.centroid
      ? { dx: gridB.centroid.x - gridA.centroid.x, dy: gridB.centroid.y - gridA.centroid.y }
      : null,
    regions: REGION_NAMES.map((region, i) => ({ region, a: regsA[i]!, b: regsB[i]!, delta: regsB[i]! - regsA[i]! })),
    dominance,
    colour: {
      a: colA,
      b: colB,
      hueShift: hueShift(colA.hue, colB.hue),
      saturationDelta: +(colB.saturation - colA.saturation).toFixed(3),
      warmthDelta: +(colB.warmth - colA.warmth).toFixed(3),
      background: {
        hueShift: hueShift(colA.background.hue, colB.background.hue),
        warmthDelta: +(colB.background.warmth - colA.background.warmth).toFixed(3),
      },
    },
    motion: {
      overall: { a: overallA, b: overallB, delta: overallB - overallA },
      layers: motionLayers,
    },
    advisories: {
      added: [...codesB].filter((c) => !codesA.has(c)),
      removed: [...codesA].filter((c) => !codesB.has(c)),
    },
  };
}

// ---------------------------------------------------------------------------
// One-call perception bundle
// ---------------------------------------------------------------------------

export interface ScenePerception {
  t: number;
  /** The picture: a braille luminance map (each char = 2×4 pixels), compact. */
  braille: string;
  /**
   * A one-char-per-cell ASCII density map at the grid resolution — higher
   * fidelity than braille for structure (rings, grids, text blocks). Pair with
   * a larger `cols`/`rows` for a sharper read.
   */
  density: string;
  coverage: number;
  meanLuminance: number;
  centroid: { x: number; y: number } | null;
  rowProfile: number[];
  colProfile: number[];
  dominance: DominanceEntry[];
  motion: LayerMotionStats[];
  /** Per layer: merged silhouette, seamed overlap, or separate marks. */
  form: LayerCohesion[];
  /** What colour the scene is — hue/saturation/warmth of the sprite mass and the plate. */
  colour: SceneColour;
  /** Literal strings + sizes of any text layers (glyphs don't show in the maps). */
  text: TextSpriteInfo[];
  advisories: ReturnType<typeof adviseSpec>;
}

/**
 * Everything a non-vision agent needs to "see" a spec in one deterministic
 * call: the braille picture, a higher-res density map, composition transects,
 * dominance ranking, motion stats, the literal text on screen, and advisories.
 * Intended as the payload behind an MCP previewScene.
 */
export function perceiveScene(spec: SaverSpec, opts: LuminanceGridOptions = {}): ScenePerception {
  // motionStats gets the spec WITH its timeline: it resolves t and t + dt
  // itself, and a pre-resolved spec has no timeline left to differ between
  // them — every layer moved only by timeline keys read 0 px/s (X437).
  const timed = spec;
  spec = resolveTimelineAt(spec, opts.t ?? 5000);
  const grid = luminanceGrid(spec, opts);
  return {
    t: opts.t ?? 5000,
    braille: renderBrailleMap(grid),
    density: renderDensityMap(grid),
    coverage: grid.coverage,
    meanLuminance: grid.meanLuminance,
    centroid: grid.centroid,
    rowProfile: grid.rowProfile,
    colProfile: grid.colProfile,
    dominance: dominanceRanking(spec, opts),
    motion: motionStats(timed, opts),
    form: layerCohesion(spec, opts),
    colour: sceneColour(spec, opts),
    text: textSprites(spec, opts),
    advisories: adviseSpec(spec, opts.viewport ?? { width: 1920, height: 1080 }, { t: opts.t, seed: opts.seed }),
  };
}

// ---------------------------------------------------------------------------
// Sequence frames — bed + segment
// ---------------------------------------------------------------------------

export interface SequenceFramePerception extends ScenePerception {
  /** Which segment the global time `T` resolved to, and where in it. */
  segment: { index: number; key: string; localT: number; held?: true };
  /** True when a bed was composed under the segment. */
  bed: boolean;
}

export interface PerceiveSequenceOptions extends Omit<LuminanceGridOptions, 't'> {
  /** Holds released by the clicker so far — see `ResolveOptions.releasedBelow`. */
  releasedBelow?: number;
}

/** Prefix bed layers so they read apart from the segment's in a merged list. */
const bedKey = (key: string | undefined, layerIndex: number): string => `bed:${key ?? layerIndex}`;

/**
 * Perceive one frame of a sequence at global time `T`: resolve the segment,
 * then — when the sequence has a `bed` — compose the bed at `T` (its clock
 * never resets) under the segment's ink at `localT`, the segment's own
 * background dropped, exactly as the renderer stacks them. The luminance maps
 * add the two grids (clamped), so coverage, centroid and the profiles are of
 * the composite; dominance ranks bed and segment layers together by their raw
 * weights, bed layers keyed `bed:<key|index>`; text, motion and form list bed
 * layers first with the same prefix. Bed and segment are assumed to share
 * `units`/`referenceViewport`, as the renderer's shared canvas assumes. The
 * bed and segment seeds come from `segmentRenderSeed`/`bedRenderSeed`
 * (`./sequence`) — the same derivation `SequenceInstance` uses, chain roots
 * and zero-seed normalization included — so the composed frame matches what
 * the renderer actually draws at `T`, not just what the raw specs would show.
 * Without a bed this is `perceiveScene(segment, localT)` plus the `segment`
 * field. Intended as the payload behind a sequence-aware previewScene.
 *
 * Two known approximations, both accepted for a coarse, cheap, renderer-free
 * tool rather than fixed here:
 * - **The transition WINDOW isn't composed.** During a live `fade` or `morph`
 *   (i.e. `localT < transition.dur`) the renderer also paints the outgoing
 *   (or interpolating) segment, but this only ever perceives the segment
 *   `resolveSegment` resolves to — call it at a `T` outside the transition's
 *   `dur` for an accurate read. (Outside that window, a morph-chained
 *   segment's entities and seed ARE correct — `segmentRenderSeed` already
 *   resolves the chain root.) Composing the live window properly needs the
 *   same capability-tier gate `SequenceInstance` uses to decide whether
 *   `fade` even plays; this analytical path has no such context.
 * - **Ink composites onto the bed by addition, not by blend mode.** This
 *   matches a plain `source-over`, opaque-ink segment (the common case), but
 *   a segment layer with `blend: 'multiply'`/`'screen'`/etc. or partial alpha
 *   composites directionally differently on the real canvas than adding
 *   luminance values ever can (`multiply` darkens; addition only brightens).
 *   The per-cell grids don't retain per-layer blend/alpha to composite
 *   correctly at this resolution.
 */
export function perceiveSequenceFrame(seq: IdleSequence, T: number, opts: PerceiveSequenceOptions = {}): SequenceFramePerception {
  const { releasedBelow, ...gridOpts } = opts;
  const r = resolveSegment(seq, T, { releasedBelow });
  const seg = seq.segments[r.index]!;
  const segment: SequenceFramePerception['segment'] = { index: r.index, key: seg.key, localT: r.localT, ...(r.held ? { held: true } : {}) };
  const segOpts: LuminanceGridOptions = { ...gridOpts, t: r.localT, seed: gridOpts.seed ?? segmentRenderSeed(seq, r.index) };
  if (!seq.bed) return { ...perceiveScene(seg.scene, segOpts), segment, bed: false };

  const bedOpts: LuminanceGridOptions = { ...gridOpts, t: T, seed: gridOpts.seed ?? bedRenderSeed(seq) };
  const viewport = gridOpts.viewport ?? { width: 1920, height: 1080 };
  // The segment's ink alone: a black ground contributes nothing to the sum,
  // and no ghosting — a transparent child ignores it, as the renderer does.
  const ink: SaverSpec = { ...seg.scene, background: { type: 'solid', color: '#000000' } };
  delete ink.ghosting;
  // For contrast, ink is judged against what is actually behind it: the bed.
  const inkOverBed: SaverSpec = { ...ink, background: seq.bed.background ?? { type: 'solid', color: '#05050a' } };

  const bedGrid = luminanceGrid(seq.bed, bedOpts);
  const inkGrid = luminanceGrid(ink, segOpts);
  const cells = bedGrid.cells.map((v, i) => Math.min(1, v + inkGrid.cells[i]!));
  const grid = finishGrid(bedGrid.cols, bedGrid.rows, cells, bedGrid.background, bedGrid.backgroundCells);

  const bedLayers = seq.bed.layers.length;
  const dominance = rankDominance([
    ...rawDominance(seq.bed, bedOpts).map((d) => ({ ...d, key: bedKey(d.key, d.layerIndex) })),
    ...rawDominance(inkOverBed, segOpts).map((d) => ({ ...d, layerIndex: d.layerIndex + bedLayers })),
  ]);
  const shift = <X extends { layerIndex: number }>(x: X): X => ({ ...x, layerIndex: x.layerIndex + bedLayers });
  const prefix = <X extends { layerIndex: number; key: string | undefined }>(x: X): X => ({ ...x, key: bedKey(x.key, x.layerIndex) });

  return {
    t: r.localT,
    braille: renderBrailleMap(grid),
    density: renderDensityMap(grid),
    coverage: grid.coverage,
    meanLuminance: grid.meanLuminance,
    centroid: grid.centroid,
    rowProfile: grid.rowProfile,
    colProfile: grid.colProfile,
    dominance,
    motion: [...motionStats(seq.bed, bedOpts).map(prefix), ...motionStats(ink, segOpts).map(shift)],
    form: [...layerCohesion(seq.bed, bedOpts).map(prefix), ...layerCohesion(ink, segOpts).map(shift)],
    text: [...textSprites(seq.bed, bedOpts).map(prefix), ...textSprites(ink, segOpts).map(shift)],
    // The segment's sprite mass over the bed's plate — what the screen shows
    // in front of the bed. The bed's own sprites are a slow constant beneath.
    colour: sceneColour(inkOverBed, segOpts),
    advisories: [
      ...adviseSpec(seq.bed, viewport, { t: T, seed: bedOpts.seed }).map((w) => ({ ...w, path: `bed.${w.path}` })),
      // inkOverBed's layers are the segment's (seed: segOpts.seed) but its
      // background is the bed's (seq.bed.background) — a field there must be
      // sampled with the bed's own seed, or a `role: 'read'` legibility
      // advisory checks terrain that isn't what's actually behind the ink.
      // `?? 42`: inkOverBed.seed is the SEGMENT's raw seed field (it's `ink`
      // spread first), so adviseSpec's own `backgroundSeed ?? seed` fallback
      // would substitute the segment's seed, not the bed's, if bedOpts.seed
      // were left undefined — 42 is the same default `luminanceGrid` (and
      // every other field seed fallback) converges on.
      ...adviseSpec(inkOverBed, viewport, { t: r.localT, seed: segOpts.seed, backgroundSeed: bedOpts.seed ?? 42 }),
    ],
    segment,
    bed: true,
  };
}
