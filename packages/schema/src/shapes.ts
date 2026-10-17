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
  if (typeof s.path === 'string') {
    const unit = flattenPath(s.path);
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

/** Most outline points a flattened path may produce (the canvas fills one path either way). */
export const MAX_PATH_POINTS = 512;
/** Flattening tolerance, unit-box units: a chord never strays further than this from its curve (≈0.27 px for a full-box glyph at radius 0.5 on 1080p, ≈0.5 px on 4K). */
const PATH_TOLERANCE = 0.0005;

export interface FlattenedPath {
  /** One closed ring: subpaths joined by zero-width bridges, inner ones wound as holes. */
  points: Array<[number, number]>;
  subpaths: number;
  /** Parse error, if the string is not a usable path. */
  error?: string;
}

const pathCache = new Map<string, FlattenedPath>();

export function flattenPath(d: string): FlattenedPath {
  const hit = pathCache.get(d);
  if (hit) return hit;
  let out: FlattenedPath;
  try {
    const rings = parseAndFlatten(d).map(simplifyRing).filter((r) => r.length >= 3);
    out = { points: joinRings(rings), subpaths: rings.length };
  } catch (e) {
    out = { points: [], subpaths: 0, error: e instanceof Error ? e.message : String(e) };
  }
  if (pathCache.size > 256) pathCache.clear();
  pathCache.set(d, out);
  return out;
}

type Pt = [number, number];

function segmentsFor(chord: number, curvature: number): number {
  // Error of a chord on a curve with control-polygon deviation `curvature` ~ curvature / (4 n²).
  const n = Math.ceil(Math.sqrt(Math.max(curvature, chord * 0.05) / (4 * PATH_TOLERANCE)));
  return Math.max(2, Math.min(64, n));
}

function parseAndFlatten(d: string): Pt[][] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0;
  const num = (): number => {
    const t = tokens[i++];
    if (t === undefined || /[a-zA-Z]/.test(t)) throw new Error('expected a number');
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
  const close = (): void => {
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
    if (/[a-zA-Z]/.test(cmd)) i++;
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
      case 'Z': cx = sx; cy = sy; close(); break;
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
  return rings;
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

/**
 * Subpaths → one ring the nonzero fill paints as the author meant: a subpath
 * nested inside an odd number of earlier ones is wound opposite (a hole), any
 * other the same way (a separate piece, or an island inside a hole), each joined to the ring so far by a zero-width bridge
 * at the closest vertex pair. This is the "retrace the hole" trick FORMAT.md
 * teaches by hand, done by the compiler so the winding is always right.
 */
function joinRings(rings: Pt[][]): Pt[] {
  if (rings.length === 0) return [];
  const outer = rings[0]!;
  const sign = Math.sign(signedArea(outer)) || 1;
  let ring = outer.slice();
  for (let n = 1; n < rings.length; n++) {
    let sub = rings[n]!;
    // Nesting depth decides: inside an odd number of earlier subpaths = a hole,
    // even = solid (an island in a hole, like a pupil in an eye-spot ring).
    const depth = rings.slice(0, n).filter((r) => inside(sub[0]!, r)).length;
    const want = depth % 2 === 1 ? -sign : sign;
    if (Math.sign(signedArea(sub)) !== want) sub = sub.slice().reverse();
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
