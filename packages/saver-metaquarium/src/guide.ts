/**
 * What an AGENT needs to author a metaquarium scene, as data. Zero-dep, and
 * exported through `./manifest`, so the server can put it in front of an MCP
 * client without three.js — `listSavers` already carries every param's type
 * and range, but a name and a range do not say what `spotCues` is or that a
 * village wants `geodeHomes: 3`.
 *
 *   PARAM_DOCS   one line per param. A test holds it to the param space, so a
 *                new param cannot ship undocumented.
 *   RECIPES      named scenes. The playground mounts every one of them as-is
 *                (its "recipes" shelf), so what an agent can publish is what a
 *                person can look at. Channel-safe: minted ids, no local paths.
 *   GRAMMAR      the small DSLs (fishMix, propMix, spotRig, spotCues, vignette).
 *   validateMetaquariumParams   every DSL parser at once, for publish advisories.
 *   recipeTrack  a recipe as the control track `publishScene` takes.
 */

import { parsePropMix } from './crystals';
import { parseFishMix } from './ipfs';
import { parseSpotCues, parseSpotRig } from './spots';
import { INTERIOR_MARKS, OPEN_MARKS, parseVignette, resolveVignette, VIGNETTE_CUES } from './vignette';

type Value = string | number | boolean;

export const PARAM_DOCS: Readonly<Record<string, string>> = {
  // camera
  cameraAzimuth: 'Orbit bearing in degrees. 0 looks at the village from the front.',
  cameraElevation: 'Degrees above the floor. 8–15 is eye level with the fish; 40+ looks down on a castle.',
  cameraDistance: 'Distance from the tank centre. 80 is a close-up, 170–220 a village, 300+ a landmark.',
  autoRotate: 'Turntable speed, degrees/second. 0 holds the shot (stages, vignettes); 1–2 is a slow reveal.',
  // cast
  fishCount: 'How many fish when `fishMix` is empty (all are `fishUrl`).',
  fishUrl: 'The single model used when `fishMix` is empty. ipfs:// or https.',
  fishMix: 'The cast: `id[:count][@style]`, comma-separated. `100:2@drift, 257:1, seahorse:3`. Overrides fishCount/fishUrl.',
  dracoPath: 'Where the Draco decoder lives; leave empty on a channel.',
  swimSpeed: 'Global swim speed multiplier. 0.4 is contemplative, 1 lively.',
  swimStyle: 'How the cast swims unless a fishMix entry says otherwise (`@style`). `auto` picks by breed.',
  pathShape: 'The shape of free-swimming paths.',
  formationShape: 'The figure a `school` holds.',
  swimVariance: 'How differently individual fish swim from one another.',
  maneuver: 'Which set-piece moves the cast may break into.',
  maneuverRate: 'How often maneuvers happen.',
  maneuverIntensity: 'How big they are.',
  bodyWiggle: 'Body yaw while swimming, for models without an animation clip. A fish the swim wave bends (`swimWave` > 0) ignores it.',
  lightSeek: 'How much fish are drawn toward light sources.',
  formationBreathe: 'How much a formation swells and tightens.',
  shoal: 'An ambient school of small fish swimming as one body beside the cast; the odd one wanders out and back (0 = none). Up to 2.5× the device\'s fish cap.',
  shoalKind: 'Who the school is: `neon` (blue line, red rear), `rummynose` (red face, barred tail) or `ember` (orange).',
  // look
  fishLighting: '`lit` (default) lights fish with a studio rig and their own glow parts; `flat` is the unlit original.',
  fishGlow: 'How strongly GLOW- parts of a fish bloom and light their neighbours and the floor.',
  fishMetal: '`on` (default) gives METAL- parts a polished, reflective finish.',
  swimWave: 'Fish bend as they swim: a wave runs nose to tail and the body curls into turns (0 = rigid wiggle). Skips the turtle, seahorse, crab, jellies and fish that already have a skeleton.',
  eyeLife: 'Eyes blink, look, and emote (0 = painted on). Redraws each token\'s own pixel-grid eye; black and white only.',
  // water and room
  fogColor: 'The water colour; also the background. Dark blues and purples make light sources read.',
  fogNear: 'Where fog starts.',
  fogFar: 'Where everything has dissolved into the water. Raise to 700–1000 for castles and horizons.',
  floorColor: 'Sea-floor colour.',
  water: 'Water instead of fog: red fades with distance first, then green, blue last — a red fish goes blue-green before it goes into the murk. 0.6–1 for most scenes; 0 is plain fog.',
  dither: '`on` adds an invisible dither that removes colour banding in dark fogged gradients on TVs. Recommended with `water`; `off` (default) is byte-exact with older scenes.',
  moteDensity: 'Suspended motes.',
  moteColor: 'Their colour.',
  environment: 'A room preset (floor, ceiling, light shafts). `void` for the mineral-world scenes.',
  floorKind: 'Flat floor or terrain.',
  waterY: 'Height of the water ceiling; -1 = the environment\'s own.',
  rayStrength: 'Light shafts from the surface.',
  caustics: 'The dancing net of light from the surface on the floor, rocks, plants and fish (0 = none). Sharp near the top, soft and dim deep down.',
  causticScale: 'Size of the caustic cells: below 1 a fine shimmer, above 1 broad slow bands.',
  // world
  propMix: 'Crystals: `crystal[:count][@habit][/palette][*size]`. Habits lotus·spire·druse·scatter·coral; palettes env·rainbow or a colour (blue hotpink purple seafoam yellow orange cyan white glass); `*6` is tower-sized. `crystal:3@druse/rainbow`.',
  envProps: '`on` lets the environment preset plant its own crystals when `propMix` is empty.',
  crystalScale: 'Size of the whole mineral world (crystals, rocks, homes, flora).',
  crystalWild: 'Organic individuality: lean, bald sides, branching. 0 is a catalogue crystal, 1 is coral.',
  crystalGlow: 'How much crystals glow and pool light on the floor.',
  crystalPulse: 'Slow breathing of that light (0.12 Hz, ≤15 % — flash-safe).',
  crystalTint: 'How much nearby light sources colour a passing fish. 0.5–0.7 ties the cast to the place.',
  rockDensity: 'Faceted boulders, an arch and a back ridge around the crystals.',
  rockVeins: 'Glowing fissures in the rock, like lava or a creek down a mountainside.',
  geodeHomes: 'Geode houses (0–3) in a crescent: a village. Their doors are vignette marks `home1`…, `home1in`….',
  interior: '`geode` sets the whole scene INSIDE a geode home: furniture, chandelier, marks like `table`, `bed`, `door`.',
  floraDensity: 'Voxel plants around each crystal: grass, tube anemones, bulbs, sea fans, kelp — swaying, lit, shedding spores.',
  bubbleVents: 'Bubbles from chimneys, fissures and crystals.',
  bubbleStyle: 'How vent bubbles live: `classic` loops puffs; `live` grows each bubble at the vent, lets it go, rises it to the water surface (if the environment has one) and pops it, and rests a vent for a minute now and then. Distant bubbles dim instead of fattening.',
  pearling: 'Oxygen pearls on the plants: beads grow on the leaves over half a minute or more, sway with them and let go (0 = none). Needs floraDensity > 0; with no flora there is nothing to pearl on.',
  co2Mist: 'A fine haze of tiny bubbles from the vents, drifting on a slow current (0 = none).',
  marineSnow: 'Drifting lit particles; gives the water depth.',
  skyLanterns: 'The sky motif: voxel jellyfish lanterns overhead (three species), pulsing, lighting what is under them.',
  skyHeight: 'How high the lanterns ride. 1 overhead; ~0.3 brings them down among the houses.',
  horizon: 'The far distance: hazed rings of rock spires and castle-sized crystals past the fog line (and, from 0.4 with no landmark, a grand geode).',
  paths: 'Walks painted on the floor: every home door → a village hub → the landmark plaza; above 0.5, trails to the crystals. Adds the mark `hub`.',
  pathMaterial: '`auto` is mostly fish-tank algae green with the odd stretch of `pebble` or `sand`; or force one.',
  landmark: 'One thing bigger than everything else. `castle`: voxel walls, crystal-spired towers, gate, road, plaza. `citadel`: two storeys. Marks: `gate`, `plaza`, `courtyard`.',
  // stage
  followSpot: 'A follow-spot on one fish slot (0 = first of the cast); -1 off. House lights drop with it.',
  spotStrength: 'How hard the spots are on and how far the house lights fall.',
  spotColor: 'Colour of the single `followSpot`.',
  spotShadow: 'The spotted fish\'s shadow in its pool. 0 none, 1 true size.',
  spotRig: 'Up to three spots: `slot[/color][*radius]`. `0/#ff8ad0*26, 1/#7fdcff`. They are a, b, c in order. Overrides followSpot.',
  spotCues: 'A looping cue sheet for the rig: `8s:a, 8s:b, 12s:a+b, 4s:-` (`-` = blackout). Spots cross-fade at each cue.',
  vignette: 'A small scene for the first 2–3 fish: a preset (tea·bedtime·seek indoors; duet·trio on the open stage) or a script of beats.',
};

