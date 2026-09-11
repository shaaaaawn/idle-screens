/**
 * The print `finish` — grain and a dither screen composited over a finished
 * frame as the LAST step of a render, after every layer and after ghosting
 * has done its work.
 *
 * Two rules make it flash-safe and deterministic:
 *
 * 1. **Zero-mean, bounded.** The grain tile is noise centred on mid grey and
 *    the dither tile is an ordered Bayer matrix whose mean is mid grey; both
 *    are composited with a symmetric blend (`overlay`, falling back to
 *    `soft-light`, then `multiply`) at a small alpha, so the frame's mean
 *    luminance is unchanged — a finish can neither brighten nor darken a
 *    wall, and the analytic `luminanceGrid` ignores it entirely.
 * 2. **Seeded, never `Math.random`.** The grain tile is generated once per
 *    mount from the spec seed with the same lattice hash the field uses. Its
 *    offset is fixed for the mount; with `animate: true` it steps
 *    deterministically from the frame's time bucket (12 Hz), so two viewers
 *    at the same `t` show the same grain, and a seek is exact.
 *
 * The persistence rule: the finish is applied on a *presentation* canvas,
 * never on the canvas `ghosting` decays into — see `presentWithFinish`. Fed
 * back into the persistence loop, a static tile would reinforce itself every
 * frame into mud.
 */
import { latticeHash } from './field';
import type { FinishSpec } from './types';

/** Grain tile side (px). Repeats across the frame. */
export const GRAIN_TILE = 256;
/** Ordered-dither tile side (px): an 8×8 Bayer matrix. */
export const DITHER_TILE = 8;
/** Composite alpha at `grain: 1`. */
export const GRAIN_ALPHA = 0.35;
/** Composite alpha at `dither: 1`. */
export const DITHER_ALPHA = 0.25;
/** Offset step rate under `animate: true`. */
export const FINISH_ANIMATE_HZ = 12;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The clamped strengths a spec's finish resolves to (0 when absent). */
export function finishStrength(f: FinishSpec | undefined): { grain: number; dither: number } {
  return { grain: clamp01(f?.grain ?? 0), dither: clamp01(f?.dither ?? 0) };
}

/**
 * RGBA pixels of the grain tile for `seed`: zero-mean grey noise (the sum of
 * two lattice hashes — a triangular distribution, softer than uniform —
 * centred on 128), alpha 255. Pure; the same seed gives the same tile on
 * every platform.
 */
export function grainTilePixels(seed: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(GRAIN_TILE * GRAIN_TILE * 4);
  const s = seed >>> 0;
  let i = 0;
  for (let y = 0; y < GRAIN_TILE; y++) {
    for (let x = 0; x < GRAIN_TILE; x++) {
      const v = (latticeHash(x, y, s) + latticeHash(x, y, s + 0x5bd1e995)) / 2;
      const g = Math.round(128 + (v - 0.5) * 255);
      px[i++] = g;
      px[i++] = g;
      px[i++] = g;
      px[i++] = 255;
    }
  }
  return px;
}

/** The 8×8 Bayer ordered-dither matrix (values 0..63, recursively built). */
export function bayerMatrix(): number[][] {
  let m: number[][] = [[0]];
  for (let n = 1; n < DITHER_TILE; n *= 2) {
    const next: number[][] = [];
    for (let y = 0; y < n * 2; y++) {
      const row: number[] = [];
      for (let x = 0; x < n * 2; x++) {
        const base = m[y % n]![x % n]! * 4;
        const quadrant = (y >= n ? 2 : 0) + (x >= n ? 1 : 0);
        row.push(base + [0, 2, 3, 1][quadrant]!);
      }
      next.push(row);
    }
    m = next;
  }
  return m;
}

/**
 * RGBA pixels of the dither tile: the Bayer matrix as grey levels
 * `(v + 0.5) / 64 × 255`, so the tile's mean is mid grey (zero-mean under a
 * symmetric blend). A stylistic screen — it is composited at low alpha, not
 * used to threshold the image per pixel.
 */
export function bayerTilePixels(): Uint8ClampedArray {
  const m = bayerMatrix();
  const px = new Uint8ClampedArray(DITHER_TILE * DITHER_TILE * 4);
  let i = 0;
  for (let y = 0; y < DITHER_TILE; y++) {
    for (let x = 0; x < DITHER_TILE; x++) {
      const g = Math.round(((m[y]![x]! + 0.5) / (DITHER_TILE * DITHER_TILE)) * 255);
      px[i++] = g;
      px[i++] = g;
      px[i++] = g;
      px[i++] = 255;
    }
  }
  return px;
}

/**
 * Where the grain tile sits for scene time `t`: fixed at the origin unless
 * `animate`, in which case it steps to a seeded offset (0..255 per axis)
 * once per 1/12 s bucket — a pure function of `(t, seed)`.
 */
export function grainOffset(t: number, seed: number, animate: boolean): { x: number; y: number } {
  if (!animate) return { x: 0, y: 0 };
  const bucket = Math.floor((t * FINISH_ANIMATE_HZ) / 1000);
  const s = seed >>> 0;
  return {
    x: Math.floor(latticeHash(bucket, 1, s) * GRAIN_TILE),
    y: Math.floor(latticeHash(bucket, 2, s) * GRAIN_TILE),
  };
}

export type ScreenOp = 'overlay' | 'soft-light' | 'multiply';

