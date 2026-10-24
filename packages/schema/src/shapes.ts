/**
 * Shape glyph geometry — pure, renderer-free, shared by the compiler (what to
 * stroke/fill), perception (how much ink that is) and advise. Everything is
 * computed from the sprite spec + the entity's seeded size, so the canvas and
 * the analytic model agree by construction.
 *
 * Unit coordinates: `polygon.points` and `stroke.points` live in a −1..1 box
 * that is scaled by the entity's half-size (circumradius for polygons, half of
 * `length` for strokes), so the seeded size range is the glyph's bounding
 * diameter — the same rule `circle.radius` / `streak.length` already follow.
 */
import type { PathGradient, PathPart, PathStroke, SpriteSpec } from './types';

export type ShapedSprite = Extract<SpriteSpec, { kind: 'circle' | 'ring' | 'streak' | 'rect' | 'polygon' | 'stroke' | 'bar' }>;
export type BarSprite = Extract<SpriteSpec, { kind: 'bar' }>;
export type PolygonSprite = Extract<SpriteSpec, { kind: 'polygon' }>;
export type StrokeSprite = Extract<SpriteSpec, { kind: 'stroke' }>;

/** Every sprite that paints with `color` / `colors[]` (as opposed to glyphs). */
export function isShapedSprite(s: SpriteSpec): s is ShapedSprite {
  return s.kind === 'circle' || s.kind === 'ring' || s.kind === 'streak' || s.kind === 'rect' || s.kind === 'polygon' || s.kind === 'stroke' || s.kind === 'bar';
}

/** 0..1 fill of bar `index`: `values[i] / max`, `max` defaulting to the largest value. Read at paint time so steered values glide. */
export function barFraction(s: BarSprite, index: number): number {
  const n = s.values.length;
  if (n === 0) return 0;
  const v = s.values[((index % n) + n) % n] ?? 0;
  const max = s.max ?? s.values.reduce((m, x) => Math.max(m, x), 0);
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(1, v / max));
}

/** Box of a bar `len` long and `thick` thick growing from (0,0) toward `direction`: centre + half extents, px. */
export function barBox(direction: NonNullable<BarSprite['direction']>, len: number, thick: number): { cx: number; cy: number; halfX: number; halfY: number } {
  switch (direction) {
    case 'left': return { cx: -len / 2, cy: 0, halfX: len / 2, halfY: thick / 2 };
    case 'up': return { cx: 0, cy: -len / 2, halfX: thick / 2, halfY: len / 2 };
    case 'down': return { cx: 0, cy: len / 2, halfX: thick / 2, halfY: len / 2 };
    default: return { cx: len / 2, cy: 0, halfX: len / 2, halfY: thick / 2 };
  }
}

export const DEFAULT_POLYGON_SIDES = 6;
/** Minimum samples along a stroke path; grows with the control-point count (6 per segment). */
export const STROKE_SAMPLES = 24;

/** Polygon vertices centred on (0,0), unrotated, circumradius `radius` px. Regular n-gons point up. */
export function polygonPoints(s: PolygonSprite, radius: number): Array<{ x: number; y: number }> {
  if (isPathPolygon(s)) {
    const unit = flattenSprite(s);
    if (unit.points.length >= 3) return unit.points.map(([x, y]) => ({ x: x * radius, y: y * radius }));
  }
  if (s.points && s.points.length >= 3) {
    return s.points.map(([x, y]) => ({ x: x * radius, y: y * radius }));
  }
  const n = Math.max(3, Math.round(s.sides ?? DEFAULT_POLYGON_SIDES));
  const out: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / n;
    out.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius });
  }
  return out;
}

/**
 * Signed-area magnitude of a polygon (shoelace), px². Exact for simple
 * polygons; a self-intersecting outline (a bow-tie) has lobes of opposite
 * winding that cancel here while the canvas's nonzero fill paints both, so
 * perception under-reports such glyphs. Author facets as simple polygons.
 */
export function polygonArea(pts: Array<{ x: number; y: number }>): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/**
 * Fraction of the circumscribed disc a polygon fills — the perception weight of
 * a SMALL polygon splat. Polygons spanning more than a few grid cells are
 * rasterized by their real outline instead (`luminanceGrid`).
 */
export function polygonFill(s: PolygonSprite, radius: number): number {
  if (radius <= 0) return 0;
  const disc = Math.PI * radius * radius;
  return Math.min(1, polygonArea(polygonPoints(s, radius)) / disc);
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}

/**
 * The stroke's path, sampled: `n` points (default STROKE_SAMPLES) centred on
 * (0,0) and scaled so the unit box spans `halfSize` px each way. `curve:
 * 'smooth'` (default) is an open Catmull-Rom through the control points with
 * clamped ends; `'linear'` samples the polyline. Two control points give a
 * straight segment either way.
 */
