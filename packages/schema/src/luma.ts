/**
 * Shared luminance helpers.
 *
 * These live in their own module because both `perceive` (which ranks layers by
 * visual weight) and `advise` (which warns about layers that can't be seen)
 * need the same notion of "how bright is this thing" — and `perceive` already
 * imports `advise`, so the dependency can only run one way.
 */

import type { Entity } from './simulate';
import { isShapedSprite } from './shapes';
import { fieldRgbAt } from './field';
import type { LayerSpec, SaverSpec } from './types';

/** Perceptual luma (0..1) of a hex colour. */
export function hexLuma(hex: string): number {
  const h = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const n = parseInt(h.slice(1), 16);
  if (Number.isNaN(n)) return 0.7;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function spriteLuma(layer: LayerSpec, e: Entity): number {
  const s = layer.sprite;
  if (isShapedSprite(s)) {
    return hexLuma(s.colors?.[e.colorIndex] ?? s.color);
  }
  if (s.kind === 'text' || s.kind === 'textBlock') return hexLuma(s.color ?? '#e6e8ef');
  return 0.75; // emoji: mid-bright approximation
}

/** The hex a given entity actually paints with, or null for glyph sprites. */
export function spriteHex(layer: LayerSpec, e: Entity): string | null {
  const s = layer.sprite;
  if (isShapedSprite(s)) {
    return s.colors?.[e.colorIndex] ?? s.color;
  }
  if (s.kind === 'text' || s.kind === 'textBlock') return s.color ?? '#e6e8ef';
  return null; // emoji carry their own palette
}

/**
 * Mean luma of the background plate a layer is drawn against. A gradient
 * averages its stops; a field averages its bands — the field's value
 * distribution is symmetric about 0.5 (see `field.ts`), so the mean band is
 * the mean plate.
 */
export function backgroundLuma(spec: SaverSpec): number {
  const bg = spec.background;
  if (!bg || bg.type === 'solid') return hexLuma(bg?.color ?? '#05050a');
  if (bg.type === 'field') return bg.bands.reduce((s, c) => s + hexLuma(c), 0) / bg.bands.length;
  return bg.stops.reduce((s, st) => s + hexLuma(st.color), 0) / bg.stops.length;
}

/** Unpack a hex colour to 0..1 RGB. */
export function hexRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const n = parseInt(h.slice(1), 16);
  if (Number.isNaN(n)) return { r: 0.7, g: 0.7, b: 0.7 };
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** Mean RGB of the background plate. */
export function backgroundRgb(spec: SaverSpec): { r: number; g: number; b: number } {
  const bg = spec.background;
  if (!bg || bg.type === 'solid') return hexRgb(bg?.color ?? '#05050a');
  const colours = bg.type === 'field' ? bg.bands : bg.stops.map((st) => st.color);
  const acc = colours.reduce(
    (s, hex) => {
      const c = hexRgb(hex);
      return { r: s.r + c.r, g: s.g + c.g, b: s.b + c.b };
    },
    { r: 0, g: 0, b: 0 },
  );
  const n = colours.length || 1;
  return { r: acc.r / n, g: acc.g / n, b: acc.b / n };
}

/**
 * How far a layer's colour separates from its background, ignoring alpha and
 * geometry — purely "can this be told apart from the plate behind it".
 *
 * **This is a colour distance, not a luminance one, and that distinction is
 * load-bearing.** Equal-luminance/contrasting-hue is a real technique, not a
 * mistake: a Seurat-style field of golden `#e8c060` dots over a pale grey-blue
 * plate differs by 0.013 in luma and is perfectly visible, because the
 * separation lives entirely in hue. A luma-only test flags exactly the
 * pointillist screens it should leave alone.
 *
 * Additive blends are a different question again. Under `lighter`/`screen` the
 * sprite ADDS light, so a colour matching the background is still visible (it
 * doubles it); what makes such a layer vanish is having little light to add —
 * which genuinely is a luminance question.
 *
 * Alpha and radius are deliberately excluded — `invisible-layer` already owns
 * that axis, and the schema actively recommends faint atmospheric layers
 * ("80 tiny soft circles at alpha 0.2"), which must not be flagged here.
 */
export function colourSeparation(
  layer: LayerSpec,
  sprite: { rgb: { r: number; g: number; b: number }; luma: number },
  bg: { rgb: { r: number; g: number; b: number }; luma: number },
): number {
  if (layer.blend === 'lighter' || layer.blend === 'screen') return sprite.luma;
  const dr = sprite.rgb.r - bg.rgb.r;
  const dg = sprite.rgb.g - bg.rgb.g;
  const db = sprite.rgb.b - bg.rgb.b;
  // Euclidean in RGB, normalised so 1 = black-to-white. Crude next to CIEDE2000
  // but it separates hue from value, which is the whole point here.
  return Math.sqrt((dr * dr + dg * dg + db * db) / 3);
}

// ---------------------------------------------------------------------------
// Legibility — WCAG 2.x relative luminance and the ratio between two colours.
// Used only by layers that declare `role: 'read'`; `hexLuma` above stays the
// perceptual (gamma-space) weight the perception grid is built on.
// ---------------------------------------------------------------------------

export type Rgb = { r: number; g: number; b: number };

/** sRGB channel (0..1) → linear light, per WCAG 2.x. */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance (0..1, linear light) of a 0..1 RGB triple. */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * srgbToLinear(rgb.r) + 0.7152 * srgbToLinear(rgb.g) + 0.0722 * srgbToLinear(rgb.b);
}

