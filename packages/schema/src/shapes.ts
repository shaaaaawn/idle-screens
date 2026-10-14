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
import type { SpriteSpec } from './types';

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