export const GRAMMAR = `
fishMix   id[:count][@style], …        100:2@drift, 257:1, seahorse:3
          id = a minted token (1–512) or a breed (betafish angelfish seahorse seaturtle). Minted fish are
          individuals: a count casts DISTINCT neighbours. Styles: loop school drift hover patrol bottom
          surface follow pair chase.
propMix   crystal[#id][:count][@habit][/palette][*size], …      crystal:3@druse/rainbow, crystal:1@spire/cyan*6
          habits lotus spire druse scatter coral · palettes env rainbow blue hotpink purple seafoam yellow orange cyan white glass
spotRig   slot[/color][*radius], …  (≤3; they become a, b, c)   0/#ffd27a*24, 1/#ff8ad0*24, 2/#7fdcff*24
spotCues  <sec>s:<spots>, …  loops                               4s:-, 7s:a, 7s:b, 12s:a+b
vignette  beats separated by |, cues by comma; actors a b c are fish slots 0 1 2
          [<sec>s:] actor =mark       start there           actor >mark       swim there
          actor @mark | @actor        face it               a b circle mark   circle it together
          actor follow actor                                gestures: talk nod shake hop spin wiggle rest peek bow
          Give every beat a duration and end where you began and a spotCues sheet stays in step forever.
          Marks outdoors: ${Object.keys(OPEN_MARKS).join(' ')} — plus the world's own:
          home1 home1in … (geodeHomes), gate plaza courtyard (landmark).
          Marks indoors (interior: geode): ${Object.keys(INTERIOR_MARKS).join(' ')}
`.trim();