export function strokeSamples(s: StrokeSprite, halfSize: number, n?: number): Array<{ x: number; y: number }> {
  const pts = s.points.map(([x, y]) => ({ x: x * halfSize, y: y * halfSize }));
  const m = pts.length;
  if (m < 2) return pts;
  const smooth = s.curve !== 'linear' && m >= 3;
  const segs = m - 1;
  // Enough samples that every spline segment gets interior points — a
  // 24-point stroke must not collapse to its control polyline.
  n = n ?? Math.max(STROKE_SAMPLES, segs * 6 + 1);
  const at = (k: number): { x: number; y: number } => pts[Math.max(0, Math.min(m - 1, k))]!;
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * segs;
    const seg = Math.min(segs - 1, Math.floor(u));
    const local = u - seg;
    const p1 = at(seg);
    const p2 = at(seg + 1);
    if (!smooth) {
      out.push({ x: p1.x + (p2.x - p1.x) * local, y: p1.y + (p2.y - p1.y) * local });
    } else {
      const p0 = at(seg - 1);
      const p3 = at(seg + 2);
      out.push({ x: catmullRom(p0.x, p1.x, p2.x, p3.x, local), y: catmullRom(p0.y, p1.y, p2.y, p3.y, local) });
    }
  }
  return out;
}

/** Total length of a sampled path, px. */
export function pathLength(pts: Array<{ x: number; y: number }>): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i]!.x - pts[i - 1]!.x;
    const dy = pts[i]!.y - pts[i - 1]!.y;
    l += Math.sqrt(dx * dx + dy * dy);
  }
  return l;
}

/**
 * Taper profile along a stroke, 0..1 of the way along: a brush mark that
 * thins to (almost) nothing at both ends. Floored so a stroke never vanishes
 * mid-mark on a coarse display.
 */
export function strokeTaper(u: number): number {
  return Math.max(0.15, Math.sin(Math.PI * Math.max(0, Math.min(1, u))));
}

/** Stroke width in px for a sprite, with the same default rule as `ring`/`streak`. */
export function strokeWidthPx(s: { width?: number }, scale: number): number {
  return Math.max(0.5, (s.width ?? (scale === 1 ? 2 : 0.002)) * scale);
}

/**
 * A feathered rect's opacity at normalised box coordinates `(u, v)` (0..1
 * across its width and height): a separable linear ramp, `featherRamp(u) ×
 * featherRamp(v)`, where `feather` of the half-size fades out on every side.
 * Smooth by construction — no nested fills, so no bands (X383) — and its
 * integral is exactly the `(1 − feather/2)²` perception weighs a feathered
 * rect's splat by.
 */
export function featherRamp(u: number, feather: number): number {
  const band = Math.max(0, Math.min(1, feather)) / 2; // fraction of the full width, per side
  const d = Math.min(u, 1 - u);
  if (band <= 0) return d >= 0 ? 1 : 0;
  return Math.max(0, Math.min(1, d / band));
}

/** Side of the square alpha mask a feathered rect is painted from (stretched to the rect, smoothed). */
export const FEATHER_MASK_SIZE = 128;

/**
 * The two sides of a ribbon through `pts` with half-width `half[i]` at point
 * i: each point offset along its joint's bisector normal (mitred so a corner
 * keeps its width, the miter capped at 2×). `left` is the +normal side
 * (−ty, tx). Shared by the tapered stroke outline and the trail ribbon.
 */
export function ribbonSides(pts: Array<{ x: number; y: number }>, half: readonly number[]): { left: Array<{ x: number; y: number }>; right: Array<{ x: number; y: number }> } {
  const n = pts.length;
  const left: Array<{ x: number; y: number }> = [];
  const right: Array<{ x: number; y: number }> = [];
  if (n < 2) return { left, right };
  const dir = (a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    return l > 1e-9 ? { x: dx / l, y: dy / l } : { x: 1, y: 0 };
  };
  for (let i = 0; i < n; i++) {
    const tIn = i > 0 ? dir(pts[i - 1]!, pts[i]!) : dir(pts[0]!, pts[1]!);
    const tOut = i < n - 1 ? dir(pts[i]!, pts[i + 1]!) : tIn;
    let tx = tIn.x + tOut.x;
    let ty = tIn.y + tOut.y;
    const tl = Math.hypot(tx, ty);
    if (tl < 1e-9) { tx = tOut.x; ty = tOut.y; } else { tx /= tl; ty /= tl; }
    const hw = half[i]! / Math.max(0.5, tx * tOut.x + ty * tOut.y);
    const p = pts[i]!;
    left.push({ x: p.x - ty * hw, y: p.y + tx * hw });
    right.push({ x: p.x + ty * hw, y: p.y - tx * hw });
  }
  return { left, right };
}

/**
 * A tapered stroke's filled outline (X386): the sampled path offset by ±half
 * its tapered width on each side, with round end caps, as one closed polygon.
 * Filling it once paints every pixel once — the per-segment strokes it
 * replaces overlapped at every joint, and a translucent mark showed each
 * overlap as a bead. Widths: `lw × strokeTaper(i / (n − 1))` at sample i,
 * floored at 0.5 px. Joints are mitred (the offset scaled by 1/cos of the
 * half-turn, capped at 2×) so a polyline corner keeps its width.
 */
