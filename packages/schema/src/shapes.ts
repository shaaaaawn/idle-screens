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

export type ShapedSprite = Extract<SpriteSpec, { kind: 'circle' | 'ring' | 'streak' | 'rect' | 'polygon' | 'stroke' }>;
export type PolygonSprite = Extract<SpriteSpec, { kind: 'polygon' }>;
export type StrokeSprite = Extract<SpriteSpec, { kind: 'stroke' }>;

/** Every sprite that paints with `color` / `colors[]` (as opposed to glyphs). */
export function isShapedSprite(s: SpriteSpec): s is ShapedSprite {
  return s.kind === 'circle' || s.kind === 'ring' || s.kind === 'streak' || s.kind === 'rect' || s.kind === 'polygon' || s.kind === 'stroke';
}

export const DEFAULT_POLYGON_SIDES = 6;
/** Samples along a stroke path — enough that a smooth curve reads as a curve. */
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

/** Fraction of the circumscribed disc a polygon fills — the perception weight of a polygon splat. */
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
export function strokeSamples(s: StrokeSprite, halfSize: number, n = STROKE_SAMPLES): Array<{ x: number; y: number }> {
  const pts = s.points.map(([x, y]) => ({ x: x * halfSize, y: y * halfSize }));
  const m = pts.length;
  if (m < 2) return pts;
  const smooth = s.curve !== 'linear' && m >= 3;
  const segs = m - 1;
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
 * Per-step alphas for a feathered rect drawn as `steps` nested fills from the
 * outside in, so the COMPOSITED alpha ramps linearly from 1/steps at the
 * outer edge to 1 at the core. Under source-over each fill sees the ones
 * before it, so step k needs 1/(steps−k+1); under additive blends the fills
 * simply sum, so each contributes 1/steps.
 */
export function featherAlphas(steps: number, additive: boolean): number[] {
  const out: number[] = [];
  for (let k = 1; k <= steps; k++) out.push(additive ? 1 / steps : 1 / (steps - k + 1));
  return out;
}
export const FEATHER_STEPS = 6;