export interface Recipe {
  id: string;
  label: string;
  /** What it is for — the sentence an agent chooses by. */
  what: string;
  params: Readonly<Record<string, Value>>;
}

const NIGHT = { fogColor: '#0a0a1a', fogNear: 120, fogFar: 700 } as const;
const STAGE = { fogColor: '#01030a', floorColor: '#0a1322', fogNear: 120, fogFar: 650, autoRotate: 0 } as const;
/** Every recipe is close enough to see a face: eyes alive (an opt-in, like every look param). */
const ALIVE = { eyeLife: 1 } as const;

export const RECIPES: readonly Recipe[] = [
  {
    id: 'geode-harbor', label: 'Geode harbor', what: 'A village at night: three geode homes, chimneys bubbling, lanterns overhead, a far horizon.',
    params: { ...ALIVE, ...NIGHT, floorColor: '#2a1a2a', paths: 0.7, geodeHomes: 3, rockDensity: 0.35, rockVeins: 0.6, floraDensity: 0.25, bubbleVents: 0.9, marineSnow: 0.45, skyLanterns: 0.8, horizon: 1,
      propMix: 'crystal:2@spire/orange,crystal:2@druse/hotpink,crystal:1@lotus/purple', crystalTint: 0.6, fishMix: '100:2,257:2,seahorse:2', swimStyle: 'drift', swimSpeed: 0.5,
      cameraDistance: 190, cameraElevation: 12, cameraAzimuth: 0, autoRotate: 1 },
  },
  {
    id: 'moonlit-grove', label: 'Moonlit grove', what: 'A garden: dense swaying flora in green light, one home, lanterns thick overhead.',
    params: { ...ALIVE, fogColor: '#041410', floorColor: '#16402e', fogNear: 120, fogFar: 700, paths: 0.6, floraDensity: 1, rockDensity: 0.3, rockVeins: 0.5, geodeHomes: 1, bubbleVents: 0.3, marineSnow: 0.85, skyLanterns: 1, horizon: 1,
      propMix: 'crystal:3@spire/seafoam,crystal:1@lotus/yellow,crystal:1@druse/cyan', crystalWild: 0.8, crystalTint: 0.6, fishMix: '100:2,257:3', swimStyle: 'drift', swimSpeed: 0.5,
      cameraDistance: 170, cameraElevation: 10, cameraAzimuth: 0, autoRotate: 1 },
  },
  {
    id: 'castle', label: 'The castle', what: 'The landmark: voxel walls and crystal-spired towers, a lit gate, a road to a plaza. Orbit it.',
    params: { ...ALIVE, fogColor: '#060818', floorColor: '#101830', fogNear: 160, fogFar: 900, landmark: 'castle', horizon: 0.8, skyLanterns: 0.5, floraDensity: 0.3, bubbleVents: 0.4,
      propMix: 'crystal:2@spire/cyan,crystal:2@druse/purple,crystal:1@lotus/hotpink', crystalTint: 0.6, fishMix: '100:3,257:2', swimStyle: 'drift', swimSpeed: 0.5,
      cameraDistance: 300, cameraElevation: 14, cameraAzimuth: 12, autoRotate: 1.5 },
  },
  {
    id: 'citadel', label: 'The citadel', what: 'The two-storey castle: an upper ward on a terrace, taller towers, a stair. Wants a high, far camera.',
    params: { ...ALIVE, fogColor: '#060818', floorColor: '#101830', fogNear: 180, fogFar: 1000, landmark: 'citadel', horizon: 0.8, skyLanterns: 0.5, floraDensity: 0.3, bubbleVents: 0.4,
      propMix: 'crystal:2@spire/cyan,crystal:2@druse/purple,crystal:1@lotus/hotpink', crystalTint: 0.6, fishMix: '100:3,257:2', swimStyle: 'drift', swimSpeed: 0.5,
      cameraDistance: 340, cameraElevation: 20, cameraAzimuth: 14, autoRotate: 1.5 },
  },
  {
    id: 'commute', label: 'Going home', what: 'Three neighbours leave their own front doors, meet in the village, and go home again. Loops.',
    params: { ...ALIVE, ...NIGHT, floorColor: '#2a1a2a', paths: 0.5, geodeHomes: 3, rockDensity: 0.3, rockVeins: 0.6, floraDensity: 0.12, bubbleVents: 0.7, marineSnow: 0.4, skyLanterns: 0.6, horizon: 0.8,
      propMix: 'crystal:3@druse/rainbow', crystalTint: 0.6, fishMix: '100:2,257:1', fishGlow: 0.5,
      vignette: '4s: a =home1in, b =home2in, c =home3in | 6s: a >home1 peek | 7s: a >centre, b >home2 | 7s: b >centre @a, a @b | 6s: a @b talk, b @a nod | 7s: c >home3 hop, a @c, b @c | 8s: c >centre | 9s: a b c circle centre | 6s: a @b bow, b @c bow, c @a bow | 7s: a >home1, b >home2, c >home3 | 6s: a >home1in, b >home2in, c >home3in | 5s: a rest, b rest, c rest',
      cameraDistance: 135, cameraElevation: 9, cameraAzimuth: 4, autoRotate: 0 },
  },
  {
    id: 'stage-duet', label: 'Duet, two spots', what: 'A dark stage: a solo, the other solo, then they meet and the pink and cyan pools cross into white.',
    params: { ...ALIVE, ...STAGE, vignette: 'duet', spotRig: '0/#ff8ad0*26, 1/#7fdcff*26', spotCues: VIGNETTE_CUES.duet!, spotStrength: 0.95,
      fishMix: '100:1,257:1', fishGlow: 0.5, bodyWiggle: 0.3, marineSnow: 0.5, bubbleVents: 0.3, cameraDistance: 170, cameraElevation: 12, cameraAzimuth: 0 },
  },
  {
    id: 'stage-trio', label: 'Trio, three spots', what: 'Three solos, two pairings, the full company, a last word alone, blackout.',
    params: { ...ALIVE, ...STAGE, vignette: 'trio', spotRig: '0/#ffd27a*24, 1/#ff8ad0*24, 2/#7fdcff*24', spotCues: VIGNETTE_CUES.trio!, spotStrength: 0.95,
      fishMix: '100:2,257:1', fishGlow: 0.5, bodyWiggle: 0.3, marineSnow: 0.5, cameraDistance: 185, cameraElevation: 13, cameraAzimuth: 0 },
  },
  {
    id: 'follow-spot', label: 'Follow-spot', what: 'One performer crosses a dark stage in a beam, its shadow in the pool under it.',
    params: { ...ALIVE, ...STAGE, followSpot: 0, spotStrength: 0.9, fishMix: '257:1@patrol,100:4@drift', swimSpeed: 0.6, swimVariance: 0.4, bodyWiggle: 0.3, pathShape: 'crossing', fishGlow: 0.5, marineSnow: 0.5,
      cameraDistance: 190, cameraElevation: 14, cameraAzimuth: 0 },
  },
  {
    id: 'tea', label: 'Tea, indoors', what: 'Inside a geode home: a friend calls round for tea. Two fish, an intimate room.',
    params: { ...ALIVE, interior: 'geode', vignette: 'tea', fishMix: '100:1,257:1', bubbleVents: 0.5, crystalTint: 0.7, bodyWiggle: 0.25, cameraDistance: 118, cameraElevation: 14, cameraAzimuth: 300, autoRotate: 0 },
  },
  {
    id: 'jellyfish', label: 'Among the lanterns', what: 'The jellyfish flotilla brought down to eye level over a few crystals.',
    params: { ...ALIVE, fogColor: '#04081a', floorColor: '#0c1428', fogNear: 160, fogFar: 800, skyLanterns: 1, skyHeight: 0.3, marineSnow: 0.4, crystalScale: 0.7,
      propMix: 'crystal:1@lotus/hotpink,crystal:1@druse/cyan,crystal:1@spire/yellow,crystal:1@druse/purple', fishMix: '100:1,257:1', swimStyle: 'drift', swimSpeed: 0.4,
      cameraDistance: 120, cameraElevation: 6, cameraAzimuth: 0, autoRotate: 1 },
  },
];

