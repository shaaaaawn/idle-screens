/**
 * Shared luminance helpers.
 *
 * These live in their own module because both `perceive` (which ranks layers by
 * visual weight) and `advise` (which warns about layers that can't be seen)
 * need the same notion of "how bright is this thing" — and `perceive` already
 * imports `advise`, so the dependency can only run one way.
 */

import type { Entity } from './simulate';
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
  if (s.kind === 'circle' || s.kind === 'ring' || s.kind === 'streak' || s.kind === 'rect') {
    return hexLuma(s.colors?.[e.colorIndex] ?? s.color);
  }
  if (s.kind === 'text' || s.kind === 'textBlock') return hexLuma(s.color ?? '#e6e8ef');
  return 0.75; // emoji: mid-bright approximation
}

/** The hex a given entity actually paints with, or null for glyph sprites. */
export function spriteHex(layer: LayerSpec, e: Entity): string | null {
  const s = layer.sprite;
  if (s.kind === 'circle' || s.kind === 'ring' || s.kind === 'streak' || s.kind === 'rect') {
    return s.colors?.[e.colorIndex] ?? s.color;
  }
  if (s.kind === 'text' || s.kind === 'textBlock') return s.color ?? '#e6e8ef';
  return null; // emoji carry their own palette
}

/** Mean luma of the background plate a layer is drawn against. */
export function backgroundLuma(spec: SaverSpec): number {
  const bg = spec.background;
  if (!bg || bg.type === 'solid') return hexLuma(bg?.color ?? '#05050a');
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
  const acc = bg.stops.reduce(
    (s, st) => {
      const c = hexRgb(st.color);
      return { r: s.r + c.r, g: s.g + c.g, b: s.b + c.b };
    },
    { r: 0, g: 0, b: 0 },
  );
  const n = bg.stops.length || 1;
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