export function strokeOutline(pts: Array<{ x: number; y: number }>, lw: number, taper = true): Array<{ x: number; y: number }> {
  const n = pts.length;
  if (n < 2) return [];
  const half = (i: number): number => Math.max(0.5, taper ? lw * strokeTaper(i / (n - 1)) : lw) / 2;
  const dir = (a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    return l > 1e-9 ? { x: dx / l, y: dy / l } : { x: 1, y: 0 };
  };
  const { left, right } = ribbonSides(pts, Array.from({ length: n }, (_, i) => half(i)));
  // Round caps: half circles about each end, from one side to the other.
  const cap = (c: { x: number; y: number }, r: number, from: number): Array<{ x: number; y: number }> => {
    const out: Array<{ x: number; y: number }> = [];
    const steps = 6;
    for (let k = 1; k < steps; k++) {
      const a = from - (Math.PI * k) / steps; // clockwise in screen terms: left side → right side
      out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
    }
    return out;
  };
  const endT = dir(pts[n - 2]!, pts[n - 1]!);
  const startT = dir(pts[0]!, pts[1]!);
  // Left is +normal (−ty, tx), at heading + 90°. The end cap sweeps from the
  // left side through the heading to the right side; the start cap from the
  // right side back round to the left.
  const endA = Math.atan2(endT.y, endT.x) + Math.PI / 2;
  const startA = Math.atan2(startT.y, startT.x) - Math.PI / 2;
  return [
    ...left,
    ...cap(pts[n - 1]!, half(n - 1), endA),
    ...right.reverse(),
    ...cap(pts[0]!, half(0), startA),
  ];
}

// ---------------------------------------------------------------------------
// polygon.path — an SVG path `d` string in the −1..1 unit box, flattened once
// into the polygon's outline. Every consumer (canvas, perception, advise,
// cohesion) reads polygonPoints(), so a path sprite is a polygon everywhere.
// ---------------------------------------------------------------------------

/** Most outline points one flattened path may produce. */
export const MAX_PATH_POINTS = 4096;
/**
 * Scene budget for path outlines: Σ over path layers of flattened points ×
 * entity count — the vertices the canvas fills per frame. Detail spends it
 * wherever the drawing needs it, rather than a fixed allowance per layer.
 */
export const MAX_SCENE_PATH_POINTS = 16384;
/** Flattening tolerance, unit-box units: a chord never strays further than this from its curve (≈0.27 px for a full-box glyph at radius 0.5 on 1080p, ≈0.5 px on 4K). */
const PATH_TOLERANCE = 0.0005;

export interface FlattenedPath {
  /** One closed ring: subpaths joined by zero-width bridges, inner ones wound as holes. */
  points: Array<[number, number]>;
  subpaths: number;
  /** Every subpath as drawn (simplified, no bridges), for strokes: open unless it ended in Z. */
  lines: Array<{ points: Array<[number, number]>; closed: boolean }>;
  /** Parse error, if the string is not a usable path. */
  error?: string;
}

/**
 * How a path's subpaths combine. `auto` (default): containment decides which
 * subpaths are holes (see joinRings) — for authors who never think about
 * winding. `nonzero` / `evenodd`: SVG's own fill rules, honouring the winding
 * as drawn — for pasted SVG, and for a deliberate same-colour shape that sits
 * inside another (auto would read it as a hole).
 */
export type PathFillRule = 'auto' | 'nonzero' | 'evenodd';

// Keyed by the d string itself (one map per rule): V8 caches a string's hash
// on the string, so a frame that hands back the same path string looks it up
// in O(1) — a `${rule}|${d}` key would re-hash a 60 kB string every call.
const pathCache = { auto: new Map<string, FlattenedPath>(), nonzero: new Map<string, FlattenedPath>(), evenodd: new Map<string, FlattenedPath>() };

export function flattenPath(d: string, rule: PathFillRule = 'auto'): FlattenedPath {
  const cache = pathCache[rule] ?? pathCache.auto;
  const hit = cache.get(d);
  if (hit) return hit;
  let out: FlattenedPath;
  try {
    const parsed = parseAndFlatten(d);
    const rings = parsed.rings.map(simplifyRing).filter((r) => r.length >= 3);
    const lines = parsed.lines.map((l) => ({ points: l.closed ? simplifyRing(l.points) : simplifyLine(l.points), closed: l.closed }));
    out = { points: rule === 'auto' ? joinRings(rings) : bridge(rings), subpaths: rings.length, lines };
  } catch (e) {
    out = { points: [], subpaths: 0, lines: [], error: e instanceof Error ? e.message : String(e) };
  }
  if (cache.size > 256) cache.clear();
  cache.set(d, out);
  return out;
}

const spriteFlat = new WeakMap<object, { d: string; rule: PathFillRule; flat: FlattenedPath }>();
/**
 * flattenPath for a polygon sprite, memoised on the sprite object: every
 * frame asks for the same outline, and hashing a 60,000-character path
 * string as a Map key each time cost more than drawing it.
 */
export function flattenSprite(s: PolygonSprite): FlattenedPath {
  // A multi-part drawing's outline is its filled parts together (bbox, area,
  // small-entity perception); parts draw and perceive individually elsewhere.
  const d = s.parts ? s.parts.filter((p) => p.fill !== false).map((p) => p.path).join(' ') : s.path ?? '';
  const rule = s.parts ? 'auto' : s.fillRule ?? 'auto';
  const hit = spriteFlat.get(s);
  if (hit && hit.d === d && hit.rule === rule) return hit.flat;
  const flat = flattenPath(d, rule);
  spriteFlat.set(s, { d, rule, flat });
  return flat;
}

/** The canvas fill rule for a polygon: evenodd only for a path that asks for it. */
export function polygonFillRule(s: PolygonSprite): 'nonzero' | 'evenodd' {
  return typeof s.path === 'string' && s.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
}

/** A polygon drawn from SVG paths: one `path`, or a multi-colour drawing of `parts`. */
export function isPathPolygon(s: SpriteSpec): boolean {
  return s.kind === 'polygon' && (typeof s.path === 'string' || Array.isArray(s.parts));
}

