import type { ParamSpace, ParamValue, SaverManifest } from '@idle-screens/core';
import { ENVIRONMENT_NAMES } from './environments';

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
  /** GLB model URL for the fish (supports ipfs:// scheme). Package default
   *  is the IPFS hero fish so npm / channel hosts work without playground
   *  static assets; the playground overrides this to a local GLB. */
  fishUrl: { type: 'string', default: 'ipfs://QmaHbEQAP6k2zopJHJBzyaK62zNX5yH8yASDjkaG4DY9Dp/fish_257_of_the_metaquarium_3d.glb' },
  /** Mixed population DSL: comma-separated `id[:count]` of a minted token id
   *  (1-512, default catalog) or breed name — e.g. "257:3,100:2,seaturtle:1".
   *  A custom catalog is a closed world (no farm/IPFS fallback). Counts are
   *  absolute; the expanded total clamps to the device tier's fish cap.
   *  Non-empty mix OVERRIDES fishUrl and fishCount; empty string = single-
   *  breed mode. Unknown ids/bad counts degrade (good tokens still parse);
   *  raw URLs are not accepted here — use fishUrl for a custom single-breed GLB. */
  fishMix: { type: 'string', default: '', ease: 'step' },
  /** Fog start distance, world units. Default matches the tank's original
   *  hardcoded Fog(60, 500) — steering below pulls the murk close. */
  fogNear: { type: 'number', default: 60, min: 20, max: 200, ease: 'smooth' },
  /** Fog full-opacity distance. Kept under the camera far plane (1200);
   *  the tank enforces far > near + 20. */
  fogFar: { type: 'number', default: 500, min: 120, max: 1100, ease: 'smooth' },
  /** Plankton mote density, 0-1 of the device tier's mote budget. Default 0
   *  = off, so the baseline look is untouched until steered. */
  moteDensity: { type: 'number', default: 0, min: 0, max: 1, ease: 'smooth' },
  /** Mote tint. */
  moteColor: { type: 'color', default: '#7fd6ff', ease: 'smooth' },
  /** Floor disc color. Default is the original hardcoded navy. */
  floorColor: { type: 'color', default: '#0a1d33', ease: 'smooth' },
  /** Where the Draco decoder lives, for the many Metaquarium models that are
   *  Draco-compressed. Empty = the copy shipped beside this package (no CDN,
   *  no network beyond your own host). Override when a host serves the
   *  decoder from its own static path. */
  dracoPath: { type: 'string', default: '', ease: 'step' },
  /** The ROOM: a named place rather than thirty numbers. `void` is exactly
   *  the pre-environment scene, so the default changes nothing. Each other
   *  value adds a water ceiling, a terrain silhouette and light shafts,
   *  tier-budgeted. Palette params (fog, floor colour, motes) stay yours —
   *  an environment never overrides them. */
  environment: { type: 'enum', default: 'void', options: [...ENVIRONMENT_NAMES], ease: 'step' },
  /** Override the environment's terrain. `auto` follows the environment. */
  floorKind: { type: 'enum', default: 'auto', options: ['auto', 'flat', 'dunes', 'ridges', 'basin'], ease: 'step' },
  /** Water-ceiling height. -1 = follow the environment; fish swim to y=72.
   *  STEP, not smooth: -1 is a sentinel, so a ramp from -1 to a real height
   *  passes through negatives that read as "auto" — the ceiling would jump
   *  rather than glide. A value you cannot interpolate through must not
   *  advertise that it can. */
  waterY: { type: 'number', default: -1, min: -1, max: 220, ease: 'step' },
  /** Light-shaft strength. -1 = follow the environment, 0 = off. Step for the
   *  same sentinel reason: ramping -1 → 0 would read as FULL strength until it
   *  snapped off. */
  rayStrength: { type: 'number', default: -1, min: -1, max: 1, ease: 'step' },
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
  /** Override the fish catalog fishMix ids resolve against — the seam the
   *  playground uses to point ids at bundled local GLBs (offline e2e), and
   *  the future farm/pack extension point. */
  catalog?: import('./ipfs').FishEntry[];
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

/**
 * Defensive read of a tracked number param. The server validates nothing on
 * the classic steering lane (any path, any value reaches the saver), and MCP
 * harnesses with untyped `value` params stringify numbers — so "22" arrives
 * where 22 was meant. Finite numbers pass; finite numeric strings coerce;
 * anything else falls back to the def's default; the result clamps to the
 * def's min/max. Zero-dep on purpose: hosts can reuse it to sanitize.
 */
export function coerceNum(
  def: { default?: ParamValue; min?: number; max?: number } | undefined,
  v: ParamValue | undefined,
): number {
  let n: number | null = null;
  if (typeof v === 'number' && Number.isFinite(v)) n = v;
  else if (typeof v === 'string' && v.trim() !== '') {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) n = parsed;
  }
  if (n === null) {
    const d = def?.default;
    if (typeof d === 'number' && Number.isFinite(d)) n = d;
    else if (typeof d === 'string' && d.trim() !== '' && Number.isFinite(Number(d))) n = Number(d);
    else n = 0;
  }
  if (def?.min !== undefined && n < def.min) n = def.min;
  if (def?.max !== undefined && n > def.max) n = def.max;
  return n;
}

export * from './farm';
export { parseFishMix, expandFishMix, type FishMixEntry, type FishMixResult, type FishEntry, FISH_CATALOG } from './ipfs';

export * from './environments';
