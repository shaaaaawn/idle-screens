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
import {
  alphaAt,
  buildEntities,
  headingAt,
  lifeAlphaAt,
  linkEdges,
  positionAt,
  sizeAt,
  type Entity,
} from './simulate';
import { LIMITS, type LayerSpec, type SaverSpec } from './types';

// ---------------------------------------------------------------------------
// Shared scene construction (mirrors describeScene/adviseSpec)
// ---------------------------------------------------------------------------

interface BuiltScene {
  w: number;
  h: number;
  scale: number;
  layers: Array<{ layer: LayerSpec; entities: Entity[] }>;
  byKey: Map<string, Entity[]>;
}

export interface PerceiveOptions {
  viewport?: { width: number; height: number };
  seed?: number;
  /** Sample time in ms. Default 5000 (past all typical life.enter staging). */
  t?: number;
}

function buildScene(spec: SaverSpec, opts: PerceiveOptions): BuiltScene {
  const { width: w, height: h } = opts.viewport ?? { width: 1920, height: 1080 };
  const seed = opts.seed ?? spec.seed ?? 42;
  const scale = spec.units === 'px' ? 1 : Math.min(w, h);
  const refVp = spec.referenceViewport ?? LIMITS.referenceViewport;
  let countScale = scale > 1 ? Math.min(w, h) / refVp : 1;
  if (countScale > 1) {
    const rawTotal = spec.layers.reduce((s, l) => s + Math.round(l.count * countScale), 0);
    if (rawTotal > LIMITS.maxTotal) countScale *= LIMITS.maxTotal / rawTotal;
  }
  const rng = createRng(seed);
  const layers = spec.layers.map((layer) => ({ layer, entities: buildEntities(layer, rng, w, h, scale, countScale) }));
  const byKey = new Map<string, Entity[]>();
  for (const { layer, entities } of layers) if (layer.key) byKey.set(layer.key, entities);
  return { w, h, scale, layers, byKey };
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
  return p;
}

