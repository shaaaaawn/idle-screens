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
  /** A named framing: `orbit` (the classic camera), hero, front, low, top,
   *  surface (looking up at the water's underside) or macro (close on the
   *  landmark nearest the front). Azimuth and autoRotate still turn it;
   *  distance scales it. A change is a cut. */
  shot: { type: 'enum', default: 'orbit', options: ['orbit', 'hero', 'front', 'low', 'top', 'surface', 'macro'], ease: 'step' },
  /** Ride with one fish (a cast slot, 0 = first); -1 (default) is the orbit
   *  camera. The orbit params are ignored while following. */
  cameraFollow: { type: 'number', default: -1, min: -1, max: 23, ease: 'step' },
  /** How far behind the followed fish the camera rides, along the path it
   *  swam. Under about one body length (18) it is the fish's own eye, and the
   *  fish itself is hidden. */
  followDistance: { type: 'number', default: 45, min: 0, max: 160, ease: 'smooth' },
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
  /** Fog full-opacity distance. Kept under the camera far plane (1400);
   *  the tank enforces far > near + 20. */
  fogFar: { type: 'number', default: 500, min: 120, max: 1100, ease: 'smooth' },
  /** Water instead of fog: red is lost with distance first, green next, blue
   *  last (blue keeps today's fog curve, so everything still meets the
   *  background at `fogFar`). 0 (default) is today's fog exactly. */
  water: { type: 'number', default: 0, min: 0, max: 1, ease: 'smooth' },
  /** Output dither (±½ of an 8-bit step) on every material: the cure for
   *  banding in dark fogged gradients on TV panels. Costs nothing per frame;
   *  off by default only because turning it on recompiles every material. */
  dither: { type: 'enum', default: 'off', options: ['on', 'off'], ease: 'step' },
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
  /** Caustics: the net of light a rippled surface throws on the floor, rocks,
   *  plants and fish — sharp near the surface, broad and dim deep down,
   *  brightest on faces that look up. 0 compiles the stock programs. */
  caustics: { type: 'number', default: 0, min: 0, max: 1, ease: 'smooth' },
  /** Size of the caustic cells (1 = about two-thirds of a fish). */
  causticScale: { type: 'number', default: 1, min: 0.4, max: 3, ease: 'smooth' },
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
   *  carousel ring, the migratory V, a bait-ball, or the ring tilted into a
   *  `wheel` that reads from a side camera. Ignored by every
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
  /** An ambient school of small voxel fish swimming as one body beside the
   *  cast — relaxed formation, burst-and-coast tails, the odd fish wandering
   *  out and back. The amount sets the count (up to 2.5× the tier's fish cap). */
  shoal: { type: 'number', default: 0, min: 0, max: 1, ease: 'step' },
  shoalKind: { type: 'enum', default: 'neon', options: ['neon', 'rummynose', 'ember'], ease: 'step' },
  // ---- The look. These three are the RENDERER, not settings a scene must
  // carry: every tank is lit, glowing and reflective with no params at all,
  // and the room, the cast and the camera never need to know. Each exists only
  // so a scene can opt OUT (or turn the glow up).
  /** How strongly the fish's own `GLOW-*` parts glow: a soft bloom card
   *  around the glowing fins, a white-hot breathing core, and colour thrown on
   *  the floor beneath a low swimmer. 0 is the flat glow colour + thin halo
   *  the tank had before. No composer — one instanced draw for the whole cast. */
  fishGlow: { type: 'number', default: 0.6, min: 0, max: 1, ease: 'smooth' },
  /** `lit` (default): fish take light — a key and fill so every voxel face
   *  shades by where it points, a generated studio environment for their metal
   *  to reflect, and point lights riding the glow parts nearest the camera so
   *  a glowing fin colours the body beside it. `flat` is the original unlit
   *  look. Read at mount. */
  fishLighting: { type: 'enum', default: 'lit', options: ['lit', 'flat'], ease: 'step' },
  /** The finish: one full-screen pass — a gentle grade, dither against
   *  banding, and restrained bloom on high-end devices. 0 draws straight to
   *  the screen as before; the low tier never runs it. */
  finish: { type: 'number', default: 0, min: 0, max: 1, ease: 'smooth' },
  /** Metallic plates read as metal (a generated chrome matcap — reflection
   *  with no environment map and no lights). `off` is non-metallic instead —
   *  still lit under `fishLighting: 'lit'`; pair with `fishLighting: 'flat'`
   *  for the original unlit atlas look. */
  fishMetal: { type: 'enum', default: 'on', options: ['on', 'off'], ease: 'step' },
  /** Eye life, 0..1: blinks on a personal clock, idle saccades, pupils that
   *  lead a turn or a climb, eyes on whoever a vignette has it talking to, a
   *  glance at the camera now and then, wide for a hop and shut for a rest.
   *  A fragment function on the eye materials only. Defaults to 0 — the
   *  stock eye program, byte for byte — because every param this saver adds
   *  defaults to the previous look; a scene opts in with 1. */
  eyeLife: { type: 'number', default: 0, min: 0, max: 1, ease: 'smooth' },
  /** A body wave from nose to tail, beating with distance swum and curling
   *  into turns. 0 keeps the legacy rigid wiggle and the stock programs. */
  swimWave: { type: 'number', default: 0, min: 0, max: 1, ease: 'smooth' },
  /** Independent mineral-world layers. Zero preserves legacy scenes; counts
   * are reduced by the device's existing prop budget. All motion is analytic. */
  rockDensity: { type: 'number', default: 0, min: 0, max: 1, ease: 'step' },
  /** How fractured the rocks are: fissure width, forks, and crystals pushing
   *  out of the crack. 0 is plain stone. Only matters with `rockDensity`. */
  rockVeins: { type: 'number', default: 0.7, min: 0, max: 1, ease: 'step' },
  geodeHomes: { type: 'number', default: 0, min: 0, max: 3, ease: 'step' },
  /** A follow-spot: a beam from the rig and a pool of moving caustics on the
   *  floor that track ONE fish across the scene like a performer on a stage,
   *  while the house lights come down. The value is the fish's slot (0 = first
   *  of the cast); -1 (default) is off. */
  followSpot: { type: 'number', default: -1, min: -1, max: 23, ease: 'step' },
  /** How hard the spot is on, and how far the house lights drop with it. */
  spotStrength: { type: 'number', default: 0.85, min: 0, max: 1, ease: 'smooth' },
  spotColor: { type: 'color', default: '#fff2cf', ease: 'smooth' },
  /** The spotted fish's shadow in its own pool: a fish seen from above, turned
   *  with its heading, larger and softer the higher it swims. 0 = none; 1 = true size. */
  spotShadow: { type: 'number', default: 1, min: 0, max: 2, ease: 'smooth' },
  /** A rig of up to three follow-spots: `slot[/color][*radius]`, comma-separated
   *  (`0/#fff2cf, 1/#ff8ad0, 2/#7fdcff*24`). Overrides `followSpot`/`spotColor`.
   *  The spots are a, b, c in order; their pools add where they cross. */
  spotRig: { type: 'string', default: '', ease: 'step' },
  /** A looping cue sheet for the rig: `8s:a, 8s:b, 12s:a+b, 4s:-` — which spots
   *  are up when (`-` is a blackout). Spots cross-fade at each cue. Empty = all up. */
  spotCues: { type: 'string', default: '', ease: 'step' },
  /** A small scene for the first two or three fish of the cast: a script of
   *  beats in which actors `a b c` go to the space's marks, face each other and
   *  take turns at gestures. A preset name (`tea · bedtime · seek`) or a script:
   *  `a =table, b =door | b >table @a | a @b talk, b @a nod | a b circle rug`.
   *  Words: `=mark` start there · `>mark` go there · `@target` face · `circle X`
   *  · `follow X` · gestures `talk nod shake hop spin wiggle bow peek rest` ·
   *  leading `6s:` sets a beat's length. Marks indoors (`interior: geode`):
   *  rug table bed shelf stove lamp armchair door window chest chandelier;
   *  outdoors: centre left right front back high low. Closed-form and looping;
   *  fish beyond the actors swim as usual. Empty (default) is no vignette. */
  vignette: { type: 'string', default: '', ease: 'step' },
  /** `geode` sets the whole scene INSIDE a geode home: a crystal-lined dome
   *  with agate strata, a plank floor and rug, and the inhabitants' voxel
   *  furniture, lit by a chandelier, a lamp, a stove and a round window. The
   *  fish swim the room. Pairs with the default `void` environment. */
  interior: { type: 'enum', default: 'none', options: ['none', 'geode'], ease: 'step' },
  floraDensity: { type: 'number', default: 0, min: 0, max: 1, ease: 'step' },
  bubbleVents: { type: 'number', default: 0, min: 0, max: 1, ease: 'step' },
  /** `live` puts the vents on a real bubble life: each one grows at the mouth,
   *  lets go, rises, sits at the water surface and pops; a vent coughs and goes
   *  quiet for a minute now and then. `classic` is the looping puffs. */
  bubbleStyle: { type: 'enum', default: 'classic', options: ['classic', 'live'], ease: 'step' },
  /** Oxygen pearls: beads that grow on the flora's leaves over half a minute
   *  or more, sway with the leaf, and let go. Needs `floraDensity`. */
  pearling: { type: 'number', default: 0, min: 0, max: 1, ease: 'step' },
  /** A fine CO₂ mist of tiny bubbles from the vents, drifting on a current. */
  co2Mist: { type: 'number', default: 0, min: 0, max: 1, ease: 'step' },
  marineSnow: { type: 'number', default: 0, min: 0, max: 1, ease: 'step' },
  /** The sky motif: voxel jellyfish lanterns drifting in the water overhead,
   *  pulsing as they rise and sink; a few hang far out as fogged silhouettes.
   *  They take the scene's crystal colours and join the light field. */
  skyLanterns: { type: 'number', default: 0, min: 0, max: 1, ease: 'step' },
  /** How high the flotilla rides: 1 is overhead, ~0.35 brings the lanterns down among the houses. */
  skyHeight: { type: 'number', default: 1, min: 0.25, max: 1.5, ease: 'step' },
  /** The far distance: three hazed rings of silhouettes past the fog line —
   *  rock spires, castle-sized crystals in the scene's colours, and (from 0.4)
   *  one grand geode with its door lit. One draw call, unlit. */
  horizon: { type: 'number', default: 0, min: 0, max: 1, ease: 'step' },
  /** Paths on the sea floor: a walk from every home's door to the village hub,
   *  a road from the hub to the landmark's plaza, and (above 0.5) trails out
   *  to the big crystals. Painted by the floor's shader — no geometry, any
   *  terrain. Adds the vignette mark `hub`. */
  paths: { type: 'number', default: 0, min: 0, max: 1, ease: 'step' },
  /** What paths are made of. `auto` is mostly fish-tank algae, with the odd
   *  stretch of pebbles or pale sand — and some walks change part-way. */
  pathMaterial: { type: 'enum', default: 'auto', options: ['auto', 'algae', 'pebble', 'sand'], ease: 'step' },
  /** The landmark — one thing bigger than everything else. `castle`: voxel
   *  curtain walls, six towers roofed with glowing crystal spires, a lit
   *  gatehouse, a paved road and plaza, and a grand geode for a keep.
   *  `citadel` is the two-storey version: a wider outer ward, and inside it a
   *  raised terrace with its own ring, four taller towers, a stair, the keep on top. */
  landmark: { type: 'enum', default: 'none', options: ['none', 'castle', 'citadel'], ease: 'step' },
  /** Scenery, same DSL family as `fishMix`: `kind[#id][:count][@habit][/palette][*size]`
   *  (`*6` is a tower-sized crystal, planted out past the swim space as skyline).
   *  One kind so far — `crystal`, generated from the seed (nothing is
   *  fetched), habits `lotus · spire · druse · scatter · coral`, palettes `env`
   *  (the room's colours) · `rainbow` · a named colour · `glass`.
   *  `crystal#hero:1@lotus/hotpink, crystal:5@druse`. Empty (default) builds
   *  nothing and draws no rng, so every published scene is unchanged. */
  propMix: { type: 'string', default: '', ease: 'step' },
  /** `on` lets a named environment bring its own crystals when `propMix` is
   *  empty. Off by default: a room never changes on a wall by itself. */
  envProps: { type: 'enum', default: 'off', options: ['off', 'on'], ease: 'step' },
  /** Cluster size multiplier. Rebuilds the layout, so it steps. */
  crystalScale: { type: 'number', default: 1, min: 0.4, max: 2.5, ease: 'step' },
  /** How individual each cluster is. 0 is the measured rosette, perfectly
   *  regular; toward 1 every cluster leans, goes bald on one side, grows
   *  lopsided, varies shard to shard and BRANCHES, the way no two coral heads
   *  match. Rebuilds the layout, so it steps. */
  crystalWild: { type: 'number', default: 0.7, min: 0, max: 1, ease: 'step' },
  /** How much the crystals glow: halo, glow card and the light pools they
   *  throw on the floor. 0 leaves faceted, unlit-looking stone. */
  crystalGlow: { type: 'number', default: 0.8, min: 0, max: 1, ease: 'smooth' },
  /** Slow breathing of that glow (0.12 Hz, ≤15 % — flash-safe at any value). */
  crystalPulse: { type: 'number', default: 0.3, min: 0, max: 1, ease: 'smooth' },
  /** OPT-IN: fish passing a cluster pick up its colour. 0 (default) never
   *  touches a fish material — minted fish look exactly as minted. */
  crystalTint: { type: 'number', default: 0, min: 0, max: 1, ease: 'smooth' },
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
   *  the future farm/pack extension point. **webgl only**: the lofi backend
   *  resolves fish icons by numeric id straight from the live IPFS asset set,
   *  never consulting a `FishEntry[]`, so it can't honor a custom catalog —
   *  `createMetaquarium({ backend: 'lofi', catalog })` throws. */
  catalog?: import('./ipfs').FishEntry[];
  /** Renderer. `webgl` (default) is the three.js tank. `lofi` is the Apple
   *  TV's 2D aquarium — transparent-icon fish, kelp and bubbles on a Canvas2D,
   *  never loading three.js — for QA against the TV and for nostalgia. A host
   *  choice, not a scene param: the same channel publishes either way. */
  backend?: 'webgl' | 'lofi';
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
export { parseSpotRig, parseSpotCues, spotLevels, MAX_SPOTS, type SpotSpec, type SpotSheet } from './spots';
export { PARAM_DOCS, RECIPES, GRAMMAR, recipe, recipeTrack, validateMetaquariumParams, type Recipe, type ParamProblem } from './guide';
export { parseVignette, resolveVignette, VIGNETTES, VIGNETTE_CUES, INTERIOR_MARKS, OPEN_MARKS, GESTURES, type Vignette, type Marks } from './vignette';
export {
  parsePropMix, CRYSTAL_HABITS, CRYSTAL_PALETTES, ENV_PROP_MIX, MAX_CLUSTERS,
  type PropMixEntry, type PropMixResult, type CrystalHabit,
} from './crystals';
export * from './swim';