/** One drawable piece of a path polygon, resolved: its outline, paint and part-space box. */
export interface ResolvedPart {
  flat: FlattenedPath;
  /** Its own colour, or null to use the entity's (sprite colour / palette pick). */
  color: string | null;
  fill: boolean;
  rule: 'nonzero' | 'evenodd';
  gradient?: PathGradient;
  stroke?: PathStroke;
  opacity: number;
  /** The fill's bounding box in the unit box (centre + half extents) — the space of `gradient.units: 'part'`. */
  box: { cx: number; cy: number; hw: number; hh: number };
}

const spriteParts = new WeakMap<object, { key: unknown; parts: ResolvedPart[] }>();

/**
 * A path polygon as an ordered list of parts, back to front. A single
 * `path` is a drawing of one part (its colour the entity's), so the renderer,
 * perception and the budget treat both forms one way. Memoised per sprite.
 */
export function pathParts(s: PolygonSprite): ResolvedPart[] {
  const key = s.parts ?? s.path;
  const hit = spriteParts.get(s);
  if (hit && hit.key === key) return hit.parts;
  const src: Array<PathPart & { color?: string }> = s.parts ?? (typeof s.path === 'string'
    ? [{ path: s.path, fillRule: s.fillRule, fill: s.fill, gradient: s.gradient, stroke: s.stroke }]
    : []);
  const parts = src.map((p): ResolvedPart => {
    const flat = flattenPath(p.path, p.fillRule ?? 'auto');
    return {
      flat,
      color: s.parts ? p.color ?? null : null,
      fill: p.fill !== false,
      rule: p.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
      gradient: p.gradient,
      stroke: p.stroke,
      opacity: p.opacity ?? 1,
      box: boxOfFlat(flat),
    };
  });
  spriteParts.set(s, { key, parts });
  return parts;
}

/**
 * What one part of a path drawing paints, in px² for a frame of `sx`·`sy` px
 * per unit: its fill (holes out) and its stroke (drawn length × width), each
 * already times its own opacity. The stroke is `width · r` px wide however the
 * frame stretches (`r` the entity radius, as the renderer draws it). Zero for an invisible part (X609); an open
 * `fill: false` line is its stroke, not the area its points enclose (X605).
 */
export function partInkArea(part: ResolvedPart, sx: number, sy: number, r: number): { fill: number; stroke: number } {
  if (part.opacity <= 0) return { fill: 0, stroke: 0 };
  const fill = part.fill ? polygonArea(part.flat.points.map(([x, y]) => ({ x: x * sx, y: y * sy }))) * part.opacity : 0;
  let stroke = 0;
  if (part.stroke && part.stroke.width > 0) {
    for (const l of part.flat.lines) {
      const pts = l.points.map(([x, y]) => ({ x: x * sx, y: y * sy }));
      if (l.closed && pts.length > 1) pts.push(pts[0]!);
      stroke += pathLength(pts) * part.stroke.width * r;
    }
    stroke *= (part.stroke.opacity ?? 1) * part.opacity;
  }
  return { fill, stroke };
}

/**
 * The share of a gradient's extent each stop's colour governs: the mean colour
 * of a linear ramp is its stops weighted by the span half-way to each
 * neighbour (flat beyond the ends). A redundant stop beside another barely
 * moves it.
 */
export function gradientStopWeights(stops: ReadonlyArray<{ at: number }>): number[] {
  const at = stops.map((st) => Math.min(1, Math.max(0, st.at)));
  const order = at.map((_, i) => i).sort((a, b) => at[a]! - at[b]!);
  const out = new Array<number>(stops.length).fill(0);
  order.forEach((i, rank) => {
    const prev = rank > 0 ? at[order[rank - 1]!]! : null;
    const next = rank < order.length - 1 ? at[order[rank + 1]!]! : null;
    const a = at[i]!;
    out[i] = (prev === null ? a : (a - prev) / 2) + (next === null ? 1 - a : (next - a) / 2);
  });
  const sum = out.reduce((x, y) => x + y, 0);
  return sum > 0 ? out.map((x) => x / sum) : out.map(() => 1 / Math.max(1, stops.length));
}

/** The total a path drawing paints (see `partInkArea`). */
export function pathInkArea(s: PolygonSprite, sx: number, sy: number, r: number): number {
  let area = 0;
  for (const part of pathParts(s)) {
    const a = partInkArea(part, sx, sy, r);
    area += a.fill + a.stroke;
  }
  return area;
}

/**
 * How a path drawing's −1..1 unit box lands on screen, in px: scale per axis
 * (sx, sy) and the unit-box point (ox, oy) that sits at the entity position.
 *   span 'box' (default): uniform, the entity radius r on both axes — the
 *     classic square box sized by the short side;
 *   'width': x spans the full screen width (sx = w/2), y keeps r — skylines,
 *     hills and ground bands that must reach both side edges on any aspect;
 *   'height': y spans the full height, x keeps r;
 *   'screen': both — a frame or wash that hugs every edge.
 * `origin` [ox, oy] picks the anchored point: [0, 1] with position y = 1 sets
 * the drawing's bottom on the screen's bottom edge. Strokes keep the uniform
 * r for their width, so stretching never fattens an outline sideways.
 */
export function pathFrame(s: PolygonSprite, r: number, w: number, h: number): { sx: number; sy: number; ox: number; oy: number; uniform: boolean } {
  const span = s.span ?? 'box';
  const sx = span === 'width' || span === 'screen' ? w / 2 : r;
  const sy = span === 'height' || span === 'screen' ? h / 2 : r;
  const [ox, oy] = s.origin ?? [0, 0];
  return { sx, sy, ox, oy, uniform: sx === sy };
}

