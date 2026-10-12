/**
 * `floorCover`: what the village lays on its floor — three-free, so the
 * package entry can validate the string (guide.ts) without pulling three.js.
 *
 *   lawn[/style]     a mown lawn in every home's yard (the fence's rectangle,
 *                    fenced or not); styles stripes checks
 *   mosaic[/style]   the square tiled in a compass rose round the fountain (or
 *                    at the hub, with none); styles stone shell glass
 *   mat[/style]      a woven doormat at every door; styles kelp stripe
 *   steps[/style]    stepping stones down the paths; styles slate sand moss
 *                    (none: each walk's own ground)
 *   ripples[/style]  sand combed into ripples by the current, across the open
 *                    floor; styles fine broad
 *
 * `lawn, mosaic, mat, steps, ripples` · `lawn/checks, mosaic/glass`.
 */

export const LAWN_STYLES = ['stripes', 'checks'] as const;
export const MOSAIC_STYLES = ['stone', 'shell', 'glass'] as const;
export const MAT_STYLES = ['kelp', 'stripe'] as const;
export const STEP_STYLES = ['slate', 'sand', 'moss'] as const;
export const RIPPLE_STYLES = ['fine', 'broad'] as const;
export type LawnStyle = (typeof LAWN_STYLES)[number];
export type MosaicStyle = (typeof MOSAIC_STYLES)[number];
export type MatStyle = (typeof MAT_STYLES)[number];
export type StepStyle = (typeof STEP_STYLES)[number];
export type RippleStyle = (typeof RIPPLE_STYLES)[number];

export interface FloorCover {
  lawn: { style: LawnStyle } | null;
  mosaic: { style: MosaicStyle } | null;
  mat: { style: MatStyle } | null;
  /** Null style: each walk's stones match its ground (pebble slate, sand sandstone, algae moss). */
  steps: { style: StepStyle | null } | null;
  ripples: { style: RippleStyle } | null;
}

export const NO_COVER: FloorCover = { lawn: null, mosaic: null, mat: null, steps: null, ripples: null };
export const hasCover = (c: FloorCover | null | undefined): c is FloorCover => !!c && !!(c.lawn || c.mosaic || c.mat || c.steps || c.ripples);

const KINDS = { lawn: LAWN_STYLES, mosaic: MOSAIC_STYLES, mat: MAT_STYLES, steps: STEP_STYLES, ripples: RIPPLE_STYLES } as const;

export function parseFloorCover(src: string): { cover: FloorCover; problems: string[] } {
  const cover: FloorCover = { ...NO_COVER };
  const problems: string[] = [];
  for (const raw of src.split(',')) {
    const part = raw.trim().toLowerCase();
    if (!part) continue;
    const bad = (why: string): void => { problems.push(`"${raw.trim()}": ${why}`); };
    const m = /^([a-z]+)\s*(?::\s*([0-9]+))?\s*(?:\/\s*([a-z]+))?$/.exec(part);
    if (!m) { bad('expected kind[/style] — lawn mosaic mat steps ripples'); continue; }
    const kind = m[1]!, style = m[3];
    if (!(kind in KINDS)) { bad('kinds: lawn mosaic mat steps ripples'); continue; }
    const k = kind as keyof typeof KINDS, styles = KINDS[k] as readonly string[];
    if (m[2] !== undefined) bad(`${kind} has no count`);
    if (style && !styles.includes(style)) { bad(`${kind} styles: ${styles.join(' ')}`); continue; }
    if (k === 'steps') cover.steps = { style: (style as StepStyle) ?? null };
    else (cover as unknown as Record<string, { style: string }>)[k] = { style: style ?? styles[0]! };
  }
  return { cover, problems };
}
