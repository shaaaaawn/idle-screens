import type { ParamSpace, ParamValue, SaverManifest } from '@idle-screens/core';

/**
 * Zero-dependency manifest module (type-only imports). The channel server
 * imports `@idle-screens/saver-metaquarium/manifest` to validate published
 * params against this paramSpace without pulling three.js into the Worker.
 */
export const METAQUARIUM_PARAMS = {
  cameraAzimuth: { type: 'number', default: 35, min: 0, max: 360, ease: 'smooth' },
  cameraElevation: { type: 'number', default: 15, min: -5, max: 60, ease: 'smooth' },
  cameraDistance: { type: 'number', default: 140, min: 80, max: 400, ease: 'smooth' },
  autoRotate: { type: 'number', default: 1.5, min: 0, max: 12, ease: 'smooth' },
  fishCount: { type: 'number', default: 7, min: 1, max: 24, ease: 'step' },
  swimSpeed: { type: 'number', default: 1, min: 0.2, max: 3, ease: 'smooth' },
  fogColor: { type: 'color', default: '#020810', ease: 'smooth' },
  /** Full-scene bloom strength; 0 disables the composer entirely. Kept low by
   *  default — glow, not strobe (the flash gate cares). */
  bloomStrength: { type: 'number', default: 0.35, min: 0, max: 1.5, ease: 'smooth' },
  /** Single-breed GLB used when no farm is configured (walking-skeleton mode). */
  fishUrl: { type: 'string', default: '/assets/metaquarium/beta-fish.glb' },
  /** Metaquarium farm endpoint returning `{message: {metadata: [...]}}` (or a
   *  bare metadata array). Empty = bundled-fish mode. */
  farmUrl: { type: 'string', default: '' },
  /** Gateway prefix that `ipfs://` asset URLs resolve through. */
  ipfsGateway: { type: 'string', default: 'https://ipfs.io/ipfs/' },
  /** Comma-separated token ids to show ("42,257"). Empty = seeded selection. */
  tankTokens: { type: 'string', default: '' },
} satisfies ParamSpace;

export const metaquariumManifest: SaverManifest = {
  id: 'metaquarium',
  label: 'Metaquarium',
  minBackend: 'webgl2',
  costTier: 'medium',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  paramSpace: METAQUARIUM_PARAMS,
  a11y: {
    flashSafe: true,
    notes: 'Slow ambient swim in a dark fogged tank; low static bloom, no strobing.',
  },
};

/** Options for {@link createMetaquarium}-style variants: a distinct id/label and
 *  overridden param defaults (e.g. a farm-connected tank). */
export interface MetaquariumOptions {
  id?: string;
  label?: string;
  params?: Partial<Record<keyof typeof METAQUARIUM_PARAMS, ParamValue>>;
}

/** Clone a paramSpace with default overrides; unknown keys are ignored. */
export function withDefaults(
  space: ParamSpace,
  overrides?: Record<string, ParamValue>,
): ParamSpace {
  if (!overrides) return space;
  const out: ParamSpace = {};
  for (const [k, def] of Object.entries(space)) {
    const o = overrides[k];
    out[k] = o === undefined ? def : { ...def, default: o };
  }
  return out;
}

/** Clone the metaquarium paramSpace with per-variant default overrides. */
export function paramSpaceWith(overrides: MetaquariumOptions['params']): ParamSpace {
  return withDefaults(METAQUARIUM_PARAMS, overrides as Record<string, ParamValue> | undefined);
}
