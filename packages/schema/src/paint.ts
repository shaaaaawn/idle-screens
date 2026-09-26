/**
 * Analytic models of the paint-level layer fields (`transform`, `opacity`)
 * shared by perception and the advisories — internal, not exported from the
 * package. They mirror SpecInstance's draw-time canvas transform.
 */
import type { LayerSpec, LayerTransform } from './types';

/**
 * Where a layer `transform` puts a point — the renderer's canvas transform
 * (about the viewport centre, offsets in min(w,h) units) applied to one
 * position. Sprites are not rotated here; the maps model ink, not glyph angle.
 */
export function transformPoint(tf: LayerTransform, p: { x: number; y: number }, w: number, h: number, unit: number): { x: number; y: number } {
  const s = tf.scale ?? 1;
  const sx = s * (tf.scaleX ?? 1);
  let x = (p.x - w / 2) * sx;
  let y = (p.y - h / 2) * s;
  if (tf.rotate) {
    const r = (tf.rotate * Math.PI) / 180;
    const c = Math.cos(r);
    const n = Math.sin(r);
    [x, y] = [x * c - y * n, x * n + y * c];
  }
  return { x: x + w / 2 + (tf.x ?? 0) * unit, y: y + h / 2 + (tf.y ?? 0) * unit };
}

/** A layer transform's linear size factor (the geometric mean of its two axes' scales). */
export function transformSize(tf: LayerTransform | undefined): number {
  if (!tf) return 1;
  const s = tf.scale ?? 1;
  return s * Math.sqrt(Math.abs(tf.scaleX ?? 1));
}

/** A layer's paint `opacity` as a multiplier (1 when unset). */
export const layerOpacity = (layer: LayerSpec): number => (layer.opacity === undefined ? 1 : Math.max(0, Math.min(1, layer.opacity)));

/** The axis-aligned box a transformed rectangle covers (its four corners mapped by `transformPoint`). */
export function transformBox(
  tf: LayerTransform,
  box: { x0: number; y0: number; x1: number; y1: number },
  w: number,
  h: number,
  unit: number,
): { x0: number; y0: number; x1: number; y1: number } {
  const pts = [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].map(([x, y]) => transformPoint(tf, { x: x!, y: y! }, w, h, unit));
  return {
    x0: Math.min(...pts.map((p) => p.x)),
    y0: Math.min(...pts.map((p) => p.y)),
    x1: Math.max(...pts.map((p) => p.x)),
    y1: Math.max(...pts.map((p) => p.y)),
  };
}