const flatBoxes = new WeakMap<FlattenedPath, ResolvedPart['box']>();
/** A flattened path's bounding box (centre + half extents), memoised on the (cached) flattening. */
function boxOfFlat(flat: FlattenedPath): ResolvedPart['box'] {
  const hit = flatBoxes.get(flat);
  if (hit) return hit;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of flat.points.length ? flat.points : flat.lines.flatMap((l) => l.points)) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  if (!Number.isFinite(x0)) { x0 = -1; x1 = 1; y0 = -1; y1 = 1; }
  const box = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, hw: Math.max((x1 - x0) / 2, 1e-6), hh: Math.max((y1 - y0) / 2, 1e-6) };
  flatBoxes.set(flat, box);
  return box;
}

const pathIds = new Map<string, number>();
let pathSeq = 0;
const paintSigs = new WeakMap<object, string>();
/**
 * A content signature for a path polygon's appearance: every field, with each
 * d string replaced by an interned id. Two sprite objects that draw the same
 * thing share it — a glide or a timeline hands the renderer a new object every
 * frame, so the caches key on this, never on object identity. Memoised per
 * object: specs are treated as immutable (steers and glides always build new
 * objects), so a sprite must never be edited in place after it is drawn.
 */
export function pathPaintSig(s: PolygonSprite): string {
  const hit = paintSigs.get(s);
  if (hit !== undefined) return hit;
  const sig = JSON.stringify(s, (k, v) => {
    if (k !== 'path' || typeof v !== 'string') return v;
    let id = pathIds.get(v);
    if (id === undefined) {
      if (pathIds.size > 4096) pathIds.clear(); // ids keep counting up, so a cleared table never reuses one
      id = ++pathSeq;
      pathIds.set(v, id);
    }
    return `#${id}`;
  });
  paintSigs.set(s, sig);
  return sig;
}

/** A unit-box point in a gradient's own space: the drawing box, or (units 'part') the part's box mapped to −1..1. */
export function gradientSpace(part: ResolvedPart, u: number, v: number): [number, number] {
  if (part.gradient?.units !== 'part') return [u, v];
  return [(u - part.box.cx) / part.box.hw, (v - part.box.cy) / part.box.hh];
}

type Pt = [number, number];

function segmentsFor(chord: number, curvature: number): number {
  // Error of a chord on a curve with control-polygon deviation `curvature` ~ curvature / (4 n²).
  const n = Math.ceil(Math.sqrt(Math.max(curvature, chord * 0.05) / (4 * PATH_TOLERANCE)));
  return Math.max(2, Math.min(64, n));
}

