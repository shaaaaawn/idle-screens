/**
 * The `field` background sampler — seeded, dependency-free value noise that
 * is a PURE function of `(u, v, t, config, seed)`.
 *
 * Why it is its own module, and why it never touches the entity RNG: a
 * background must be able to change without re-seating a single entity. The
 * sampler hashes an integer lattice with its own mixing function, so a spec
 * that adds (or steers) a field keeps the exact `buildEntities` stream it
 * had before — `field.test.ts` asserts it. Because the value at any point is
 * closed-form, the renderer (a low-res raster, upscaled) and the perception
 * grid (`luminanceGrid`) sample the SAME function and agree by construction;
 * that is the analytic guarantee FORMAT.md states for the field.
 *
 * Coordinates: `u`, `v` are in short-side units — `xPx / min(w, h)`,
 * `yPx / min(w, h)` — so `scale` reads as "features across the short side"
 * on every aspect ratio, and a 16:9 frame simply shows more of the same field
 * than a square one does. Callers on both sides normalise the same way.
 */
import type { FieldBackground } from './types';

const TWO_PI = Math.PI * 2;

/** Cache bucket for a drifting field: the raster is recomputed at most this often. */
export const FIELD_BUCKET_MS = 100;
/** Raster short side (px) the renderer paints the field at, then upscales. */
export const FIELD_RASTER_SHORT_SIDE = 96;
/** Raster short side on the `basic` / `minimal` capability tiers. */
export const FIELD_RASTER_SHORT_SIDE_LOW = 48;
/** How far (in feature units) `warp: 1` displaces the sample domain. */
const WARP_GAIN = 2;
/** Radius (in feature units) of the slow domain circle at `drift.amount: 1`. */
const DRIFT_GAIN = 1;
/** Default `drift.amount`. */
export const FIELD_DRIFT_DEFAULT_AMOUNT = 0.3;
/**
 * Contrast stretch per octave count. Bilinear value noise (and more so an
 * octave sum) crowds around 0.5, so evenly spaced band thresholds would give
 * the middle bands almost everything. Each factor rescales the raw value so
 * its spread approaches a uniform 0..1 (σ 0.26–0.30 with ≤ 11 % of samples
 * clamped to an end band, a six-band histogram within 11–22 % per band);
 * measured over 4·10⁵ samples per octave count, symmetric about 0.5.
 */
const CONTRAST: readonly number[] = [1, 1.45, 1.8, 1.95, 2.0];

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Integer-lattice hash → 0..1. Every product goes through `Math.imul` so the
 * arithmetic stays in int32 and the result is identical on every platform
 * (a float multiply of large ints would drift by ULPs across engines).
 */
export function latticeHash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smoothstep = (k: number): number => k * k * (3 - 2 * k);