export const recipe = (id: string): Recipe | undefined => RECIPES.find((r) => r.id === id);

/** A recipe (or any param set) as the control track `publishScene` takes: every value at t = 0. */
export function recipeTrack(params: Readonly<Record<string, Value>>, seed = 0):
  { program: string; seed: number; deltas: { t: number; path: string; value: Value }[] } {
  return { program: 'metaquarium', seed, deltas: Object.entries(params).map(([path, value]) => ({ t: 0, path, value })) };
}

export interface ParamProblem { path: string; message: string }

/** Every DSL parser at once. Never throws; an empty list means the strings are sound. */
export function validateMetaquariumParams(params: Readonly<Record<string, unknown>>): ParamProblem[] {
  const out: ParamProblem[] = [];
  const str = (k: string): string => (typeof params[k] === 'string' ? (params[k] as string).trim() : '');
  const push = (path: string, problems: readonly string[]): void => { for (const message of problems) out.push({ path, message }); };
  if (str('fishMix')) push('fishMix', parseFishMix(str('fishMix')).problems);
  if (str('propMix')) push('propMix', parsePropMix(str('propMix')).problems);
  const rig = parseSpotRig(str('spotRig'));
  push('spotRig', rig.problems);
  if (str('spotCues')) {
    const spots = rig.spots.length || (Number(params.followSpot ?? -1) >= 0 ? 1 : 0);
    if (!spots) out.push({ path: 'spotCues', message: 'a cue sheet needs a spotRig (or followSpot) to cue' });
    else push('spotCues', parseSpotCues(str('spotCues'), spots).problems);
  }
  if (str('vignette')) {
    const indoors = params.interior === 'geode';
    const homes = Math.round(Number(params.geodeHomes ?? 0));
    const world: Record<string, { x: number; y: number; z: number }> = {};
    const at = { x: 0, y: 0, z: 0 };
    for (let i = 1; i <= Math.min(3, homes); i++) { world[`home${i}`] = at; world[`home${i}in`] = at; }
    if (params.landmark === 'castle' || params.landmark === 'citadel') for (const m of ['gate', 'plaza', 'courtyard']) world[m] = at;
    // Paths meet at a hub: the mark `paths` documents itself as adding.
    if (Number(params.paths ?? 0) > 0) world.hub = at;
    push('vignette', parseVignette(resolveVignette(str('vignette')), indoors ? INTERIOR_MARKS : { ...OPEN_MARKS, ...world }).problems);
  }
  return out;
}