/**
 * WCAG legibility ratio (1..21) between two colours, order-free:
 * `(L_lighter + 0.05) / (L_darker + 0.05)`. 4.5 is the AA floor for body
 * text; 3 for large text.
 */
export function legibilityRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The background colour under one point, `yPx` down a `h`-tall viewport:
 * a solid is itself; a gradient is its stops interpolated in sRGB at their
 * rest positions (`drift` moves them ±`amount` over time — the rest position
 * is the mean); a `band` wins where the point falls inside it. `unit` is the
 * spec's dimensional unit (1 for `px`, `min(w,h)` otherwise), for the band.
 * A field is sampled at the point when `xPx`/`w` are given (at `t` 0 — a
 * drifting field's rest), else it reads as its mean band, like the gradient.
 */
export function backgroundRgbAt(spec: SaverSpec, yPx: number, h: number, unit: number, xPx?: number, w?: number): Rgb {
  const bg = spec.background;
  if (!bg || bg.type === 'solid') return hexRgb(bg?.color ?? '#05050a');
  if (bg.type === 'field') {
    if (xPx === undefined || w === undefined) return backgroundRgb(spec);
    const short = Math.max(1, Math.min(w, h));
    const c = fieldRgbAt(xPx / short, yPx / short, 0, bg, spec.seed ?? 42);
    return { r: c[0] / 255, g: c[1] / 255, b: c[2] / 255 };
  }
  if (bg.band) {
    const bh = bg.band.height * unit;
    if (yPx >= h - bh) return hexRgb(bg.band.color);
  }
  const stops = [...bg.stops].sort((a, b) => a.at - b.at);
  const y = h > 0 ? Math.max(0, Math.min(1, yPx / h)) : 0;
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (y <= first.at) return hexRgb(first.color);
  if (y >= last.at) return hexRgb(last.color);
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!;
    const b = stops[i]!;
    if (y > b.at) continue;
    const span = b.at - a.at;
    const k = span > 0 ? (y - a.at) / span : 1;
    const ca = hexRgb(a.color);
    const cb = hexRgb(b.color);
    return { r: ca.r + (cb.r - ca.r) * k, g: ca.g + (cb.g - ca.g) * k, b: ca.b + (cb.b - ca.b) * k };
  }
  return hexRgb(last.color);
}

/**
 * Standard alpha (source-over) composite of `colour` at `alpha` over `ground` —
 * what a translucent or faint layer actually paints, rather than its
 * configured colour at full strength. Used so a `role: 'read'` text at low
 * alpha (or a `textBlock` with `opacity < 1`) is measured for what it really
 * puts on screen, not the undiluted ink colour.
 */
export function sourceOverPlate(ground: Rgb, colour: Rgb, alpha: number): Rgb {
  return {
    r: ground.r + (colour.r - ground.r) * alpha,
    g: ground.g + (colour.g - ground.g) * alpha,
    b: ground.b + (colour.b - ground.b) * alpha,
  };
}

/**
 * The plate an additive layer leaves behind it at full strength: `colour ×
 * alpha` added to the ground (`lighter`), or screened onto it (`screen`).
 * Per channel, clamped to 1 — the same arithmetic the canvas applies, minus
 * the soft falloff (the centre of a soft disc is at full strength).
 */
export function additivePlate(ground: Rgb, colour: Rgb, alpha: number, blend: 'lighter' | 'screen'): Rgb {
  const mix = (g: number, c: number): number => {
    const v = c * alpha;
    return blend === 'lighter' ? Math.min(1, g + v) : 1 - (1 - g) * (1 - v);
  };
  return { r: mix(ground.r, colour.r), g: mix(ground.g, colour.g), b: mix(ground.b, colour.b) };
}