/**
 * The symmetric blend the finish composites with. `overlay` is what every
 * shipping canvas2d implements; the readback detect exists for the odd
 * context that rejects it (an assignment the context does not support leaves
 * the previous value in place).
 */
export function pickScreenOp(ctx: { globalCompositeOperation: string }): ScreenOp {
  const prev = ctx.globalCompositeOperation;
  let op: ScreenOp = 'multiply';
  for (const candidate of ['overlay', 'soft-light'] as const) {
    ctx.globalCompositeOperation = candidate;
    if (ctx.globalCompositeOperation === candidate) {
      op = candidate;
      break;
    }
  }
  ctx.globalCompositeOperation = prev;
  return op;
}

type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/**
 * A presentation pass: the visible canvas and the tiles (as repeat
 * patterns, created lazily and cached — patterns are bound to the context
 * that made them). Owned by the instance that presents; the scene itself is
 * drawn on a separate canvas that this pass copies from.
 */
export interface FinishPass {
  canvas: AnyCanvas;
  ctx: Canvas2D;
  op: ScreenOp;
  grain: CanvasPattern | null;
  dither: CanvasPattern | null;
  /** Seed the grain tile was generated for. */
  seed: number;
}

/** A canvas of `size`² px carrying `pixels`, or null where ImageData is unavailable. */
function tileCanvas(size: number, pixels: Uint8ClampedArray): AnyCanvas | null {
  const canvas: AnyCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(size, size);
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d') as Canvas2D | null;
  if (!ctx || typeof ctx.createImageData !== 'function') return null;
  const img = ctx.createImageData(size, size);
  img.data.set(pixels);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Open a presentation pass on `visible`; null if it has no 2d context. */
export function createFinishPass(visible: AnyCanvas, seed: number): FinishPass | null {
  const ctx = visible.getContext('2d', { alpha: false }) as Canvas2D | null;
  if (!ctx) return null;
  return { canvas: visible, ctx, op: pickScreenOp(ctx), grain: null, dither: null, seed };
}

/** A fresh scene canvas for the instance to draw into (never attached to the DOM). */
export function createSceneCanvas(width: number, height: number): AnyCanvas {
  if (typeof document === 'undefined') return new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  return canvas;
}

function pattern(fp: FinishPass, size: number, pixels: Uint8ClampedArray): CanvasPattern | null {
  const tile = tileCanvas(size, pixels);
  if (!tile || typeof fp.ctx.createPattern !== 'function') return null;
  return fp.ctx.createPattern(tile as CanvasImageSource, 'repeat');
}

/**
 * Copy `scene` onto the pass's canvas and screen the finish over it:
 * grain at `grain × 0.35` (tile offset per `grainOffset`), then dither at
 * `dither × 0.25`, both with the pass's blend op and no image smoothing (a
 * crisp screen). With nothing to apply it is a plain copy. `w`/`h` are the
 * logical size the context transform maps to the canvas. `seed` is the
 * effective seed the *current* finish resolves to — a sequence with a
 * segment-level finish can present a different seed per frame (one segment
 * to the next); it defaults to the pass's own seed, so a single-scene
 * caller (whose seed never changes) can omit it. The cached grain pattern
 * is rebuilt whenever the seed changes.
 */
export function presentWithFinish(
  fp: FinishPass,
  scene: AnyCanvas,
  w: number,
  h: number,
  t: number,
  finish: FinishSpec | undefined,
  animateAllowed: boolean,
  seed: number = fp.seed,
): void {
  const p = fp.ctx;
  p.globalAlpha = 1;
  p.globalCompositeOperation = 'source-over';
  p.drawImage(scene as CanvasImageSource, 0, 0, w, h);
  // Same normalization SpecInstance applies to every seed it renders with
  // (0 is falsy, so a valid `seed: 0` lands on 1) — callers may pass a raw,
  // un-normalized seed, and the comparison below needs both sides in the
  // same space or a `seed: 0` scene would never match `fp.seed`.
  const normalizedSeed = (seed >>> 0) || 1;
  if (normalizedSeed !== fp.seed) {
    fp.seed = normalizedSeed;
    fp.grain = null;
  }
  const { grain, dither } = finishStrength(finish);
  if (grain > 0) {
    fp.grain ??= pattern(fp, GRAIN_TILE, grainTilePixels(fp.seed));
    if (fp.grain) screen(fp, fp.grain, grain * GRAIN_ALPHA, grainOffset(t, fp.seed, animateAllowed && finish?.animate === true), w, h);
  }
  if (dither > 0) {
    fp.dither ??= pattern(fp, DITHER_TILE, bayerTilePixels());
    if (fp.dither) screen(fp, fp.dither, dither * DITHER_ALPHA, { x: 0, y: 0 }, w, h);
  }
}

function screen(fp: FinishPass, pat: CanvasPattern, alpha: number, off: { x: number; y: number }, w: number, h: number): void {
  const p = fp.ctx;
  p.save();
  p.globalCompositeOperation = fp.op;
  p.globalAlpha = alpha;
  p.imageSmoothingEnabled = false;
  p.fillStyle = pat;
  // The pattern's origin follows the transform: shift it by the offset and
  // fill the same frame rectangle from there.
  p.translate(-off.x, -off.y);
  p.fillRect(off.x, off.y, w, h);
  p.restore();
}