/** Perceptual luma (0..1) of a hex colour. */
function hexLuma(hex: string): number {
  const h = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const n = parseInt(h.slice(1), 16);
  if (Number.isNaN(n)) return 0.7;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function spriteLuma(layer: LayerSpec, e: Entity): number {
  const s = layer.sprite;
  if (s.kind === 'circle' || s.kind === 'ring' || s.kind === 'streak' || s.kind === 'rect') {
    return hexLuma(s.colors?.[e.colorIndex] ?? s.color);
  }
  if (s.kind === 'text') return hexLuma(s.color ?? '#e6e8ef');
  return 0.75; // emoji: mid-bright approximation
}

/**
 * Text bounding box + anchor, matching the renderer's font rule: a CSS
 * shorthand containing a px size overrides the seeded per-entity size.
 * Returns the box CENTRE (accounting for align/baseline) and half-extents.
 */
function textBox(
  s: Extract<LayerSpec['sprite'], { kind: 'text' }>,
  e: Entity,
  p: { x: number; y: number },
): { cx: number; cy: number; halfX: number; halfY: number } {
  const m = s.font ? /(\d+(?:\.\d+)?)px/.exec(s.font) : null;
  const fh = m ? Number(m[1]) : e.size;
  const str = s.strings[e.spriteIndex] ?? s.strings[0] ?? '';
  const fw = Math.max(fh, 0.62 * fh * Math.min(str.length, 48));
  const align = s.align ?? 'center';
  const baseline = s.baseline ?? 'middle';
  return {
    cx: align === 'left' ? p.x + fw / 2 : align === 'right' ? p.x - fw / 2 : p.x,
    cy: baseline === 'top' ? p.y + fh * 0.6 : baseline === 'bottom' ? p.y - fh * 0.6 : p.y,
    halfX: fw / 2,
    halfY: fh * 0.6,
  };
}

// ---------------------------------------------------------------------------
// Luminance grid
// ---------------------------------------------------------------------------

export interface LuminanceGrid {
  cols: number;
  rows: number;
  /** Row-major luminance 0..1 including the background. */
  cells: number[];
  /** Per-row background luminance (what an empty scene would be). */
  background: number[];
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

/**
 * Sample the spec into a coarse luminance image — analytically, no renderer.
 * Approximations (documented, deliberate): trails and ghosting are ignored,
 * soft circles use a linear falloff, background drift is sampled at its rest
 * position. Good enough to perceive composition, focus, and balance.
 */
export function luminanceGrid(spec: SaverSpec, opts: LuminanceGridOptions = {}): LuminanceGrid {
  const scene = buildScene(spec, opts);
  const t = opts.t ?? 5000;
  const cols = Math.max(8, Math.min(200, opts.cols ?? 80));
  const rows = Math.max(8, Math.min(200, opts.rows ?? 48));
  const { w, h, scale } = scene;
  const cellW = w / cols;
  const cellH = h / rows;

  // Background: vertical gradient (or solid) + optional bottom band.
  const bg = spec.background;
  const bgRow: number[] = new Array(rows).fill(0);
  if (!bg || bg.type === 'solid') {
    bgRow.fill(hexLuma(bg?.color ?? '#05050a'));
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
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells[r * cols + c] = bgRow[r]!;

  const compose = (idx: number, lum: number, a: number, blend: LayerSpec['blend']): void => {
    const cur = cells[idx]!;
    if (blend === 'lighter' || blend === 'screen') cells[idx] = Math.min(1, cur + lum * a);
    else if (blend === 'multiply') cells[idx] = cur * (1 - a * (1 - lum));
    else cells[idx] = cur * (1 - a) + lum * a;
  };

  for (const { layer, entities } of scene.layers) {
    const lifeA = lifeAlphaAt(layer.life, t);
    if (lifeA <= 0) continue;

    for (const e of entities) {
      const a = Math.min(1, alphaAt(e, t) * lifeA);
      if (a <= 0.004) continue;
      const lum = spriteLuma(layer, e);
      const p = posOf(scene, e, t);
      const sz = sizeAt(e, t);
      const s = layer.sprite;

      if (s.kind === 'streak') {
        // Stamp along the segment from tail to head.
        const heading = headingAt(e, t, w, h) ?? 0;
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
        const box = textBox(s, e, p);
        centerX = box.cx;
        centerY = box.cy;
        halfX = box.halfX;
        halfY = box.halfY;
      }
      const c0 = Math.max(0, Math.floor((centerX - halfX) / cellW));
      const c1 = Math.min(cols - 1, Math.floor((centerX + halfX) / cellW));
      const r0 = Math.max(0, Math.floor((centerY - halfY) / cellH));
      const r1 = Math.min(rows - 1, Math.floor((centerY + halfY) / cellH));
      const circular = s.kind === 'circle' || s.kind === 'ring';
      const soft = s.kind === 'circle' && s.soft;
      // Glyphs don't fill their box — ink is sparse.
      const inkWeight = s.kind === 'text' || s.kind === 'emoji' ? 0.55 : 1;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const dx = (c + 0.5) * cellW - centerX;
          const dy = (r + 0.5) * cellH - centerY;
          if (circular) {
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > halfX + Math.min(cellW, cellH) / 2) continue;
            if (s.kind === 'ring' && d < halfX * 0.7) continue; // hollow centre
            const wgt = soft ? Math.max(0.1, 1 - d / Math.max(halfX, 1e-6)) : 1;
            compose(r * cols + c, lum, a * wgt, layer.blend);
          } else {
            compose(r * cols + c, lum, a * inkWeight, layer.blend);
          }
        }
      }
    }

    // Link lines are visual mass too (for chain scenes they ARE the scene).
    if (layer.links) {
      const positions = entities.map((e) => posOf(scene, e, t));
      const maxDistPx = layer.links.maxDist * scale;
      const motionWraps = ['drift', 'rise', 'wander'].includes(layer.motion.type);
      const edges = linkEdges(layer.links, positions, maxDistPx, layer.wrap !== false && motionWraps, w, h);
      const la = Math.min(1, (layer.links.alpha ?? 0.6) * lifeA);
      const lum = layer.links.color ? hexLuma(layer.links.color) : 0.7;
      const wgt = Math.min(1, ((layer.links.width ?? 1) * scale) / cellH) * la;
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

  // Deviation stats
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
      const dev = Math.abs(v - bgRow[r]!);
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
 * Encode a luminance grid as a braille "image": each output character is a 2×4
 * pixel cell, ordered-dithered so mid-tones render as dot density. A grid of
 * 80×48 becomes 12 lines of 40 chars — a picture a text model can read whole.
 *
 * Auto-exposure: most savers live in the bottom of the luminance range, so the
 * cells are normalized (min → 98th percentile) before dithering — like a
 * camera exposing for the scene. Stats on the grid itself stay raw.
 */
export function renderBrailleMap(grid: LuminanceGrid): string {
  const sorted = [...grid.cells].sort((a, b) => a - b);
  const lo = sorted[0]!;
  const hi = Math.max(sorted[Math.floor(sorted.length * 0.98)]!, lo + 0.08);
  const expose = (v: number): number => Math.pow(Math.max(0, Math.min(1, (v - lo) / (hi - lo))), 0.8);

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
 * additive-glow boost, and a motion boost. Link lines count as area.
 */
export function dominanceRanking(spec: SaverSpec, opts: PerceiveOptions = {}): DominanceEntry[] {
  const scene = buildScene(spec, opts);
  const t = opts.t ?? 5000;
  const { w, h, scale } = scene;

  const bgMean = (() => {
    const bg = spec.background;
    if (!bg || bg.type === 'solid') return hexLuma(bg?.color ?? '#05050a');
    return bg.stops.reduce((s, st) => s + hexLuma(st.color), 0) / bg.stops.length;
  })();

  const raw = scene.layers.map(({ layer, entities }, layerIndex) => {
    const lifeA = lifeAlphaAt(layer.life, t);
    let area = 0;
    let lumAcc = 0;
    for (const e of entities) {
      const a = alphaAt(e, t) * lifeA;
      const sz = sizeAt(e, t);
      const s = layer.sprite;
      let entArea: number;
      if (s.kind === 'circle') entArea = Math.PI * (sz / 2) * (sz / 2);
      else if (s.kind === 'ring') entArea = Math.PI * sz * ((s.width ?? (scale === 1 ? 2 : 0.002)) * scale);
      else if (s.kind === 'streak') entArea = sz * ((s.width ?? (scale === 1 ? 2 : 0.002)) * scale);
      else if (s.kind === 'rect') entArea = sz * (e.size2 ?? sz);
      else if (s.kind === 'text') {
        const box = textBox(s, e, { x: 0, y: 0 });
        entArea = box.halfX * 2 * box.halfY * 2 * 0.55; // sparse glyph ink
      } else entArea = sz * sz * 0.55; // emoji

      area += entArea * a;
      lumAcc += spriteLuma(layer, e);
    }
    if (layer.links && entities.length > 1) {
      const positions = entities.map((e) => posOf(scene, e, t));
      const motionWraps = ['drift', 'rise', 'wander'].includes(layer.motion.type);
      const edges = linkEdges(layer.links, positions, layer.links.maxDist * scale, layer.wrap !== false && motionWraps, w, h);
      const la = (layer.links.alpha ?? 0.6) * lifeA;
      const lw = (layer.links.width ?? 1) * scale;
      for (const edge of edges) area += edge.dist * lw * la;
    }
    const meanLuma = entities.length ? lumAcc / entities.length : 0;
    const contrast = Math.abs(meanLuma - bgMean) + 0.1;
    const blendBoost = layer.blend === 'lighter' || layer.blend === 'screen' ? 1.3 : layer.blend === 'multiply' ? 1.1 : 1;
    const motionBoost = layer.motion.type === 'static' ? 1 : 1.2;
    const weight = (area / (w * h)) * contrast * blendBoost * motionBoost;
    return { layerIndex, key: layer.key, weight, entityCount: entities.length, meanLuma, factors: { area: area / (w * h), contrast, blendBoost, motionBoost } };
  });

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

// ---------------------------------------------------------------------------
// Motion stats
// ---------------------------------------------------------------------------

export interface LayerMotionStats {
  layerIndex: number;
  key: string | undefined;
  /** Mean / max on-screen speed in px per second (wrap jumps excluded). */
  meanSpeed: number;
  maxSpeed: number;
  moving: boolean;
}

/** Per-layer displacement between t and t+dt — choreography as numbers. */
export function motionStats(spec: SaverSpec, opts: PerceiveOptions & { dt?: number } = {}): LayerMotionStats[] {
  const scene = buildScene(spec, opts);
  const t = opts.t ?? 5000;
  const dt = opts.dt ?? 500;
  const { w, h } = scene;
  return scene.layers.map(({ layer, entities }, layerIndex) => {
    let acc = 0;
    let max = 0;
    let n = 0;
    for (const e of entities) {
      const p0 = posOf(scene, e, t);
      const p1 = posOf(scene, e, t + dt);
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      if (Math.abs(dx) > w / 2 || Math.abs(dy) > h / 2) continue; // wrap seam
      const speed = (Math.sqrt(dx * dx + dy * dy) / dt) * 1000;
      acc += speed;
      max = Math.max(max, speed);
      n++;
    }
    const meanSpeed = n ? acc / n : 0;
    return { layerIndex, key: layer.key, meanSpeed, maxSpeed: max, moving: meanSpeed > 0.5 };
  });
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
      const region = Math.min(2, Math.floor((r / grid.rows) * 3)) * 3 + Math.min(2, Math.floor((c / grid.cols) * 3));
      out[region]! += Math.abs(grid.cells[r * grid.cols + c]! - grid.background[r]!);
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

  const codesA = new Set(adviseSpec(a).map((w) => w.code));
  const codesB = new Set(adviseSpec(b).map((w) => w.code));

  return {
    t,
    coverage: { a: gridA.coverage, b: gridB.coverage, delta: gridB.coverage - gridA.coverage },
    meanLuminance: { a: gridA.meanLuminance, b: gridB.meanLuminance, delta: gridB.meanLuminance - gridA.meanLuminance },
    balanceShift: gridA.centroid && gridB.centroid
      ? { dx: gridB.centroid.x - gridA.centroid.x, dy: gridB.centroid.y - gridA.centroid.y }
      : null,
    regions: REGION_NAMES.map((region, i) => ({ region, a: regsA[i]!, b: regsB[i]!, delta: regsB[i]! - regsA[i]! })),
    dominance,
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
  /** The picture: a braille luminance map (each char = 2×4 pixels). */
  braille: string;
  coverage: number;
  meanLuminance: number;
  centroid: { x: number; y: number } | null;
  rowProfile: number[];
  colProfile: number[];
  dominance: DominanceEntry[];
  motion: LayerMotionStats[];
  advisories: ReturnType<typeof adviseSpec>;
}

/**
 * Everything a non-vision agent needs to "see" a spec in one deterministic
 * call: the braille picture, composition transects, dominance ranking, motion
 * stats, and advisories. Intended as the payload behind an MCP previewScene.
 */
export function perceiveScene(spec: SaverSpec, opts: LuminanceGridOptions = {}): ScenePerception {
  const grid = luminanceGrid(spec, opts);
  return {
    t: opts.t ?? 5000,
    braille: renderBrailleMap(grid),
    coverage: grid.coverage,
    meanLuminance: grid.meanLuminance,
    centroid: grid.centroid,
    rowProfile: grid.rowProfile,
    colProfile: grid.colProfile,
    dominance: dominanceRanking(spec, opts),
    motion: motionStats(spec, opts),
    advisories: adviseSpec(spec, opts.viewport ?? { width: 1920, height: 1080 }),
  };
}
