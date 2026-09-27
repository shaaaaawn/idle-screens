/**
 * Analytic models of the paint-level layer fields — `transform` (with its
 * `origin`), `opacity`, and the `groups` a layer paints through — shared by
 * the renderer's maths, perception and the advisories. Internal, not
 * exported from the package. They mirror SpecInstance's draw-time canvas
 * transform: a member of a group is drawn through G·L, where L is the layer's
 * own transform (about its origin) and G the group's (about the viewport
 * centre), so a point p lands at G(L(p)).
 */
import type { LayerGroup, LayerSpec, LayerTransform, SaverSpec } from './types';

export interface Pt { x: number; y: number }

/**
 * A layer's own anchor in px: its `position` point (plus `dx`/`dy`; for a
 * `list`/`table` layout the block's anchor), else the centre of its `region`,
 * else the viewport centre.
 */
export function layerAnchor(layer: LayerSpec, w: number, h: number, unit: number): Pt {
  const p = layer.position;
  if (p) return { x: p.x * w + (p.dx ?? 0) * unit, y: p.y * h + (p.dy ?? 0) * unit };
  const rx = layer.region?.x ?? [0, 1];
  const ry = layer.region?.y ?? [0, 1];
  return { x: ((rx[0] + rx[1]) / 2) * w, y: ((ry[0] + ry[1]) / 2) * h };
}

/** What a layer transform turns about, in px: the viewport centre, or (`origin: 'anchor'`) the layer's anchor. */
export function transformOrigin(tf: LayerTransform, layer: LayerSpec | null, w: number, h: number, unit: number): Pt {
  return tf.origin === 'anchor' && layer ? layerAnchor(layer, w, h, unit) : { x: w / 2, y: h / 2 };
}

/**
 * Where a transform puts a point: about `origin` (default the viewport
 * centre), offsets in min(w,h) units (px under `units: 'px'`). Sprites are not
 * rotated here; the maps model ink, not glyph angle.
 */
export function transformPoint(tf: LayerTransform, p: Pt, w: number, h: number, unit: number, origin: Pt = { x: w / 2, y: h / 2 }): Pt {
  const s = tf.scale ?? 1;
  const sx = s * (tf.scaleX ?? 1);
  let x = (p.x - origin.x) * sx;
  let y = (p.y - origin.y) * s;
  if (tf.rotate) {
    const r = (tf.rotate * Math.PI) / 180;
    const c = Math.cos(r);
    const n = Math.sin(r);
    [x, y] = [x * c - y * n, x * n + y * c];
  }
  return { x: x + origin.x + (tf.x ?? 0) * unit, y: y + origin.y + (tf.y ?? 0) * unit };
}

/** A transform's linear size factor (the geometric mean of its two axes' scales). */
export function transformSize(tf: LayerTransform | undefined): number {
  if (!tf) return 1;
  const s = tf.scale ?? 1;
  return s * Math.sqrt(Math.abs(tf.scaleX ?? 1));
}

/** The group a layer paints through, if it names one that exists. */
export function groupOf(spec: SaverSpec, layer: LayerSpec): LayerGroup | undefined {
  return layer.group === undefined ? undefined : spec.groups?.[layer.group];
}

const clamp01 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);

/** A layer's paint opacity as a multiplier: its own `opacity` × its group's (1 when unset). */
export function paintOpacity(spec: SaverSpec, layer: LayerSpec): number {
  const own = layer.opacity === undefined ? 1 : clamp01(layer.opacity);
  const g = groupOf(spec, layer);
  return g?.opacity === undefined ? own : own * clamp01(g.opacity);
}

/** Back-compat alias: a layer's own paint opacity (no group). */
export const layerOpacity = (layer: LayerSpec): number => (layer.opacity === undefined ? 1 : clamp01(layer.opacity));

/** The combined linear size factor of a layer's own and its group's transforms. */
export function paintSize(spec: SaverSpec, layer: LayerSpec): number {
  return transformSize(layer.transform) * transformSize(groupOf(spec, layer)?.transform);
}

/**
 * The point map a layer is painted through — its own transform about its
 * origin, then its group's about the viewport centre — or null when neither
 * is set (the caller keeps the untouched path).
 */
export function paintMap(spec: SaverSpec, layer: LayerSpec, w: number, h: number, unit: number): ((p: Pt) => Pt) | null {
  const tf = layer.transform;
  const gtf = groupOf(spec, layer)?.transform;
  if (!tf && !gtf) return null;
  const o = tf ? transformOrigin(tf, layer, w, h, unit) : null;
  return (p) => {
    const q = tf ? transformPoint(tf, p, w, h, unit, o!) : p;
    return gtf ? transformPoint(gtf, q, w, h, unit) : q;
  };
}

/** The axis-aligned box a mapped rectangle covers (its four corners through `map`). */
export function mapBox(map: (p: Pt) => Pt, box: { x0: number; y0: number; x1: number; y1: number }): { x0: number; y0: number; x1: number; y1: number } {
  const pts = [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].map(([x, y]) => map({ x: x!, y: y! }));
  return {
    x0: Math.min(...pts.map((p) => p.x)),
    y0: Math.min(...pts.map((p) => p.y)),
    x1: Math.max(...pts.map((p) => p.x)),
    y1: Math.max(...pts.map((p) => p.y)),
  };
}

/** Back-compat: the box a layer transform (about the viewport centre) covers. */
export function transformBox(tf: LayerTransform, box: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number, unit: number): { x0: number; y0: number; x1: number; y1: number } {
  return mapBox((p) => transformPoint(tf, p, w, h, unit), box);
}
