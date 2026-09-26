/**
 * The canopy: how high things stand at any (x, z) — the ground, the rocks and
 * homes, the crystal domes, and the plants with the room their tips sweep as
 * they sway. The shoal keeps above it so it swims in open water instead of
 * through the kelp, where it disappeared.
 *
 * Built once per scenery on a grid (the shoal asks for it hundreds of times a
 * frame), dilated so a tip's sway is covered and blurred so the school rises
 * over a plant instead of stepping over it — a step in the canopy would snap
 * every fish's heading, which is measured from a moment ago.
 */

export interface CanopyTip { x: number; z: number; y: number; r: number }
export interface Canopy { at(x: number, z: number): number; readonly extent: number; readonly n: number }

/** How far a plant's tip can sweep sideways, from its height above its root
 *  (the FLORA_SWAY envelope: reach × the largest gust, wave and drift sum). */
export function swayReach(h: number): number {
  const reach = Math.min(h * h * 0.0042, 9) + Math.min(h, 6) * 0.06;
  return reach * 3.3;
}

export function buildCanopy(sample: (x: number, z: number) => number, tips: readonly CanopyTip[], extent = 200, n = 64): Canopy {
  const cell = (extent * 2) / n;
  const g = new Float64Array(n * n);
  const cx = (i: number): number => -extent + (i + 0.5) * cell;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = sample(cx(i), cx(j));
    g[j * n + i] = Number.isFinite(v) ? v : 0;
  }
  for (const t of tips) {
    const i0 = Math.max(0, Math.floor((t.x - t.r + extent) / cell)), i1 = Math.min(n - 1, Math.floor((t.x + t.r + extent) / cell));
    const j0 = Math.max(0, Math.floor((t.z - t.r + extent) / cell)), j1 = Math.min(n - 1, Math.floor((t.z + t.r + extent) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (Math.hypot(cx(i) - t.x, cx(j) - t.z) <= t.r + cell * 0.71) g[j * n + i] = Math.max(g[j * n + i]!, t.y);
    }
  }
  // Dilate two cells, then blur twice: a plateau keeps its height, edges ramp.
  const pass = (src: Float64Array, f: (a: number[]) => number, r: number): Float64Array => {
    const out = new Float64Array(n * n);
    const buf: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      buf.length = 0;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const ii = Math.min(n - 1, Math.max(0, i + di)), jj = Math.min(n - 1, Math.max(0, j + dj));
        buf.push(src[jj * n + ii]!);
      }
      out[j * n + i] = f(buf);
    }
    return out;
  };
  const max = (a: number[]): number => Math.max(...a);
  const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;
  const smooth = pass(pass(pass(g, max, 2), mean, 1), mean, 1);
  return {
    extent, n,
    at(x, z) {
      const fx = (x + extent) / cell - 0.5, fz = (z + extent) / cell - 0.5;
      if (fx < 0 || fz < 0 || fx > n - 1 || fz > n - 1) return sample(x, z);
      const i = Math.min(n - 2, Math.floor(fx)), j = Math.min(n - 2, Math.floor(fz));
      const u = fx - i, v = fz - j;
      const a = smooth[j * n + i]!, b = smooth[j * n + i + 1]!, c = smooth[(j + 1) * n + i]!, d = smooth[(j + 1) * n + i + 1]!;
      return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    },
  };
}

/**
 * The canopy the school must clear at each point round its route: for every
 * sample, the highest canopy from a length behind to six lengths ahead, so the
 * school starts rising before it reaches a kelp bed and settles after it.
 * One table per build; the carrier reads it with one lookup instead of
 * sampling the route and the canopy for every fish every frame.
 */
export function shoalLiftTable(
  totalLength: number,
  canopy: Canopy,
  length: number,
  pose: (d: number) => { x: number; z: number },
  samples = 512,
): Float64Array {
  const raw = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    const p = pose((i / samples) * totalLength);
    raw[i] = canopy.at(p.x, p.z);
  }
  const step = totalLength / samples;
  const ahead = Math.ceil((6 * length) / step), behind = Math.ceil(length / step);
  const out = new Float64Array(samples);
  for (let i = 0; i < samples; i++) {
    let m = -Infinity;
    for (let k = -behind; k <= ahead; k++) m = Math.max(m, raw[(i + k + samples) % samples]!);
    out[i] = m;
  }
  return out;
}