function parseAndFlatten(d: string): { rings: Pt[][]; lines: Array<{ points: Pt[]; closed: boolean }> } {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0;
  const num = (): number => {
    const t = tokens[i++];
    if (t === undefined || /^[a-zA-Z]$/.test(t)) throw new Error('expected a number');
    return Number(t);
  };
  const flag = (): number => {
    // Arc flags may be written without separators ("a1 1 0 011 1"); the tokenizer keeps "011" whole.
    const t = tokens[i];
    if (t !== undefined && /^[01]{2,}/.test(t)) {
      tokens[i] = t.slice(1);
      return Number(t[0]);
    }
    return num();
  };
  const rings: Pt[][] = [];
  let ring: Pt[] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let lastCtrl: Pt | null = null; // reflected by S/T
  let lastCmd = '';
  const push = (x: number, y: number): void => { ring.push([x, y]); cx = x; cy = y; };
  const lines: Array<{ points: Pt[]; closed: boolean }> = [];
  const close = (closed = false): void => {
    if (ring.length >= 2) lines.push({ points: ring.slice(), closed });
    if (ring.length >= 3) rings.push(ring);
    ring = [];
  };
  const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): void => {
    const dev = Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x - x2, y - y2) - Math.hypot(x - cx, y - cy);
    const n = segmentsFor(Math.hypot(x - cx, y - cy), dev * 4);
    const x0 = cx, y0 = cy;
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y);
    }
    lastCtrl = [x2, y2];
  };
  const quad = (x1: number, y1: number, x: number, y: number): void => {
    const dev = Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x - x1, y - y1) - Math.hypot(x - cx, y - cy);
    const n = segmentsFor(Math.hypot(x - cx, y - cy), dev * 4);
    const x0 = cx, y0 = cy;
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      push(u * u * x0 + 2 * u * t * x1 + t * t * x, u * u * y0 + 2 * u * t * y1 + t * t * y);
    }
    lastCtrl = [x1, y1];
  };
  const arc = (rx: number, ry: number, phiDeg: number, large: number, sweep: number, x: number, y: number): void => {
    // SVG endpoint → centre parameterisation (SVG 1.1 F.6.5).
    const x0 = cx, y0 = cy;
    if (rx === 0 || ry === 0 || (x0 === x && y0 === y)) { push(x, y); return; }
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = (phiDeg * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
    const dx = (x0 - x) / 2, dy = (y0 - y) / 2;
    const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let co = Math.sqrt(Math.max(0, num2 / den));
    if (large === sweep) co = -co;
    const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
    const ccx = cp * cxp - sp * cyp + (x0 + x) / 2, ccy = sp * cxp + cp * cyp + (y0 + y) / 2;
    const ang = (ux: number, uy: number, vx: number, vy: number): number => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    const r = Math.max(rx, ry);
    const n = Math.max(2, Math.min(96, Math.ceil(Math.abs(dt) / (2 * Math.acos(Math.max(0, 1 - PATH_TOLERANCE / r))))));
    for (let k = 1; k <= n; k++) {
      const t = t1 + (dt * k) / n;
      const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
      push(cp * ex - sp * ey + ccx, sp * ex + cp * ey + ccy);
    }
  };
  while (i < tokens.length) {
    let cmd = tokens[i]!;
    if (/^[a-zA-Z]$/.test(cmd)) i++;
    else if (lastCmd) cmd = lastCmd === 'M' ? 'L' : lastCmd === 'm' ? 'l' : lastCmd; // implicit repeat
    else throw new Error('path must start with M');
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z' ? true : false;
    const ox = rel ? cx : 0, oy = rel ? cy : 0;
    const C = cmd.toUpperCase();
    const prevCmd = lastCmd.toUpperCase();
    if (C !== 'S' && C !== 'T') lastCtrl = null;
    switch (C) {
      case 'M': {
        close();
        const x = num() + ox, y = num() + oy;
        push(x, y); sx = x; sy = y;
        break;
      }
      case 'L': push(num() + ox, num() + oy); break;
      case 'H': push(num() + ox, cy); break;
      case 'V': push(cx, num() + oy); break;
      case 'C': { const a = num() + ox, b = num() + oy, c = num() + ox, e = num() + oy; cubic(a, b, c, e, num() + ox, num() + oy); break; }
      case 'S': {
        const r: Pt = lastCtrl && (prevCmd === 'C' || prevCmd === 'S') ? [2 * cx - lastCtrl[0], 2 * cy - lastCtrl[1]] : [cx, cy];
        const c = num() + ox, e = num() + oy;
        cubic(r[0], r[1], c, e, num() + ox, num() + oy);
        break;
      }
      case 'Q': { const a = num() + ox, b = num() + oy; quad(a, b, num() + ox, num() + oy); break; }
      case 'T': {
        const r: Pt = lastCtrl && (prevCmd === 'Q' || prevCmd === 'T') ? [2 * cx - lastCtrl[0], 2 * cy - lastCtrl[1]] : [cx, cy];
        quad(r[0], r[1], num() + ox, num() + oy);
        break;
      }
      case 'A': { const rx = num(), ry = num(), ph = num(), la = flag(), sw = flag(); arc(rx, ry, ph, la, sw, num() + ox, num() + oy); break; }
      case 'Z': cx = sx; cy = sy; close(true); break;
      default: throw new Error(`unsupported path command '${cmd}'`);
    }
    lastCmd = cmd;
  }
  close();
  for (const r of rings) {
    // Drop a closing point that repeats the start.
    const a = r[0]!, b = r[r.length - 1]!;
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) r.pop();
  }
  for (const l of lines) {
    const a = l.points[0]!, b = l.points[l.points.length - 1]!;
    if (l.closed && l.points.length > 2 && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) l.points.pop();
  }
  return { rings, lines };
}

/** Douglas–Peucker on an open polyline at the flattening tolerance. */
function simplifyLine(r: Pt[]): Pt[] {
  if (r.length <= 2) return r;
  const keep = new Uint8Array(r.length);
  keep[0] = 1; keep[r.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, r.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = r[a]!, B = r[b]!;
    const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy);
    let best = -1, bd = 0;
    for (let k = a + 1; k < b; k++) {
      const P = r[k]!;
      const d = len > 1e-12 ? Math.abs(dx * (A[1] - P[1]) - dy * (A[0] - P[0])) / len : Math.hypot(P[0] - A[0], P[1] - A[1]);
      if (d > bd) { bd = d; best = k; }
    }
    if (best >= 0 && bd > PATH_TOLERANCE) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return r.filter((_, k) => keep[k] === 1);
}

/**
 * Douglas–Peucker on a closed ring at the flattening tolerance: drops points
 * that sit on (or within PATH_TOLERANCE of) the line through their neighbours,
 * so a hand-sampled polyline costs only the points that change its outline.
 */
