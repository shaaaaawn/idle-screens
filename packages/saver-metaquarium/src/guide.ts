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
 *   GRAMMAR      the small DSLs (fishMix, propMix, floraMix, floraPalette, geodeMix, geodeMineral, spotRig, spotCues, vignette).
 *   validateMetaquariumParams   every DSL parser at once, for publish advisories.
 *   recipeTrack  a recipe as the control track `publishScene` takes.
 */

import { parsePropMix } from './crystals';
import { parseFloraMix, parseFloraPalette } from './flora-mix';
import { parseGeodeMineral, parseGeodeMix } from './geode-mix';
import { parseFishMix } from './ipfs';
import { parseSpotCues, parseSpotRig } from './spots';
import { INTERIOR_MARKS, OPEN_MARKS, parseVignette, resolveVignette, VIGNETTE_CUES } from './vignette';

type Value = string | number | boolean;

export const PARAM_DOCS: Readonly<Record<string, string>> = {
  // camera
  cameraAzimuth: 'Orbit bearing in degrees. 0 looks at the village from the front.',
  cameraElevation: 'Degrees above the floor. 8–15 is eye level with the fish; 40+ looks down on a castle.',
  cameraDistance: 'Distance from the tank centre. 80 is a close-up, 170–220 a village, 300+ a landmark.',
  shot: 'A named framing to cut to: `orbit` (default), `hero` (three-quarter establishing), `front` (level, long lens), `low` (among the plants looking up), `top` (steep, the floor as a map), `surface` (looking up at the water\'s underside), `macro` (close on the landmark nearest the front). Azimuth and autoRotate turn it; distance scales it.',
  cameraFollow: 'Ride with one fish (cast slot, 0 = first); -1 is the orbit camera. Orbit params are ignored while following. Pair with `followSpot` on the same slot for a spotlit chase.',
  followAngle: 'Where round the followed fish the chase camera stands, degrees: 0 behind (default), 90 beside, 180 in front looking back at its face.',
  followDistance: 'How far behind the followed fish the camera rides, along its own path (40–70 a chase). Under ~18 it is the fish\'s eye and the fish is hidden.',
  autoRotate: 'Turntable speed, degrees/second. 0 holds the shot (stages, vignettes); 1–2 is a slow reveal.',
  // cast
  fishCount: 'How many fish when `fishMix` is empty (all are `fishUrl`).',
  finish: 'A final full-screen pass: gentle grade, soft vignette, dither against banding, and restrained bloom on high-end devices (0 = none; never on the low tier).',
  fishUrl: 'The single model used when `fishMix` is empty. ipfs:// or https.',
  fishMix: 'The cast: `id[:count][@style]`, comma-separated. `100:2@drift, 257:1, seahorse:3, shark:1@patrol`. Minted breeds plus bundled creatures (shark crab dori glowfish babyfish hackerfish blowfish starfish). A hackerfish\'s face is a screen (faces, code rain, crash and reboot); a glowfish fishes with its lure. A crab walks the seabed on its own legs at its own pace (swimSpeed does not hurry it), climbs the rocks, and stops to forage, pinch, wave and cheer. A starfish crawls the floor too, walks some of the way upright on its front arms, and stops to curl up, wave, or stand facing you; with `starfishDance` it dances. Overrides fishCount/fishUrl.',
  dracoPath: 'Where the Draco decoder lives; leave empty on a channel.',
  swimSpeed: 'Global swim speed multiplier. 0.4 is contemplative, 1 lively.',
  swimStyle: 'How the cast swims unless a fishMix entry says otherwise (`@style`). `auto` picks by breed.',
  pathShape: 'The shape of free-swimming paths.',
  formationShape: 'The figure a `school` holds.',
  swimVariance: 'How differently individual fish swim from one another (speed, phase).',
  fishSize: 'Every fish bigger or smaller, over each breed\'s own size (a shark is 2.2× a minted fish, a babyfish 0.45×).',
  sizeVariance: 'How much fish of one breed differ in size: 0 all alike, 1 from about half to nearly double.',
  maneuver: 'Which set-piece moves the cast may break into.',
  maneuverRate: 'How often maneuvers happen.',
  maneuverIntensity: 'How big they are.',
  bodyWiggle: 'Body yaw while swimming, for models without an animation clip. A fish the swim wave bends (`swimWave` > 0) ignores it.',
  lightSeek: 'How much fish are drawn toward light sources.',
  formationBreathe: 'How much a formation swells and tightens.',
  shoal: 'An ambient school of small fish swimming as one body beside the cast; the odd one wanders out and back (0 = none). Up to 2.5× the device\'s fish cap.',
  shoalKind: 'Who the school is: `neon` (blue line, red rear), `rummynose` (red face, barred tail) or `ember` (orange).',
  shoalSpeed: 'How fast the school travels (0.3–2, default 0.8), independent of `swimSpeed`. It swims above the plants, across the front of the shot unless the camera orbits.',
  // look
  fishLighting: '`lit` (default) lights fish with a studio rig and their own glow parts; `flat` is the unlit original.',
  fishAmbient: 'The water\'s light on the fish in lit mode: the sunlit water on their backs, the water around on their flanks, the floor under their bellies, mirrored in metal plates. Fixes fish reading dark; 0.6–1 in bright tanks. Dims with a follow-spot\'s house lights.',
  fishGlow: 'How strongly GLOW- parts of a fish bloom and light their neighbours and the floor.',
  fishMetal: '`on` (default) gives METAL- parts a polished, reflective finish.',
  starfishDance: 'Starfish dance (formation-style starfish keep their formation): `aerobics` stands every starfish up in a class facing the camera (an instructor in front) dancing a routine in unison — march, jacks, reaches, kicks, twists, arm circles, disco, a spin; `freestyle`, each its own move every eight counts; `duet`, the partner dance (Dirty Dancing): couples face to face — the basic, a sway, a twirl, the dip, and the lift — best with `spotRig: 0/#ffd27a*26, 1/#ff8ad0*26`. Cast a few: `fishMix: starfish:7`. Best with `shot: front`, `autoRotate: 0`, a bright room. `off` (default): they crawl, walk upright and wave on their own.',
  danceTempo: 'Beats per minute for the starfish dance (60–180, default 128). Glides on the beat.',
  fishLook: '`neon` dresses the bundled creatures (crab, glowfish, shark…) for blacklight: near-black coats, eyes and a crab\'s mouth glowing a neon of their own. Best in a dark room (abyss, void) with `finish`. `natural` is the default.',
  swimWave: 'Fish bend as they swim: a wave runs nose to tail and the body curls into turns (0 = rigid wiggle). Skips the turtle, crab and fish that already have a skeleton; the seahorse gets its own motion instead — fin, tail and nod.',
  eyeLife: 'Eyes blink, look, and emote (0 = painted on). Redraws each token\'s own pixel-grid eye; black and white only.',
  // water and room
  fogColor: 'The water colour; also the background. Dark blues and purples make light sources read.',
  fogNear: 'Where fog starts.',
  fogFar: 'Where everything has dissolved into the water. Raise to 700–1000 for castles and horizons.',
  floorColor: 'Sea-floor colour.',
  water: 'Water instead of fog: red fades with distance first, then green, blue last — a red fish goes blue-green before it goes into the murk. 0.6–1 for most scenes; 0 is plain fog.',
  waterClarity: 'With `water` on: 0 murky (colour lost fast, short reach), 0.5 as before, 1 clear (colour kept, reach ×1.5). Bright tanks want 0.7–1.',
  waterTint: 'The sunlit water, `#rrggbb`: distant things fade into it looking up, half of it on the level, none looking down, and the background becomes that gradient. Empty = off; with `water` on, reef, kelp, ice and lagoon bring their own.',
  dither: '`on` adds an invisible dither that removes colour banding in dark fogged gradients on TVs. Recommended with `water`; `off` (default) is byte-exact with older scenes.',
  moteDensity: 'Suspended motes.',
  moteColor: 'Their colour.',
  environment: 'A room preset (floor, ceiling, light shafts). `void` for the mineral-world scenes.',
  floorKind: 'Floor shape: `auto` follows the environment, `flat` is level, or terrain: `dunes`, `ridges`, `basin`; `shelf` (the town raised on a plateau with a terraced lip), `trench` (a meandering channel across the front, deep enough to hide in), `terraces` (tiers stepping up behind the town).',
  waterY: 'Height of the water ceiling; -1 = the environment\'s own.',
  rayStrength: 'Light shafts from the surface.',
  caustics: 'The dancing net of light from the surface on the floor, rocks, plants and fish (0 = none). Sharp near the top, soft and dim deep down.',
  causticScale: 'Size of the caustic cells: below 1 a fine shimmer, above 1 broad slow bands.',
  surfaceMirror: 'The surface from below: a window up to the light and a rippling mirror of the tank around it (0 = the plain sheet). Needs reef, kelp, ice or lagoon; pays off on the `surface` and `low` shots. High tier reflects the real tank, mid tier the deep water.',
  // world
  propMix: 'Crystals: `crystal[:count][@habit][/palette][*size]`. Habits lotus·spire·druse·scatter·coral; palettes env·rainbow or a colour (blue hotpink purple seafoam yellow orange cyan white glass); `*6` is tower-sized. `crystal:3@druse/rainbow`.',
  envProps: '`on` lets the environment preset plant its own crystals when `propMix` is empty.',
  crystalScale: 'Size of the whole mineral world (crystals, rocks, homes, flora).',
  crystalWild: 'Organic individuality: lean, bald sides, branching. 0 is a catalogue crystal, 1 is coral.',
  crystalGlow: 'How much crystals glow and pool light on the floor.',
  crystalPulse: 'Slow breathing of that light (0.12 Hz, ≤15 % — flash-safe).',
  crystalTint: 'How much nearby light sources colour a passing fish. 0.5–0.7 ties the cast to the place.',
  rockDensity: 'Faceted boulders, an arch and a back ridge around the crystals.',
  rockVeins: 'Crystals bursting out of the rocks: each crown broken open, chips on the rim, a colony of the same crystal growing from the breach. 0 is plain stone.',
  geodeHomes: 'Geode houses (0–3) in a crescent: a village. Their doors are vignette marks `home1`…, `home1in`….',
  interior: '`geode` sets the whole scene INSIDE a geode home: furniture, chandelier, marks like `table`, `bed`, `door`.',
  floraDensity: 'Voxel plants around each crystal, swaying, lit and shedding spores. What grows is `floraMix`; with it empty the room picks (coral on a reef, kelp in the kelp forest, glow caps in the abyss).',
  geodes: 'Wild geodes about the floor (0 = none): split geodes (one in three a thunder egg), amethyst cathedrals, crystal clusters, one mega cavern geode. They follow the world\'s rules — slate crust lit by the same key as the rocks, crystals that glow and pulse like the crystals (crystalGlow, crystalPulse), the mineral of the crystal nearest them, the crystals\' light on their stone — and flora grows round them as round a crystal. Agate banding is drawn per pixel; one in twenty is an iridescent aura morph; their crystals wake when a fish comes close.',
  geodeMix: 'Which geodes: `kind[:weight]`, comma-separated. geode cathedral cluster cavern (the cavern is one at most).',
  geodeMineral: 'What they are made of: amethyst agate celestine citrine carnelian rose emerald quartz smoky. Empty = the mineral nearest in colour to the crystal nearest each geode (it belongs to its world, as flora and homes do); `world` = two from the seed; or a list.',
  fountain: 'The town square\'s fountain where the paths meet: `vent` (a hot-vent chimney crusted with crystal, glowing at the mouth) or `geode` (a great geode basin on a plinth). A bubble column, a pebble plaza, a light of its own, and a vignette mark `fountain`.',
  streetLamps: 'Crystal streetlamps along the paths (0 = none, 1 = about 24): slate posts with a crystal crown in their nearest crystal\'s colour, a halo and light on the floor. Needs paths.',
  geodeLayout: '`field` (default) scatters them; `gallery` is a lineup to examine them all — a row per kind (aura morphs, thunder eggs, hollow geodes, clusters, cathedrals), a column per mineral, the mega geode behind. Frame it with cameraDistance 400, elevation ~26, and nothing else in the scene.',
  floraLayout: '`garden` (default) grows the plants round the crystals; `gallery` plants one of each species in its own plot, in two rows across the front (low ones before tall), so every kind can be seen at once. With `floraMix` set, only the species it names. Frame it with `shot: front` or `cameraDistance` ~260.',
  floraPalette: 'One colour scheme for the garden, the way a No Man\'s Sky planet is magenta grass and orange trees: `world` grows a hero hue, a neighbour and an accent from the seed; or give up to six `#rrggbb`. Each colony is pulled most of the way to one of them. Empty = every species its own colours.',
  floraMix: 'Which plants: `species[:weight]`, comma-separated. grass tube bulb fan kelp anemone staghorn brain whip barrel shelf seapen clam bubble elder curl pod (a giant clam is a specimen, two at most; the elder, a blossom tree hung with lanterns, one). Plants grow in colonies that share a colour; about one colony in thirty is a rare nacreous morph. `kelp:3, whip, seapen` is a kelp forest; `staghorn:2, brain, anemone:2, clam` a reef. Empty = the room\'s own garden. Needs floraDensity > 0.',
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
fishMix   id[:count][@style][*size], …        100:2@drift, 257:1, seahorse:3, shark:1@patrol*1.5
          id = a minted token (1–512) or a breed (betafish angelfish seahorse seaturtle). Minted fish are
          individuals: a count casts DISTINCT neighbours. Bundled creatures (a count is copies): shark
          crab dori glowfish babyfish hackerfish blowfish starfish. *size scales that token over its
          breed's own size. Styles: loop school drift hover patrol bottom surface follow pair chase.
propMix   crystal[#id][:count][@habit][/palette][*size], …      crystal:3@druse/rainbow, crystal:1@spire/cyan*6
          habits lotus spire druse scatter coral · palettes env rainbow blue hotpink purple seafoam yellow orange cyan white glass
floraMix  species[:weight], …                              kelp:3, whip, seapen · staghorn:2, brain, anemone:2, clam
          grass tube bulb fan kelp anemone staghorn brain whip barrel shelf seapen clam bubble elder curl pod (empty = the room's garden)
geodeMix  kind[:weight], …   geode cathedral cluster cavern                          geode:3, cathedral, cluster
geodeMineral  world | mineral, …   amethyst agate celestine citrine carnelian rose emerald quartz smoky
floraPalette  world | #rrggbb, …  (≤6)                          world · #ff4fa0, #ffb347, #4fd1ff
spotRig   slot[/color][*radius], …  (≤3; they become a, b, c)   0/#ffd27a*24, 1/#ff8ad0*24, 2/#7fdcff*24
spotCues  <sec>s:<spots>, …  loops                               4s:-, 7s:a, 7s:b, 12s:a+b
vignette  beats separated by |, cues by comma; actors a b c are fish slots 0 1 2
          [<sec>s:] actor =mark       start there           actor >mark       swim there
          actor @mark | @actor        face it               a b circle mark   circle it together
          actor follow actor                                gestures: talk nod shake hop spin wiggle rest peek bow
          Give every beat a duration and end where you began and a spotCues sheet stays in step forever.
          Marks outdoors: ${Object.keys(OPEN_MARKS).join(' ')} — plus the world's own:
          home1 home1in … (geodeHomes), gate plaza courtyard (landmark), hub (paths), fountain (fountain).
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
  if (str('floraMix')) push('floraMix', parseFloraMix(str('floraMix')).problems);
  if (str('floraPalette')) push('floraPalette', parseFloraPalette(str('floraPalette')).problems);
  if (str('geodeMix')) push('geodeMix', parseGeodeMix(str('geodeMix')).problems);
  if (str('geodeMineral')) push('geodeMineral', parseGeodeMineral(str('geodeMineral')).problems);
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
    if (params.fountain === 'vent' || params.fountain === 'geode') world.fountain = at;
    push('vignette', parseVignette(resolveVignette(str('vignette')), indoors ? INTERIOR_MARKS : { ...OPEN_MARKS, ...world }).problems);
  }
  return out;
}
