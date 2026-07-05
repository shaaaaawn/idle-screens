/**
 * Photometry helpers for the flash validator. Relative luminance follows the WCAG
 * definition (linearized sRGB, Rec.709 weights) so the flash thresholds are the real
 * ones. `redness` is a DELIBERATE APPROXIMATION of the saturated-red signal (not the
 * exact PEAT/Harding red-flash formula) — see flash.ts.
 */

/** sRGB 8-bit channel (0..255) -> linear-light 0..1 (WCAG piecewise curve). */
export function srgbToLinear(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an sRGB colour, 0 (black) .. 1 (white). */
export function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/**
 * Approximate "saturated red" signal, 0..1. Used for a conservative red-flash flag.
 * NOT the normative WCAG/PEAT red-flash measure (which is a specialised saturated-red
 * transition metric) — treat a red-flash failure here as "needs a closer look".
 */
export function redness(r: number, g: number, b: number): number {
  const m = Math.max(g, b);
  return r > m ? (r - m) / 255 : 0;
}

export interface RgbaLike {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

export interface TileStats {
  /** Per-pixel (= per-tile) relative luminance, row-major. */
  lum: number[];
  /** Per-pixel (= per-tile) redness. */
  red: number[];
}

/**
 * Turn a (usually DOWNSCALED) frame into per-tile luminance + redness. Downscale the
 * real frame into a small grid (e.g. 32x32) with the browser's `drawImage`, then each
 * pixel here is one tile whose value already averages its source region. Per-tile (not
 * whole-frame-average) analysis is what lets a localized strobe be caught.
 */
export function tileStatsFromImageData(img: RgbaLike): TileStats {
  const n = img.width * img.height;
  const lum: number[] = new Array(n);
  const red: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = img.data[o];
    const g = img.data[o + 1];
    const b = img.data[o + 2];
    lum[i] = relativeLuminance(r, g, b);
    red[i] = redness(r, g, b);
  }
  return { lum, red };
}
