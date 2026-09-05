import type { ParamSpace, ParamValue, SaverManifest } from '@idle-screens/core';
import { ENVIRONMENT_NAMES } from './environments';
import { FORMATION_SHAPES, SWIM_STYLE_NAMES } from './swim';
import { PATH_SHAPES } from './plan';
import { MANEUVERS } from './maneuver';

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
   *  A minted fish is an INDIVIDUAL: no id appears twice in a scene, and a
   *  count casts that many DISTINCT fish of the breed ("300:12" is twelve
   *  different angelfish). A custom catalog is a closed world (no farm/IPFS
   *  fallback, no uniqueness — NPC entries are species). Counts are
   *  absolute; the expanded total clamps to the device tier's fish cap.
   *  A token may carry its own swim style — `id[:count]@style`, e.g.
   *  "457:3@hover,257:6@school,497:1@surface" — so one tank holds several
   *  behaviours; untagged tokens follow `swimStyle`. Non-empty mix
   *  OVERRIDES fishUrl and fishCount; empty string = single-
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
  /** How the fish move. `loop` is exactly the pre-style behaviour, so the
   *  default changes nothing. A small named set on purpose: a silhouette of
   *  movement you can name is one you can choose from. `auto` lets each
   *  untagged fishMix token swim the way its breed does (seahorse hover,
   *  turtle skim the surface, angelfish school, betafish drift); a token's
   *  `@style` still wins. The relationship styles — `follow`, `pair`,
   *  `chase` — bond a fish to the nearest preceding unbonded fish in the mix
   *  (`seaturtle:1, 257:3@follow` is a turtle with an escort). */
  swimStyle: { type: 'enum', default: 'loop', options: [...SWIM_STYLE_NAMES, 'auto'], ease: 'step' },
  /** The shape a fish's loop is drawn on. `wander` is the original roaming
   *  itinerary, so the default changes nothing. `orbit` laps, `eight` crosses
   *  the middle, `helix` tours the water column, `canyon` sweeps low,
   *  `crossing` is a camera-relative parade lane (across the frame in front,
   *  back the other way behind; laid against cameraAzimuth when chosen) —
   *  same spline engine, different itinerary. */
  pathShape: { type: 'enum', default: 'wander', options: [...PATH_SHAPES], ease: 'step' },
  /** How a `school` holds together: the original lattice, single file, a
   *  carousel ring, the migratory V, or a bait-ball. Ignored by every
   *  non-formation style; the same no-pair-inside-a-body-length law holds
   *  for all of them. */
  formationShape: { type: 'enum', default: 'phalanx', options: [...FORMATION_SHAPES], ease: 'step' },
  /** Per-fish spread: 0 a uniform shoal, 1 every fish visibly its own animal
   *  (±40% speed, ±25% size, own phase). The uniqueness dial — one number
   *  instead of per-fish values nobody wants to author. */
  swimVariance: { type: 'number', default: 0, min: 0, max: 1, ease: 'smooth' },
  /** Named event layered over the swim style — the thing that turns uniform
   *  cruising into behaviour a viewer recognizes. Each fish runs its own
   *  seeded schedule of the chosen event; displacement-based, so frames stay
   *  addressable. `none` (default) changes nothing. */
  maneuver: { type: 'enum', default: 'none', options: [...MANEUVERS], ease: 'step' },
  /** How often events fire: 0 never, 1 the maneuver's own tempo (roughly
   *  every 14-20s per fish, desynchronised), above 1 faster — 3 packs events
   *  nearly back to back. Values <=1 mean exactly what they always did. */
  maneuverRate: { type: 'number', default: 0.5, min: 0, max: 3, ease: 'smooth' },
  /** How hard: scales the surge, the kick, and the tail flurry together. */
  maneuverIntensity: { type: 'number', default: 0.7, min: 0, max: 1, ease: 'smooth' },
  /** Procedural body yaw for models that carry NO animation clip — most of
   *  the breed library. Distance-driven like the tail beat, so it speeds up
   *  with the fish and stays frame-addressable. Clipped models ignore it:
   *  their own clip is the better animation.
   *
   *  Defaults to 0, off, even though a rigidly gliding fish is the worse
   *  look. Every param this saver has added defaults to the previous
   *  behaviour, and a scene already on someone's wall should not start moving
   *  differently because a dependency was bumped. 0.3–0.4 is the recommended
   *  value for a clip-less cast — the studio swim variants all set it. */
  bodyWiggle: { type: 'number', default: 0, min: 0, max: 1, ease: 'smooth' },
  /** Light-seeking: free-swimming fish are drawn toward the room's light
   *  shafts, each fish to its own pool. 0 (default) leaves every route
   *  where it was; 1 pulls a fish most of the way into its shaft, so the
   *  cast gathers in the light and a `rayStrength` dial becomes a staging
   *  dial too. Needs a room with rays; formations are steered by their
   *  carrier and ignore it. */
  lightSeek: { type: 'number', default: 0, min: 0, max: 1, ease: 'smooth' },
  /** Formation breathing: the school relaxes outward and draws back in on a
   *  slow (~15 s) cycle. 0 (default) is the rigid lattice; 1 opens it by up
   *  to a fifth. Only ever expands, so the spacing guarantee holds. */
  formationBreathe: { type: 'number', default: 0, min: 0, max: 1, ease: 'smooth' },
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
export { parseFishMix, expandFishMix, expandFishMixSlots, type FishMixEntry, type FishMixResult, type FishSlot, type FishEntry, FISH_CATALOG, NPC_CATALOG } from './ipfs';

export * from './environments';
export * from './swim';
