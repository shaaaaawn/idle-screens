import type { ParamSpace, ParamValue, SaverManifest } from '@idle-screens/core';

/**
 * Zero-dependency manifest module (type-only imports). The channel server
 * imports `@idle-screens/saver-metaquarium/manifest` to validate published
 * params against this paramSpace without pulling three.js into the Worker.
 */
export const METAQUARIUM_PARAMS = {
  /** Camera orbit angle, degrees. */
  cameraAzimuth: { type: 'number', default: 35, min: 0, max: 360, ease: 'smooth' },
  /** Camera height angle, degrees above the waterline plane. */
  cameraElevation: { type: 'number', default: 15, min: -5, max: 60, ease: 'smooth' },
  /** Camera distance from tank center, world units. */
  cameraDistance: { type: 'number', default: 110, min: 80, max: 400, ease: 'smooth' },
  /** Continuous orbit speed, degrees/second. */
  autoRotate: { type: 'number', default: 1.5, min: 0, max: 12, ease: 'smooth' },
  /** Visible fish. Default 1 = hero mode: one fish center-stage in its own
   *  tank; the pool grows on demand when steered up (never shrinks). */
  fishCount: { type: 'number', default: 1, min: 1, max: 24, ease: 'step' },
  /** Swim time-scale multiplier. */
  swimSpeed: { type: 'number', default: 1, min: 0.2, max: 3, ease: 'smooth' },
  /** Hero behavior. 'auto' wanders with periodic greets (the fish notices
   *  you) and rare darts; the rest force a mode: 'greet' faces the viewer up
   *  close, 'idle' hovers, 'dart' sprints, 'goto' swims to fishTarget*. */
  behavior: {
    type: 'enum',
    default: 'auto',
    options: ['auto', 'wander', 'greet', 'idle', 'dart', 'goto'],
  },
  /** Steer target for behavior 'goto', normalized tank coords. */
  fishTargetX: { type: 'number', default: 0, min: -1, max: 1, ease: 'smooth' },
  fishTargetY: { type: 'number', default: 0.5, min: 0, max: 1, ease: 'smooth' },
  fishTargetZ: { type: 'number', default: 0, min: -1, max: 1, ease: 'smooth' },
  /** Water/atmosphere color (background + fog). */
  fogColor: { type: 'color', default: '#030009', ease: 'smooth' },
  /** Selective bloom strength; 0 disables the composers entirely. Kept low by
   *  default — glow, not strobe (the flash gate cares). */
  bloomStrength: { type: 'number', default: 0.35, min: 0, max: 1.5, ease: 'smooth' },
  /** Hero GLB used when no farm is configured (bundled-fish mode). The
   *  default is Fish #1 of the Metaquarium (textured atlas + glow accents +
   *  Swim clip). Steering this mid-run SWAPS the hero in place. */
  fishUrl: { type: 'string', default: '/assets/metaquarium/hero-fish.glb' },
  /** Hero fish by token id ("257"): resolves its model through the farm and
   *  swaps the hero live when steered. Empty = use fishUrl. Falls back to
   *  fishUrl when the farm or token is unavailable (never blank). */
  fishToken: { type: 'string', default: '' },
  /** Metaquarium farm endpoint returning `{message: {metadata: [...]}}` (or a
   *  bare metadata array). Empty = bundled-fish mode. */
  farmUrl: { type: 'string', default: '' },
  /** Gateway prefix that `ipfs://` asset URLs resolve through. */
  ipfsGateway: { type: 'string', default: 'https://ipfs.io/ipfs/' },
  /** Comma-separated token ids to show ("42,257"). Empty = seeded selection. */
  tankTokens: { type: 'string', default: '' },
} satisfies ParamSpace;

/** The original's Miami-Vice body palette (scss-variables.ts) — seeded fish
 *  coats draw from this. Zero-dep so the server/manifest lane can surface it. */
export const MIAMI_VICE_COLORS = [
  '#ff6ad5', // Hot Pink
  '#c774e8', // Light Purple
  '#ad8cff', // Lavender
  '#8795e8', // Periwinkle Blue
  '#94d0ff', // Light Sky Blue
  '#4fb4f4', // Azure
  '#00a6fb', // Bright Blue
  '#0085a1', // Cerulean
  '#0b3d91', // Yale Blue
  '#1c1c1c', // Off Black
];

/** The original's emissive/glow palette (`GLOW-*` parts, bloom layer). */
export const BLOOM_COLORS = [
  '#FF69B4', // Hot Pink
  '#FFFF00', // Yellow
  '#00FFFF', // Cyan
  '#00FF00', // Lime
  '#FF4500', // OrangeRed
  '#7FFF00', // Chartreuse
];

export const metaquariumManifest: SaverManifest = {
  id: 'metaquarium',
  label: 'Metaquarium',
  description:
    'A living fish tank: Metaquarium NFT fish swim seeded analytic paths through a dark, fogged, bloom-lit aquarium. The screen is a tank.',
  minBackend: 'webgl2',
  costTier: 'medium',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  timeModel: 'closed-form',
  palette: ['#030009', '#ff6ad5', '#94d0ff', '#00a6fb', '#00FFFF'],
  paramSpace: METAQUARIUM_PARAMS,
  attribution: {
    source: 'Metaquarium (metaquarium.xyz) — original artwork and fish models by Shawn Partridge',
    license: 'MIT port of first-party artwork; live fish assets stream from the Metaquarium farm',
    url: 'https://metaquarium.xyz',
  },
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