/** One octave of smooth value noise at (x, y), 0..1. */
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);
  const a = latticeHash(x0, y0, seed);
  const b = latticeHash(x0 + 1, y0, seed);
  const c = latticeHash(x0, y0 + 1, seed);
  const d = latticeHash(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

/** Fractal sum of `octaves` value-noise octaves (amplitude halves, frequency doubles), normalised to 0..1. */
function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    // Each octave samples a shifted lattice with its own seed so octave
    // boundaries never line up into a visible grid.
    sum += amp * valueNoise(x * f + i * 17.3, y * f + i * 31.7, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** The clamped, rounded octave count a config resolves to (steering may glide it through fractions). */
export function fieldOctaves(cfg: Pick<FieldBackground, 'octaves'>): number {
  const o = Math.round(cfg.octaves ?? 2);
  return o < 1 ? 1 : o > 4 ? 4 : o;
}

/**
 * The time the field is sampled at for scene time `t`: with `drift` at a
 * nonzero `amount`, the start of the 100 ms bucket `t` falls in (the renderer
 * recomputes its raster once per bucket and holds it, so the perception grid
 * samples the same instant); without `drift`, or with `drift.amount: 0` (the
 * domain never moves), the field is static and the answer is always 0 — so a
 * legally-static drift config isn't rebucketed, and re-rastered, ten times a
 * second for nothing.
 */
export function fieldSampleTime(cfg: Pick<FieldBackground, 'drift'>, t: number): number {
  return cfg.drift && cfg.drift.amount !== 0 ? Math.floor(t / FIELD_BUCKET_MS) * FIELD_BUCKET_MS : 0;
}

/**
 * The scalar field at short-side coordinates `(u, v)` and time `t` (ms),
 * 0..1. `seed` is the spec's seed; `cfg.seed` overrides it. Pure — no state,
 * no RNG stream, so the same inputs give the same value in every call on
 * every platform.
 */
export function fieldAt(u: number, v: number, t: number, cfg: FieldBackground, seed: number): number {
  const scale = cfg.scale;
  const octaves = fieldOctaves(cfg);
  const s = (cfg.seed ?? seed) >>> 0;
  let x = u * scale;
  let y = v * scale;
  const drift = cfg.drift;
  if (drift) {
    // The sample domain travels a slow circle of radius `amount` feature
    // units: the field loops exactly every `period`, no pixel ever jumps, and
    // the fastest any point can change is bounded by amount / period — which
    // the validator floors at 10 s, so a field can never flash.
    const phase = (TWO_PI * t) / drift.period;
    const r = (drift.amount ?? FIELD_DRIFT_DEFAULT_AMOUNT) * DRIFT_GAIN;
    x += r * Math.sin(phase);
    y += r * Math.cos(phase);
  }
  const warp = cfg.warp ?? 0;
  if (warp > 0) {
    // Domain warp: displace the sample point by a second, independent field.
    // Turns round noise blobs into the smeared, folded contours of a thermal
    // map or a weather chart.
    const qx = fbm(x + 5.2, y + 1.3, s + 7919, octaves) - 0.5;
    const qy = fbm(x + 1.7, y + 9.2, s + 104729, octaves) - 0.5;
    x += warp * WARP_GAIN * qx;
    y += warp * WARP_GAIN * qy;
  }
  const raw = fbm(x, y, s, octaves);
  return clamp01(0.5 + (raw - 0.5) * CONTRAST[octaves]!);
}

/** `#rgb` / `#rrggbb` → integer channels 0..255. Malformed input reads as mid grey. */
export function hexToRgb255(hex: string): [number, number, number] {
  const h = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const n = /^#[0-9a-f]{6}$/i.test(h) ? parseInt(h.slice(1), 16) : NaN;
  if (Number.isNaN(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Perceptual luma (0..1) of integer RGB — the same weights `hexLuma` uses, so a band's luma matches its hex's. */
export function rgb255Luma(rgb: readonly [number, number, number]): number {
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
}

/**
 * The colour a field value paints: `quantize ≥ 2` posterises the value into
 * that many levels and reads each level off the `bands` ramp (`quantize ===
 * bands.length`, the default, is exactly one band per level — hard, crisp
 * contours); `quantize: 0` interpolates the ramp smoothly (Aura, Mist). A
 * steered `quantize` gliding through fractions rounds to the nearest level
 * count. Integer channels, so a quantised band is byte-exact its hex.
 */
export function fieldRgb(value: number, bands: readonly string[], quantize: number | undefined): [number, number, number] {
  const n = bands.length;
  const q = Math.round(quantize ?? n);
  let f: number; // position along the ramp, 0..n-1
  if (q >= 2) {
    const level = Math.min(q - 1, Math.floor(clamp01(value) * q));
    f = (level * (n - 1)) / (q - 1); // multiply first: q === n gives an exact integer
  } else {
    f = clamp01(value) * (n - 1);
  }
  const i = Math.min(n - 2, Math.floor(f));
  const k = f - i;
  const a = hexToRgb255(bands[i]!);
  if (k === 0) return a;
  const b = hexToRgb255(bands[i + 1]!);
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

/** The painted colour at short-side coordinates `(u, v)`: `fieldRgb(fieldAt(...))`. */
export function fieldRgbAt(u: number, v: number, t: number, cfg: FieldBackground, seed: number): [number, number, number] {
  return fieldRgb(fieldAt(u, v, t, cfg, seed), cfg.bands, cfg.quantize);
}