function simplifyRing(r: Pt[]): Pt[] {
  if (r.length <= 4) return r;
  // Split the ring at vertex 0 and the vertex farthest from it; simplify both halves.
  let far = 0, fd = -1;
  for (let k = 1; k < r.length; k++) {
    const d = (r[k]![0] - r[0]![0]) ** 2 + (r[k]![1] - r[0]![1]) ** 2;
    if (d > fd) { fd = d; far = k; }
  }
  const keep = new Uint8Array(r.length);
  keep[0] = 1; keep[far] = 1;
  const at = (k: number): Pt => r[k % r.length]!;
  const stack: Array<[number, number]> = [[0, far], [far, r.length]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = at(a), B = at(b);
    const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy);
    let best = -1, bd = 0;
    for (let k = a + 1; k < b; k++) {
      const P = at(k);
      const d = len > 1e-12 ? Math.abs(dx * (A[1] - P[1]) - dy * (A[0] - P[0])) / len : Math.hypot(P[0] - A[0], P[1] - A[1]);
      if (d > bd) { bd = d; best = k; }
    }
    if (best >= 0 && bd > PATH_TOLERANCE) {
      keep[best % r.length] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return r.filter((_, k) => keep[k] === 1);
}

function signedArea(r: Pt[]): number {
  let a = 0;
  for (let k = 0; k < r.length; k++) {
    const p = r[k]!, q = r[(k + 1) % r.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function inside(pt: Pt, r: Pt[]): boolean {
  let c = false;
  for (let k = 0, j = r.length - 1; k < r.length; j = k++) {
    const a = r[k]!, b = r[j]!;
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** How close to an edge counts as on it: twice the flattening tolerance, so a flattened curve still meets the vertex it was drawn through. */
const ON_EDGE = 2 * PATH_TOLERANCE;

/** `pt` within ON_EDGE of one of `r`'s edges. */
function onEdge(pt: Pt, r: Pt[]): boolean {
  for (let k = 0, j = r.length - 1; k < r.length; j = k++) {
    const a = r[j]!, b = r[k]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len2)) : 0;
    const ex = a[0] + dx * t - pt[0], ey = a[1] + dy * t - pt[1];
    if (ex * ex + ey * ey <= ON_EDGE * ON_EDGE) return true;
  }
  return false;
}

/**
 * Every vertex of `sub` inside `r` or on its edge, and `sub` not lying wholly
 * on the edge (bbox first): `sub` is nested in `r`, not merely overlapping
 * it. A vertex ON the edge counts as inside (X585): a hole cut into a wall
 * from its rim, a notch, a mouth touching the face's outline, is still a
 * hole. A ray cast decides a point exactly on an edge by which side of the
 * ray it falls, so a hole touching the top edge used to cut while the same
 * hole touching the bottom was filled.
 */
function containsRing(r: Pt[], rb: Box, sub: Pt[], sb: Box): boolean {
  if (sb.x0 < rb.x0 - ON_EDGE || sb.x1 > rb.x1 + ON_EDGE || sb.y0 < rb.y0 - ON_EDGE || sb.y1 > rb.y1 + ON_EDGE) return false;
  let strictly = false;
  for (const p of sub) {
    if (inside(p, r)) strictly = true;
    else if (!onEdge(p, r)) return false;
  }
  if (strictly) return true;
  // Every vertex on the edge (a triangle notch with its corners on the
  // rim): nested when its centre is inside.
  let cx = 0, cy = 0;
  for (const p of sub) { cx += p[0]; cy += p[1]; }
  const c: Pt = [cx / sub.length, cy / sub.length];
  return !onEdge(c, r) && inside(c, r);
}

interface Box { x0: number; x1: number; y0: number; y1: number }
function boxOf(r: Pt[]): Box {
  const b = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const [x, y] of r) { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); }
  return b;
}

/**
 * Subpaths → one ring the nonzero fill paints as the author meant, whatever
 * direction each was drawn in or which came first. Containment decides
 * (every vertex inside, not just one):
 *   - a subpath inside nothing is solid;
 *   - inside a filled region (its smallest container is filled), a hole;
 *   - inside a hole, solid again (an island: a pupil in an eye-spot ring);
 *   - one that only partly overlaps another stays solid and merges with it
 *     (a vein crossing a vein, a leaflet over its stem), never cutting it.
 * Each subpath gets a winding multiplicity m so the net winding just inside
 * it is exactly 1 (filled) or 0 (empty), counting every container — so a
 * window through two overlapping walls is wound −2 and still opens. A ring
 * with |m| > 1 is traced |m| times; m = 0 drops it. Pieces join the ring so
 * far by zero-width bridges at the closest vertex pair: the "retrace the
 * hole" trick FORMAT.md teaches by hand, done by the compiler.
 */
function joinRings(rings: Pt[][]): Pt[] {
  if (rings.length === 0) return [];
  const boxes = rings.map(boxOf);
  const areas = rings.map((r) => Math.abs(signedArea(r)));
  // Largest first, so every container is decided before what it contains.
  const order = rings.map((_, i) => i).sort((p, q) => areas[q]! - areas[p]!);
  const mult = new Array<number>(rings.length).fill(0);
  const net = new Array<number>(rings.length).fill(0);
  const done: number[] = [];
  for (const n of order) {
    const containers = done.filter((m) => areas[m]! > areas[n]! && containsRing(rings[m]!, boxes[m]!, rings[n]!, boxes[n]!));
    const around = containers.reduce((sum, m) => sum + mult[m]!, 0);
    let want = 1;
    if (containers.length) {
      const parent = containers.reduce((p, m) => (areas[m]! < areas[p]! ? m : p));
      want = net[parent] !== 0 ? 0 : 1;
    }
    net[n] = want;
    mult[n] = want - around;
    done.push(n);
  }
  const traced: Pt[][] = [];
  const trace = (r: Pt[], m: number): void => {
    const o = Math.sign(signedArea(r)) === Math.sign(m) ? r : r.slice().reverse();
    for (let k = 0; k < Math.abs(m); k++) traced.push(o);
  };
  for (let n = 0; n < rings.length; n++) {
    if (mult[n] !== 0) trace(rings[n]!, mult[n]!);
  }
  // In auto a hole is a stencil cut-out through the whole layer. A solid that
  // only partly crosses a hole (a window across the seam where a tower's top
  // overlaps its base; a spoke across a ring's opening) is cancelled where it
  // covers the hole: add (solid ∩ hole) wound against it. Exact for a convex
  // hole (windows, ovals, circles); a concave hole cuts only what contains it.
  // For each solid, the holes it partly crosses; only the OUTERMOST of those
  // cut it — a hole inside another hole is already in the cut region, and
  // cutting twice would wind the solid back to −1 (visible again).
  const holes = rings.map((_, n) => n).filter((n) => net[n] === 0 && mult[n] !== 0 && isConvex(rings[n]!));
  for (let m = 0; m < rings.length; m++) {
    if (mult[m]! <= 0) continue;
    const bm = boxes[m]!;
    const crossing = holes.filter((n) => {
      const bn = boxes[n]!;
      if (n === m || bm.x1 <= bn.x0 || bm.x0 >= bn.x1 || bm.y1 <= bn.y0 || bm.y0 >= bn.y1) return false;
      return !containsRing(rings[m]!, bm, rings[n]!, bn) && !containsRing(rings[n]!, bn, rings[m]!, bm);
    });
    for (const n of crossing) {
      if (crossing.some((o) => o !== n && areas[o]! > areas[n]! && containsRing(rings[o]!, boxes[o]!, rings[n]!, boxes[n]!))) continue;
      const piece = clipToConvex(rings[m]!, rings[n]!);
      if (piece.length >= 3 && Math.abs(signedArea(piece)) > 1e-9) trace(piece, -mult[m]!);
    }
  }
  return bridge(traced);
}

function isConvex(r: Pt[]): boolean {
  let sign = 0;
  for (let k = 0; k < r.length; k++) {
    const a = r[k]!, b = r[(k + 1) % r.length]!, c = r[(k + 2) % r.length]!;
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-12) continue;
    if (sign === 0) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

/** Sutherland–Hodgman: `subject` clipped to the convex polygon `clip`. */
function clipToConvex(subject: Pt[], clip: Pt[]): Pt[] {
  const o = Math.sign(signedArea(clip)) || 1;
  let out = subject;
  for (let k = 0; k < clip.length && out.length; k++) {
    const a = clip[k]!, b = clip[(k + 1) % clip.length]!;
    const side = (p: Pt): number => o * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
    const cut = (p: Pt, q: Pt): Pt => { const sp = side(p), sq = side(q), t = sp / (sp - sq); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; };
    const next: Pt[] = [];
    for (let i = 0; i < out.length; i++) {
      const p = out[i]!, q = out[(i + 1) % out.length]!;
      const pin = side(p) >= 0, qin = side(q) >= 0;
      if (pin) next.push(p);
      if (pin !== qin) next.push(cut(p, q));
    }
    out = next;
  }
  return out;
}

/** Join rings into one by zero-width bridges at the closest vertex pairs; windings kept as given. */
function bridge(rings: Pt[][]): Pt[] {
  if (rings.length === 0) return [];
  let ring = rings[0]!.slice();
  for (let n = 1; n < rings.length; n++) {
    const sub = rings[n]!;
    let bi = 0, bj = 0, best = Infinity;
    for (let a = 0; a < ring.length; a++) {
      for (let b = 0; b < sub.length; b++) {
        const dd = (ring[a]![0] - sub[b]![0]) ** 2 + (ring[a]![1] - sub[b]![1]) ** 2;
        if (dd < best) { best = dd; bi = a; bj = b; }
      }
    }
    const rot = sub.slice(bj).concat(sub.slice(0, bj));
    ring = ring.slice(0, bi + 1).concat(rot, [rot[0]!, ring[bi]!], ring.slice(bi + 1));
  }
  return ring;
}

/** Points a path polygon draws per frame: every part's fill ring (when filled) plus its stroked lines. */
export function pathPointCount(s: PolygonSprite): number {
  let n = 0;
  for (const p of pathParts(s)) {
    if (p.fill) n += p.flat.points.length;
    if (p.stroke) for (const l of p.flat.lines) n += l.points.length;
  }
  return n;
}

/**
 * Per-frame drawing cost of a path polygon in "flat fill point" units: a
 * gradient fill costs about twice a flat one, a stroked point about three
 * times. The render-once cache decides by cost, so a lightly-pointed but
 * shaded and inked drawing still earns its bitmap.
 */
export function pathDrawCost(s: PolygonSprite): number {
  let c = 0;
  for (const p of pathParts(s)) {
    if (p.fill) c += p.flat.points.length * (p.gradient ? 2 : 1);
    if (p.stroke) for (const l of p.flat.lines) c += l.points.length * 3;
  }
  return c;
}

/**
 * A part's stroke as thin quads (one per segment, `width` unit-box units
 * wide), scaled by `radius` px and centred on (0,0): what perception
 * rasterises for a stroke. Joints overlap a little; perception clamps.
 */
export function partStrokeQuads(part: ResolvedPart, radius: number): Array<Array<{ x: number; y: number }>> {
  if (!part.stroke) return [];
  const hw = (part.stroke.width * radius) / 2;
  const out: Array<Array<{ x: number; y: number }>> = [];
  for (const l of part.flat.lines) {
    const pts = l.points;
    const n = l.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
      const ax = a[0] * radius, ay = a[1] * radius, bx = b[0] * radius, by = b[1] * radius;
      const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * hw, ny = (dx / len) * hw;
      out.push([{ x: ax + nx, y: ay + ny }, { x: bx + nx, y: by + ny }, { x: bx - nx, y: by - ny }, { x: ax - nx, y: ay - ny }]);
    }
  }
  return out;
}

/** Every part's stroke quads together (see partStrokeQuads). */
export function pathStrokeQuads(s: PolygonSprite, radius: number): Array<Array<{ x: number; y: number }>> {
  return pathParts(s).flatMap((p) => partStrokeQuads(p, radius));
}
