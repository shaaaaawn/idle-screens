/**
 * `trail` sampling — pure, shared by the renderer (`drawTrail`) and
 * perception (`splatTrail`), so the afterglow the wall paints and the one the
 * luminance grid counts are the same echoes.
 *
 * A trail is `n` echoes of the entity at past times (`length / 50` of them,
 * at most `LIMITS.maxTrailSamples`), each fainter (`fade`) and smaller (to
 * 30 % at the tail). A slow mover's echoes overlap into a smear; a fast one's
 * fell apart into separate dots (X469: a 5 s trail on a path circle was 24
 * dots 208 ms apart). So wherever two neighbouring echoes sit further apart
 * than the echo's radius, echoes are added between them — at their own
 * interpolated times, so they follow the curve — until neighbours are at
 * most half a radius apart. A trail whose echoes already touch gets no
 * extras: every such trail draws exactly what it drew before.
 *
 * A filled span stands in for the one echo it replaces, so its echoes share
 * that echo's ink: each one's alpha is scaled so the ~2r/spacing discs that
 * overlap any point of the ribbon add up to the single echo's alpha (summed
 * under `lighter`, composited otherwise). Without that, a fast additive dot
 * saturated to white along its ribbon instead of keeping its colour and fade.
 */
import { LIMITS } from './types';

export interface TrailEcho {
  /** Scene time of the echo, ms. */
  t: number;
  x: number;
  y: number;
  /** How far back along the trail, 0 (head) .. 1 (tail). */
  k: number;
  alpha: number;
  /** Echo radius in px (the head's half-size, shrinking to 30 % at the tail). */
  r: number;
}

export interface TrailSpec {
  length: number;
  fade?: number;
}

/** Most extra (gap-filling) echoes one entity may add per frame: the layer shares a budget, bounded either way. */
export function trailFillBudget(layerCount: number): number {
  return Math.max(8, Math.min(1200, Math.floor(4800 / Math.max(1, layerCount))));
}

/**
 * The echoes behind an entity at scene time `t`, head first. `posAt` is the
 * entity's position at any time; `headAlpha` / `headSize` its alpha and size
 * now. Sampling stops at a wrap seam (a jump of more than half the viewport),
 * at the clock's start, or where an echo would be invisible (`alpha ≤
 * minAlpha`, radius < 0.2 px). `fillBudget` caps the gap-filling echoes.
 */
export function trailEchoes(
  trail: TrailSpec,
  t: number,
  headAlpha: number,
  headSize: number,
  posAt: (t: number) => { x: number; y: number },
  w: number,
  h: number,
  wrap: boolean,
  fillBudget: number,
  minAlpha = 0,
  additive = false,
): TrailEcho[] {
  const fade = trail.fade ?? 1;
  const n = Math.min(Math.ceil(trail.length / 50), LIMITS.maxTrailSamples);
  const alphaAtK = (k: number): number => headAlpha * (1 - k * fade);
  const radiusAtK = (k: number): number => (headSize / 2) * (1 - k * 0.7);
  const jumps = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
    wrap && (Math.abs(b.x - a.x) > w / 2 || Math.abs(b.y - a.y) > h / 2);

  const head = posAt(t);
  const base: TrailEcho[] = [];
  let prev = head;
  for (let s = 1; s <= n; s++) {
    const k = s / n;
    const pastT = t - k * trail.length;
    if (pastT < 0) break;
    const pos = posAt(pastT);
    if (jumps(prev, pos)) break;
    prev = pos;
    const a = alphaAtK(k);
    if (a <= minAlpha) break;
    const r = radiusAtK(k);
    if (r < 0.2) break;
    base.push({ t: pastT, x: pos.x, y: pos.y, k, alpha: a, r });
  }
  if (base.length === 0) return base;

  // Gap fill: how many echoes each span (head → echo 1, echo 1 → 2, …) needs.
  const need: number[] = [];
  let total = 0;
  for (let i = 0; i < base.length; i++) {
    const a = i === 0 ? head : base[i - 1]!;
    const b = base[i]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const m = d > b.r ? Math.ceil(d / (b.r * 0.5)) - 1 : 0;
    need.push(m);
    total += m;
  }
  if (total === 0) return base;
  const scale = total > fillBudget ? fillBudget / total : 1;

  const out: TrailEcho[] = [];
  let last = head;
  for (let i = 0; i < base.length; i++) {
    const b = base[i]!;
    const m = Math.floor(need[i]! * scale);
    if (m === 0) {
      out.push(b);
      last = b;
      continue;
    }
    const a = i === 0 ? head : base[i - 1]!;
    const spacing = Math.hypot(b.x - a.x, b.y - a.y) / (m + 1);
    // Share of the replaced echo's ink each of the span's echoes carries.
    const share = (alpha: number, r: number): number => {
      const k = Math.min(1, spacing / (2 * r));
      return additive ? alpha * k : 1 - Math.pow(1 - Math.min(1, alpha), k);
    };
    const t0 = i === 0 ? t : base[i - 1]!.t;
    const k0 = i === 0 ? 0 : base[i - 1]!.k;
    for (let j = 1; j <= m; j++) {
      const f = j / (m + 1);
      const tt = t0 + (b.t - t0) * f;
      const k = k0 + (b.k - k0) * f;
      const pos = posAt(tt);
      if (jumps(last, pos)) continue;
      last = pos;
      const r = radiusAtK(k);
      out.push({ t: tt, x: pos.x, y: pos.y, k, alpha: share(alphaAtK(k), r), r });
    }
    out.push({ ...b, alpha: share(b.alpha, b.r) });
    last = b;
  }
  return out;
}
