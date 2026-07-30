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
  /** Continuous orbit speed, degrees/second. Zero by default: the tank is
   *  still, letting the fish movement carry the scene. Steer up for an orbit. */
  autoRotate: { type: 'number', default: 0, min: 0, max: 12, ease: 'smooth' },
  /** Visible fish. Default 1 = hero mode: one fish center-stage in its own
   *  tank; the pool grows on demand when steered up (never shrinks). */
  fishCount: { type: 'number', default: 1, min: 1, max: 24, ease: 'step' },
  /** Swim time-scale multiplier. */
  swimSpeed: { type: 'number', default: 1, min: 0.2, max: 3, ease: 'smooth' },
  /** Water/atmosphere color (background + fog). */
  fogColor: { type: 'color', default: '#030009', ease: 'smooth' },
  /** GLB model URL for the fish (supports ipfs:// scheme). */
  fishUrl: { type: 'string', default: 'ipfs://QmaHbEQAP6k2zopJHJBzyaK62zNX5yH8yASDjkaG4DY9Dp/fish_257_of_the_metaquarium_3d.glb' },
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
    'A living fish tank: skinned GLB fish swim seeded Catmull-Rom paths through a dark, fogged aquarium.',
  minBackend: 'webgl2',
  costTier: 'medium',
  motionIntensity: 'calm',
  reducedMotionFallback: 'static',
  timeModel: 'closed-form',
  palette: ['#030009', '#ff6ad5', '#94d0ff', '#00a6fb', '#00FFFF'],
  paramSpace: METAQUARIUM_PARAMS,
  attribution: {
    source: 'Metaquarium (metaquarium.xyz) — original artwork and fish models by Shawn Partridge',
    license: 'MIT port of first-party artwork',
    url: 'https://metaquarium.xyz',
  },
  a11y: {
    flashSafe: true,
    notes: 'Slow ambient swim in a dark fogged tank; no strobing.',
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
