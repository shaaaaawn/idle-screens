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
 *   validateMetaquariumParams   every DSL parser at once, plus the params another
 *                one silently overrides or needs, for publish advisories.
 *   recipeTrack  a recipe as the control track `publishScene` takes.
 */

import { parsePropMix } from './crystals';
import { parseFloraMix, parseFloraPalette } from './flora-mix';
import { parseGeodeMineral, parseGeodeMix } from './geode-mix';
import { expandFishMixSlots, parseFishMix } from './ipfs';
import { parsePyramidMix } from './pyramid-mix';
import { parseTownProps } from './town-mix';
import { parseFloorCover } from './floor-cover-mix';
import { parsePyramidShow } from './pyramid-show';
import { parseSignMix } from './sign-mix';
import { parseSpotCues, parseSpotRig } from './spots';
import { BREED_GESTURES, INTERIOR_MARK_POLAR, INTERIOR_MARKS, OPEN_MARKS, parseVignette, resolveVignette, VIGNETTE_CUES } from './vignette';

type Value = string | number | boolean;

export const PARAM_DOCS: Readonly<Record<string, string>> = {
  // camera
  cameraAzimuth: 'Orbit bearing in degrees. 0 looks at the village from the front.',
  cameraElevation: 'Degrees above the floor. 8–15 is eye level with the fish; 40+ looks down on a castle.',
  cameraDistance: 'Distance from the tank centre. 80 is a close-up, 170–220 a village, 300+ a landmark.',
  shot: 'A framing: `orbit` (default), `hero` (three-quarter), `front` (level, long lens), `low` (looking up), `top` (a map), `surface` (the underside), `macro` (nearest landmark), `cast` (the mix\'s first three). Azimuth and autoRotate turn it, distance scales it.',
  shotBlend: 'Seconds a change of `shot` takes (0 = a cut): the camera moves to the new framing, eased.',
  cameraFollow: 'Ride with one fish (cast slot); -1 is the orbit camera, whose params are ignored while following. With `followSpot` on the slot, a spotlit chase.',
  followAngle: 'Where round the followed fish the chase camera stands, degrees: 0 behind (default), 90 beside, 180 in front looking back at its face.',
  followDistance: 'How far behind the followed fish the camera rides (40–70 is a chase). Under ~18 it is the fish\'s eye; a floor walker sees from its own head height.',
  autoRotate: 'Turntable speed, degrees/second. 0 holds the shot (stages, vignettes); 1–2 is a slow reveal. frame.state.camera.bearing: where it stands now.',
  followAvoid: 'Keep the followed fish in view, 0–1: the chase camera rises over low clutter or pulls in, eased. For walks through a village.',
  nearFade: 'A creature at the lens dissolves, not sliced, 0–1. The followed fish never fades.',
  // cast
  fishCount: 'How many fish when `fishMix` is empty (all are `fishUrl`).',
  finish: 'A final full-screen pass: gentle grade, soft vignette, dither against banding, and restrained bloom on high-end devices (0 = none; never on the low tier).',
  tiltShift: 'Tilt-shift, 0–1: sharp through the middle, soft above and below, like a model. Mid/high tiers.',
  depthOfField: 'Depth of field, 0–1: the subject (followed fish, `cast` leads) sharp, the rest soft. High tier.',
  ambientOcclusion: 'Ambient occlusion, 0–1: crevices darken. High tier.',
  highlights: 'Bright light rolls off instead of clipping, 0–1: a fish in a shaft stays a fish. Mid/high tiers.',
  fishUrl: 'The single model used when `fishMix` is empty: ipfs://, https://assets.idlescreens.com/, or a URL on the page\'s own origin. Any other host is refused and the default fish swims.',
  fishMix: 'The cast: `id[:count][@style]`, comma-separated: `100:2@drift, 257:1, seahorse:3, shark:1@patrol`. Minted breeds plus bundled: shark crab dori glowfish babyfish hackerfish blowfish starfish octopus snail dot dolphin. Floor walkers keep their own pace: crab, starfish (dances with `starfishDance`), snail. `dot` (a courier box on legs) and `dolphin` (chatters, flips, breaches; stands on its tail to act) play vignette gestures. Overrides fishCount/fishUrl.',
  dracoPath: 'Where the Draco decoder lives; leave empty on a channel. Only the page\'s own origin or the shipped copy is used.',
  swimSpeed: 'Global swim speed multiplier. 0.4 is contemplative, 1 lively.',
  swimStyle: 'How the cast swims unless a fishMix entry says otherwise (`@style`). `auto` picks by breed.',
  pathShape: 'The shape of free-swimming paths.',
  formationShape: 'The figure a `school` holds.',
  swimVariance: 'How differently individual fish swim from one another (speed, phase).',
  fishSize: 'Every fish bigger or smaller, over each breed\'s own size (a shark is 2.2× a minted fish, a babyfish 0.45×).',
  sizeVariance: 'How much fish of one breed differ in size: 0 all alike, 1 from about half to nearly double.',
  maneuver: 'Which set-piece moves the cast may break into. Vignette actors (slots 0–2) keep their marks: the script owns them.',
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
  fishAmbient: 'The water\'s light on the fish in lit mode (backs, flanks, bellies, metal plates). Fixes fish reading dark; 0.6–1 in bright tanks. Dims with a follow-spot\'s house lights.',
  fishGlow: 'How strongly GLOW- parts of a fish bloom and light their neighbours and the floor.',
  fishMetal: '`on` (default) gives METAL- parts a polished, reflective finish.',
  snailShell: 'Snail shells: `banded`, `pearl` (iridescent), `gold`, `glow` (a spiral breathing light; best at night); `mix` (default), each its own. Lit fish only. frame.state.fish[i].shell says which.',
  starfishDance: 'Starfish dance: `aerobics`, a class in unison facing the camera; `freestyle`, each its own move every eight counts; `duet`, couples face to face (with `spotRig: 0/#ffd27a*26, 1/#ff8ad0*26`); `off` (default). Cast a few (`starfish:7`), `shot: front`, `autoRotate: 0`, a bright room.',
  danceTempo: 'Beats per minute for the starfish dance (60–180, default 128). Glides on the beat.',
  fishLook: '`neon` dresses the bundled creatures for blacklight: near-black coats, eyes (and a crab\'s mouth) glowing a neon of their own. Best in a dark room with `finish`. Default `natural`.',
  fishRim: 'A thin edge of the water\'s light round each fish, 0–1 (lit mode): dark fish on dark water. 0.6–1 in dark rooms.',
  fishShadows: 'Soft shadows under the swimmers, 0–1: dark near the sand, faint high up.',
  fishAO: 'A fish\'s own corners darken, 0–1: solid fish. All tiers.',
  fishFadeIn: 'Seconds an arriving fish takes to fade in (0 pops in).',
  sceneryShadows: 'Soft shadows under rocks, homes, castle, pyramids, geodes, lamps, 0–1: nothing floats.',
  voxelAO: 'Plant cubes darken where they touch each other and the sand, 0–1. All tiers.',
  swimWave: 'Fish bend as they swim: a wave nose to tail, the body curling into turns (0 = rigid wiggle). Skips the turtle, crab and fish with a skeleton; the seahorse gets fin, tail and nod instead.',
  fishAvoid: 'Fish make way for each other: a pair about to meet parts a second ahead, the smaller giving more, over or under before round. 1 (default) on, 0 pass-through. `inspect().crowding` counts pairs still touching.',
  eyeLife: 'Eyes blink, look, and emote (0 = painted on). Redraws each token\'s own pixel-grid eye; black and white only.',
  // water and room
  fogColor: 'The water colour; also the background. Dark blues and purples make light sources read.',
  fogNear: 'Where fog starts.',
  fogFar: 'Where everything has dissolved into the water. Raise to 700–1000 for castles and horizons.',
  floorColor: 'Sea-floor colour.',
  water: 'Water instead of fog: red fades with distance first, then green, blue last — a red fish goes blue-green before it goes into the murk. 0.6–1 for most scenes; 0 is plain fog.',
  waterClarity: 'With `water` on: 0 murky (colour lost fast, short reach), 0.5 as before, 1 clear (colour kept, reach ×1.5). Bright tanks want 0.7–1.',
  waterTint: 'The sunlit water, `#rrggbb`: distance fades into it looking up, half on the level, none looking down; the background takes the gradient. Empty = off; with `water` on, reef, kelp, ice and lagoon bring their own.',
  dither: '`on` adds an invisible dither that removes colour banding in dark fogged gradients on TVs. Recommended with `water`; `off` (default) is byte-exact with older scenes.',
  moteDensity: 'Suspended motes.',
  moteColor: 'Their colour.',
  environment: 'A room preset (floor, ceiling, light shafts). `void` for the mineral-world scenes.',
  floorKind: 'Floor shape: `auto` follows the environment, `flat`, or terrain `dunes`, `ridges`, `basin`, `shelf` (the town on a terraced plateau), `trench` (a deep channel across the front), `terraces` (tiers behind the town).',
  waterY: 'Height of the water ceiling; -1 = the environment\'s own.',
  rayStrength: 'Surface light shafts, within device budget: 5 high tier, 2 standard; none on the lowest tier with a surface (abyss, vent, universe keep 2; perceiveChannel then reads 0).',
  raySoftness: 'Shafts as soft volume, not flat sheets, 0–1. 1 for anything cinematic.',
  floorDetail: 'A seabed, not a coloured plane, 0–1: ripples, silt, grain; its far edge fades into the fog.',
  caustics: 'The dancing net of light from the surface on the floor, rocks, plants and fish (0 = none). Sharp near the top, soft and dim deep down.',
  causticScale: 'Size of the caustic cells: below 1 a fine shimmer, above 1 broad slow bands.',
  surfaceMirror: 'The surface from below: a window to the light in a rippling mirror of the tank (0 = plain). Needs reef, kelp, ice or lagoon; for the `surface` and `low` shots. High tier mirrors the tank, mid the deep water.',
  // world
  propMix: 'Crystals: `crystal[:count][@habit][/palette][*size]`. Habits lotus spire druse scatter coral; palettes env rainbow blue hotpink purple seafoam yellow orange cyan white glass; `*6` is tower-sized.',
  envProps: '`on` lets the environment preset plant its own crystals when `propMix` is empty.',
  crystalScale: 'Size of the whole mineral world (crystals, rocks, homes, flora).',
  crystalWild: 'Organic individuality: lean, bald sides, branching. 0 is a catalogue crystal, 1 is coral.',
  crystalGlow: 'How much crystals glow and pool light on the floor.',
  crystalPulse: 'Slow breathing of that light (0.12 Hz, ≤15 % — flash-safe).',
  crystalTint: 'How much nearby light sources colour a passing fish. 0.5–0.7 ties the cast to the place.',
  rockDensity: 'Faceted boulders, an arch and a back ridge around the crystals.',
  rockVeins: 'Crystals bursting out of the rocks: each crown broken open, chips on the rim, a colony of the same crystal growing from the breach. 0 is plain stone.',
  geodeHomes: 'Geode houses (0–3) in a crescent: a village. Doors are vignette marks `home1`…, `home1in`…. Capped at 2 on basic/minimal tiers; a dropped house takes its marks, and indoors there are none.',
  stoneStyle: '`weathered`: river-grey rocks and homes with silt on top, not dark holes in a lit room. `classic` (default): dark slate.',
  interior: '`geode` sets the whole scene INSIDE a geode home: furniture, chandelier, marks like `table`, `bed`, `door`.',
  floraDensity: 'Voxel plants: one tank-wide budget (× 36/72/108 by tier) shared among crystals and geodes, so more crystals means sparser gardens. What grows is `floraMix`; empty, the room picks.',
  geodes: 'Wild geodes on the floor (0 = none): split geodes, thunder eggs, cathedrals, clusters, one cavern. They pulse with the crystals, take the nearest one\'s mineral, and wake when a fish comes close.',
  geodeMix: 'Which geodes: `kind[:weight]`, comma-separated. geode cathedral cluster cavern (the cavern is one at most).',
  geodeMineral: 'What they are made of: amethyst agate celestine citrine carnelian rose emerald quartz smoky. Empty = the mineral nearest in colour to the nearest crystal; `world` = two from the seed; or a list.',
  fountain: 'The town square\'s fountain: `vent` (a crystal-crusted chimney glowing at the mouth) or `geode` (a geode basin on a plinth). A bubble column, a plaza, its own light, and a vignette mark `fountain`.',
  signs: 'Signs, `kind[@place][>target][/#color][*size][:text]`: `plank` on a post, `arrow` to a place, life-`ring`, lit `porthole`, `neon` lettering, scrolling `led`, each beside its place. Original words only. `neon@home1/#ff4fa0:OPEN, arrow@hub>gate:Castle`.',
  stageSet: '`club`: a brick back wall, a mic on a stand at the `mic` mark, a stool; `mic`: the stand alone. For the `openmic` vignette.',
  dolphinCast: 'Comic dolphins, in fishMix order: `showman` (navy suit, red tie, quick), `drifter` (tan, flannel, trucker cap, slow slouch), `bigguy` (big, slate, dark tee, deadpan), `host` (a bow tie); else `classic`. Types, no likeness.',
  signFlicker: 'How unstable the lit signs\' power is, 0–1 (default 0.4): hums, stutters, a dead row, now and then a reboot, each sign on its own supply; 0 is steady. Flash-safe.',
  streetLamps: 'Crystal streetlamps along the paths (0–1, about 24 at 1): slate posts crowned in the nearest crystal\'s colour, a halo, light on the floor. Needs paths.',
  townProps: 'Village props, kind[:count][/style]: fence (a yard per home; driftwood coral stone crystal), mailbox (by each gate: post clam bottle; marks mailbox1…), bench[:n] (shell stone), sock[:n]. Fences and mailboxes need geodeHomes.',
  floorCover: 'The village\'s floor, kind[/style]: lawn (yards; stripes checks), mosaic (at the hub; stone shell glass), mat (at doors; kelp stripe), steps (down walks; slate sand moss), ripples (fine broad). Lawns and mats need geodeHomes, steps paths. Flat ground.',
  pyramids: 'Pyramids of cubes (0 = none, 1 = about a dozen complexes): a great pyramid and its queens, the great ones at the back. Flat ground only (floorKind: flat).',
  pyramidMix: 'Shapes and stones, `shape|stone[:weight], …`: giza step bent djoser mayan frame; sandstone limestone obsidian jade gold lapis coral crystal nacre basalt, and lit led and neon (every cube a lamp). Empty = every shape in the room\'s stone.',
  pyramidLayout: 'field = complexes over the floor; stage = one monumental pyramid mid-orbit (lit with led or neon, else stone with lit trim), a small one each side, the field behind. Needs flat ground in the middle.',
  pyramidShow: 'The lit pyramids\' show (led, neon or trim): auto = one wave through every routine; solo = each its own; a routine (rings beam edges equalizer rainbow twinkle faces rain spiral breathe ripple); or cues `8s:rings, 16s:equalizer`. Live, no rebuild.',
  pyramidBpm: 'The light show\'s tempo, 0–140 (0 = free-running): the motion steps on the beat and each beat lifts the lamps a little — never a flash.',
  geodeLayout: '`field` (default) scatters them; `gallery` lines them up, a row per kind and a column per mineral, the mega geode behind. Frame with cameraDistance 400, elevation ~26, nothing else in the scene.',
  floraLayout: '`garden` (default) grows plants round the crystals; `gallery` plants one of each species in two rows across the front (only floraMix\'s, if set). Frame with `shot: front` or `cameraDistance` ~260.',
  floraPalette: 'One colour scheme for the garden: `world` (a hero hue, a neighbour and an accent from the seed) or up to six `#rrggbb`; each colony is pulled most of the way to one. Empty = each species its own.',
  floraMix: 'Which plants, `species[:weight]`: grass tube bulb fan kelp anemone staghorn brain whip barrel shelf seapen clam bubble elder curl pod (clam ≤2, elder 1). `kelp:3, whip, seapen` a kelp forest; `staghorn:2, brain, anemone:2, clam` a reef. Needs floraDensity.',
  bubbleVents: 'Bubbles from chimneys, fissures and crystals.',
  bubbleStyle: 'Vent bubbles: `classic` loops puffs; `live` grows each at the vent, rises it to the surface and pops it, resting the vent now and then. Distant bubbles dim instead of fattening.',
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
  spotStrength: 'How hard the spots are and how far the house lights fall: lit fish\'s key/fill (to 40%) and fishAmbient dim; glow, reflections and scenery keep theirs. A `-` blackout puts out only the spots.',
  spotColor: 'Colour of the single `followSpot`.',
  spotShadow: 'The spotted fish\'s shadow in its pool. 0 none, 1 true size.',
  spotRig: 'Up to three spots: `slot[/color][*radius]` follows a fish, `@mark` stands on a mark (`@mic` lights whoever steps up). They are a, b, c in order. Overrides followSpot.',
  spotCues: 'A looping cue sheet for the rig: `8s:a, 8s:b, 12s:a+b, 4s:-` (`-` = blackout). Spots cross-fade at each cue.',
  vignette: 'A small scene for the first 2–3 fish: a preset (tea·bedtime·seek indoors; duet·trio·openmic on the open stage) or a script of beats. A floor creature cast as an actor stays on the floor. Grammar below.',
};

export const GRAMMAR = `
fishMix   id[:count][@style][*size], …        100:2@drift, 257:1, seahorse:3, shark:1@patrol*1.5
          id = a minted token (1–512) or a breed (betafish angelfish seahorse seaturtle). Minted fish are
          individuals: a count casts DISTINCT neighbours. Bundled creatures (a count is copies): shark
          crab dori glowfish babyfish hackerfish blowfish starfish octopus snail dot. *size scales that token over its
          breed's own size. Styles: loop school drift hover patrol bottom surface follow pair chase audience.
propMix   crystal[#id][:count][@habit][/palette][*size], …      crystal:3@druse/rainbow, crystal:1@spire/cyan*6
          habits lotus spire druse scatter coral · palettes env rainbow blue hotpink purple seafoam yellow orange cyan white glass
floraMix  species[:weight], …                              kelp:3, whip, seapen · staghorn:2, brain, anemone:2, clam
          grass tube bulb fan kelp anemone staghorn brain whip barrel shelf seapen clam bubble elder curl pod (empty = the room's garden)
townProps  kind[:count][/style], …   fence/coral, mailbox/post, bench:4/shell, sock:2
          fence: driftwood coral stone crystal · mailbox: post clam bottle · bench: shell stone · sock (needs geodeHomes for fence and mailbox)
floorCover  kind[/style], …   lawn/stripes, mosaic/shell, mat/kelp, steps, ripples/broad
          lawn: stripes checks · mosaic: stone shell glass · mat: kelp stripe · steps: slate sand moss · ripples: fine broad
pyramidMix  shape|stone[:weight], …   giza step bent djoser mayan frame · sandstone limestone obsidian jade gold lapis coral crystal nacre basalt led neon
          giza:3, mayan, gold:2, obsidian   (empty = every shape in the room's stone)
pyramidShow  auto | solo | routine | <sec>s:<routine>, …   8s:rings, 8s:beam, 16s:equalizer
          rings beam edges equalizer rainbow twinkle faces rain spiral breathe ripple · pyramidMix trim[:share] lights stone ones' edges
geodeMix  kind[:weight], …   geode cathedral cluster cavern                          geode:3, cathedral, cluster
geodeMineral  world | mineral, …   amethyst agate celestine citrine carnelian rose emerald quartz smoky
floraPalette  world | #rrggbb, …  (≤6)                          world · #ff4fa0, #ffb347, #4fd1ff
spotRig   slot|@mark[/color][*radius], …  (≤3; they become a, b, c)   0/#ffd27a*24, 1/#ff8ad0*24, 2/#7fdcff*24
spotCues  <sec>s:<spots>, …  loops                               4s:-, 7s:a, 7s:b, 12s:a+b
signs     kind[@place][>target][/#color][*size][:text], …   plank@gate:"Welcome to the reef", neon@home1/#ff4fa0:OPEN, led@plaza:TIDE 4.2M
          kinds plank arrow ring porthole neon led · places gate plaza courtyard hub fountain home1 home2 home3 centre left right front back
          an arrow points at >target · text ≤ plank 24, arrow 16, ring 10, porthole 4 (empty = a fish), neon 14, led 64 (scrolls) · ≤ 8 signs
vignette  beats separated by |, cues by comma; actors a b c d are fish slots 0 1 2 3
          [<sec>s:] actor =mark  be there, no travel (a later beat's = snaps at its start)    actor >mark  swim there
          actor @mark | @actor   face it    a b circle mark  each named actor rings it, back to its spot by the beat's end; others stay put
          actor follow actor     gestures: talk nod shake hop spin wiggle rest peek bow · ink (octopus only: a cloud of ink)
          dances: toprock footwork windmill headspin freeze drop (a betafish dances them with its own body; 2 s beats keep them on a 120 bpm bar)
          Give every beat a duration and end where you began and a spotCues sheet stays in step forever.
          Fish cast @audience sit out front facing the stage: they laugh as each talk ends and applaud each bow.
          Marks outdoors: ${Object.keys(OPEN_MARKS).join(' ')} — plus the world's own:
          home1 home1in … (geodeHomes), gate plaza courtyard (landmark), hub (paths), fountain (fountain).
          Marks indoors (interior: geode): ${Object.keys(INTERIOR_MARKS).join(' ')}
          rug centre: middle; chandelier: overhead; others bearing°/distance/height (0°=+x, 90°=+z), ×max(crystalScale, 0.85):
          ${Object.entries(INTERIOR_MARK_POLAR).map(([n, p]) => `${n} ${p.deg}/${p.r}/${p.y}`).join(' · ')}
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
/** The polished light: highlights roll off, shafts are volume, fish carry a rim and never slice the lens, the frame is graded. */
const CINEMATIC = { highlights: 1, raySoftness: 1, nearFade: 1, finish: 0.6 } as const;

export const RECIPES: readonly Recipe[] = [
  {
    id: 'geode-harbor', label: 'Geode harbor', what: 'A village at night: three geode homes, chimneys bubbling, lanterns overhead, a far horizon.',
    params: { ...ALIVE, ...NIGHT, floorColor: '#2a1a2a', paths: 0.7, geodeHomes: 3, rockDensity: 0.35, rockVeins: 0.6, floraDensity: 0.25, bubbleVents: 0.9, marineSnow: 0.45, skyLanterns: 0.8, horizon: 1,
      propMix: 'crystal:2@spire/orange,crystal:2@druse/hotpink,crystal:1@lotus/purple', crystalTint: 0.6, fishMix: '100:2,257:2,seahorse:2', swimStyle: 'drift', swimSpeed: 0.5,
      signs: 'plank@hub:"Harbor Row", neon@home1/#ffb347:OPEN, arrow@hub>home3:Lighthouse, porthole@home2',
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
      signs: 'plank@gate:"Welcome to the castle", led@front/#7fdcff:TOURS EVERY HOUR - MIND THE MOAT - NO SWIMMING IN THE KEEP',
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
    id: 'open-mic', label: 'Open mic', what: 'A comedy club: a host brings three comic dolphins to the mic in turn; a seated crowd laughs and applauds.',
    params: { ...ALIVE, ...STAGE, floorColor: '#1a1210', vignette: 'openmic', stageSet: 'club', spotRig: '@mic/#ffc890*26', spotCues: VIGNETTE_CUES.openmic!, spotStrength: 0.3,
      fishMix: 'dolphin:4, dori:2@audience*0.7, crab:2@audience*0.6, octopus:1@audience*0.7, babyfish:5@audience', dolphinCast: 'showman, drifter, bigguy, host',
      signs: 'neon@back/#ff4fa0:OPEN MIC', finish: 0.6, cameraDistance: 125, cameraElevation: 12, cameraAzimuth: 0 },
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
  {
    id: 'reef-characters', label: 'Reef characters', what: 'The bundled characters on a reef: tangs that look back, blowfish that puff and flirt, an octopus that inks, a crab.',
    params: { ...ALIVE, environment: 'reef', fishMix: 'dori:3,blowfish:2,octopus:1,crab:1', floraDensity: 0.6, marineSnow: 0.3, finish: 0.5, swimSpeed: 0.7,
      signs: 'plank@left:"Mind the crabs", ring@right:Lifeguard',
      cameraDistance: 160, cameraElevation: 13, cameraAzimuth: 20, autoRotate: 0.6 },
  },
  {
    id: 'starfish-class', label: 'Starfish aerobics', what: 'Seven starfish stand up on a pale ice floor, face the camera and dance an aerobics routine in unison, an instructor in front.',
    params: { environment: 'ice', fishMix: 'starfish:7', starfishDance: 'aerobics', danceTempo: 120, shot: 'front', autoRotate: 0 },
  },
  {
    id: 'snail-garden', label: 'Snail garden', what: 'Five snails glide a planted floor, low and close: they graze, stretch, look at you or hide in their shells; baby fish overhead.',
    params: { ...ALIVE, environment: 'lagoon', fishMix: 'snail:5,babyfish:4', floraDensity: 0.7, marineSnow: 0.2, finish: 0.5, swimSpeed: 0.6,
      cameraDistance: 110, cameraElevation: 8, cameraAzimuth: 15, autoRotate: 0.3 },
  },
  {
    id: 'dot-delivers', label: 'Dot delivers', what: 'Dot the courier knocks at a neighbour\'s door; a blowfish comes out, they bow and chat, Dot spins for joy and walks home.',
    params: { ...ALIVE, geodeHomes: 3, paths: 0.6, fountain: 'geode', streetLamps: 0.5, floraDensity: 0.08, fishMix: 'dot:1,blowfish:1,babyfish:3',
      vignette: '3s: a =fountain, b =home1in | 7s: a >home1 @home1 | 4s: a @home1 hop | 5s: b >home1 @a, a @b | 5s: a @b bow, b @a nod | 6s: a @b talk, b @a nod | 6s: b @a talk, a @b peek | 4s: a @b spin | 5s: a @b wiggle, b @a hop | 5s: b >home1in, a @b nod | 7s: a >fountain',
      cameraFollow: 0, followDistance: 55, followAngle: 130 },
  },
  {
    id: 'snail-night', label: 'Snails by night', what: 'Glowing snails on a dark floor: each spiral breathes light, the feelers pool green on the sand, and the camera rides beside one.',
    params: { ...ALIVE, ...NIGHT, fogColor: '#060612', floorColor: '#141020', fishMix: 'snail:6', snailShell: 'glow', floraDensity: 0.2, marineSnow: 0.3, finish: 0.6,
      cameraFollow: 1, followDistance: 40, followAngle: 140 },
  },
  {
    id: 'reef-cinematic', label: 'Reef, cinematic', what: 'A small reef cast framed close wherever it swims, in soft shafts, each fish over its shadow. The polished look.',
    params: { ...ALIVE, ...CINEMATIC, environment: 'reef', fishMix: 'seaturtle:1@patrol, blowfish:1, octopus:1@bottom, dori:5@school, crab:1', floraDensity: 0.45, marineSnow: 0.3,
      swimSpeed: 0.6, fishRim: 0.35, fishShadows: 1, sceneryShadows: 1, floorDetail: 0.5, fishAmbient: 0.5, caustics: 0.6, depthOfField: 0.4, ambientOcclusion: 0.8, shot: 'cast', cameraElevation: 12, autoRotate: 0.5 },
  },
  {
    id: 'night-cinematic', label: 'Deep night, cinematic', what: 'The deep at night: glowfish under jellyfish lanterns, a shark sliding through, every outline rimmed in light.',
    params: { ...ALIVE, ...CINEMATIC, finish: 0.75, environment: 'abyss', fishMix: 'glowfish:2@hover, babyfish:1@hover, shark:1@patrol, babyfish:2, hackerfish:1',
      propMix: 'crystal:2@druse/cyan, crystal:1@spire/hotpink', fishLook: 'neon', fishGlow: 0.8, fishRim: 0.9, sceneryShadows: 1, marineSnow: 0.5, swimSpeed: 0.5, skyLanterns: 0.6, skyHeight: 0.35,
      shot: 'cast', cameraElevation: 8, autoRotate: 0.4 },
  },
  {
    id: 'village-cinematic', label: 'Village, cinematic', what: 'Dot, Puff and Hex meet in a sunlit village of stone homes, seen high through a tilt-shift lens: a model village.',
    params: { ...ALIVE, ...CINEMATIC, environment: 'lagoon', floorKind: 'flat', geodeHomes: 3, stoneStyle: 'weathered', paths: 0.5, streetLamps: 0.3, floraDensity: 0.12, townProps: 'mailbox, fence',
      fishMix: 'dot:1, blowfish:1, hackerfish:1, babyfish:3', swimSpeed: 0.5, marineSnow: 0.25,
      vignette: '4s: a =home1in, b =home2in, c =home3in | 8s: a >centre, b >centre @a | 6s: a @b talk, b @a nod | 8s: c >centre, a @c, b @c | 9s: a b c circle centre | 8s: a >home1in, b >home2in, c >home3in',
      fishRim: 0.3, fishShadows: 1, sceneryShadows: 1, floorDetail: 0.6, ambientOcclusion: 0.8, tiltShift: 0.55, shot: 'orbit', cameraDistance: 125, cameraElevation: 32, autoRotate: 0.5 },
  },
];

export const recipe = (id: string): Recipe | undefined => RECIPES.find((r) => r.id === id);

/** A recipe (or any param set) as the control track `publishScene` takes: every value at t = 0. */
export function recipeTrack(params: Readonly<Record<string, Value>>, seed = 0):
  { program: string; seed: number; deltas: { t: number; path: string; value: Value }[] } {
  return { program: 'metaquarium', seed, deltas: Object.entries(params).map(([path, value]) => ({ t: 0, path, value })) };
}

/** `also`: the other params the problem is about — a server reporting only
 *  what one call changed counts the problem as touched when any of them was. */
export interface ParamProblem { path: string; message: string; also?: string[] }

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
  if (str('pyramidMix')) push('pyramidMix', parsePyramidMix(str('pyramidMix')).problems);
  if (str('townProps')) push('townProps', parseTownProps(str('townProps')).problems);
  if (str('floorCover')) push('floorCover', parseFloorCover(str('floorCover')).problems);
  if (str('pyramidShow')) push('pyramidShow', parsePyramidShow(str('pyramidShow')).problems);
  if (str('geodeMineral')) push('geodeMineral', parseGeodeMineral(str('geodeMineral')).problems);
  const rig = parseSpotRig(str('spotRig'));
  push('spotRig', rig.problems);
  if (str('spotCues')) {
    const spots = rig.spots.length || (Number(params.followSpot ?? -1) >= 0 ? 1 : 0);
    if (!spots) out.push({ path: 'spotCues', message: 'a cue sheet needs a spotRig (or followSpot) to cue' });
    else push('spotCues', parseSpotCues(str('spotCues'), spots).problems);
  }
  const world = worldMarks(params);
  for (const s of rig.spots) {
    if (s.mark && !(s.mark in OPEN_MARKS) && !(s.mark in world)) out.push({ path: 'spotRig', message: `no "${s.mark}" mark in this scene — that spot is dark` });
  }
  if (str('vignette')) {
    const indoors = params.interior === 'geode';
    push('vignette', parseVignette(resolveVignette(str('vignette')), indoors ? INTERIOR_MARKS : { ...OPEN_MARKS, ...world }).problems);
  }
  if (str('signs')) {
    const signs = parseSignMix(str('signs'));
    push('signs', signs.problems);
    if (params.interior === 'geode') out.push({ path: 'signs', also: ['interior'], message: 'signs stand outdoors — none are built inside a geode home' });
    else {
      const missing = [...new Set(signs.entries.flatMap((e) => [e.place, e.target]).filter((m): m is string => !!m && !(m in OPEN_MARKS) && !(m in world)))];
      for (const m of missing) {
        out.push({ path: 'signs', also: ['landmark', 'geodeHomes', 'paths', 'fountain'], message: `no "${m}" in this scene (${MARK_NEEDS[m] ?? 'its world part is off'}) — that sign stands in the open` });
      }
    }
  }
  if (str('townProps')) {
    const t = parseTownProps(str('townProps')).props;
    const homes = Math.round(Number(params.geodeHomes ?? 0));
    if ((t.fence || t.mailbox) && !(homes > 0)) out.push({ path: 'townProps', also: ['geodeHomes'], message: 'fences and mailboxes stand round homes: set geodeHomes ≥ 1' });
  }
  if (str('floorCover')) {
    const c = parseFloorCover(str('floorCover')).cover;
    const homes = Math.round(Number(params.geodeHomes ?? 0)), walks = Number(params.paths ?? 0) > 0;
    if ((c.lawn || c.mat) && !(homes > 0)) out.push({ path: 'floorCover', also: ['geodeHomes'], message: 'lawns and doormats belong to homes: set geodeHomes ≥ 1' });
    if (c.steps && !walks) out.push({ path: 'floorCover', also: ['paths'], message: 'stepping stones go down the paths: set paths > 0' });
    if (c.mosaic && !walks && !(homes > 0) && (params.fountain ?? 'none') === 'none') out.push({ path: 'floorCover', also: ['fountain', 'paths', 'geodeHomes'], message: 'a mosaic tiles the square: set a fountain, paths or geodeHomes' });
  }
  out.push(...dependencyProblems(params));
  return out;
}

/** What turns each world mark on. */
const MARK_NEEDS: Record<string, string> = {
  gate: 'needs landmark castle or citadel', plaza: 'needs landmark castle or citadel', courtyard: 'needs landmark castle or citadel',
  hub: 'needs paths > 0', fountain: 'needs a fountain', mailbox1: 'needs townProps mailbox and geodeHomes ≥ 1', mailbox2: 'needs townProps mailbox and geodeHomes ≥ 2', mailbox3: 'needs townProps mailbox and geodeHomes 3', home1: 'needs geodeHomes ≥ 1', home2: 'needs geodeHomes ≥ 2', home3: 'needs geodeHomes 3',
};

/** The marks this scene's world adds (positions are placeholders: only the names matter here). */
function worldMarks(params: Readonly<Record<string, unknown>>): Record<string, { x: number; y: number; z: number }> {
  const homes = Math.round(Number(params.geodeHomes ?? 0));
  const world: Record<string, { x: number; y: number; z: number }> = {};
  const at = { x: 0, y: 0, z: 0 };
  for (let i = 1; i <= Math.min(3, homes); i++) { world[`home${i}`] = at; world[`home${i}in`] = at; }
  // A mailbox by every home's gate (townProps): a fish sent there has come with the post.
  if (typeof params.townProps === 'string' && parseTownProps(params.townProps).props.mailbox) for (let i = 1; i <= Math.min(3, homes); i++) world[`mailbox${i}`] = at;
  if (params.landmark === 'castle' || params.landmark === 'citadel') for (const m of ['gate', 'plaza', 'courtyard']) world[m] = at;
  // Paths meet at a hub: the mark `paths` documents itself as adding.
  if (Number(params.paths ?? 0) > 0) world.hub = at;
  if (params.fountain === 'vent' || params.fountain === 'geode') world.fountain = at;
  return world;
}

/** The tank's fish cap on the best devices; smaller ones swim fewer. */
const CAST_CAP = 24;
/** The orbit params a follow camera overrides outright. cameraAzimuth and autoRotate stay live while following
 *  (they face a dancing class and steer crossing paths), so they are not listed. */
const ORBIT_PARAMS = ['cameraElevation', 'cameraDistance'] as const;

/**
 * Params that do nothing because another param overrides them or is off — the
 * tank accepts them without a word, so an author who set `fishCount: 14` beside
 * a nine-fish `fishMix` saw nine fish and no reason (blind-agent probe on prod,
 * 2026-10-04). Only params the author SET are judged; an unset one is its
 * default and says nothing.
 */
function dependencyProblems(params: Readonly<Record<string, unknown>>): ParamProblem[] {
  const out: ParamProblem[] = [];
  const set = (k: string): boolean => params[k] !== undefined && params[k] !== null;
  const num = (k: string, fallback: number): number => {
    const v = Number(params[k]);
    return set(k) && Number.isFinite(v) ? v : fallback;
  };
  const str = (k: string, fallback = ''): string => (typeof params[k] === 'string' ? (params[k] as string).trim() : fallback);

  // The cast: a fishMix with any valid token defines it absolutely
  // (tank.reconcile), otherwise fishCount copies of fishUrl.
  const mix = str('fishMix') ? parseFishMix(str('fishMix')).entries : [];
  const mixTotal = mix.reduce((n, e) => n + e.count, 0);
  const cast = mix.length ? Math.min(mixTotal, CAST_CAP) : Math.min(Math.max(1, Math.round(num('fishCount', 1))), CAST_CAP);
  const castWhy = mix.length ? `fishMix casts ${cast}` : `the cast is fishCount ${cast}`;
  const castParams = mix.length ? ['fishMix'] : ['fishCount'];
  if (mix.length) {
    for (const k of ['fishCount', 'fishUrl']) {
      if (set(k)) out.push({ path: k, also: ['fishMix'], message: `ignored: a non-empty fishMix sets the cast (${mixTotal} fish) — put the counts in fishMix` });
    }
    if (mixTotal > CAST_CAP) out.push({ path: 'fishMix', message: `casts ${mixTotal} fish, but at most ${CAST_CAP} swim (fewer on smaller devices): slots ${CAST_CAP}+ never appear` });
  }

  // Slots: the follow camera, the spots and the vignette's actors address
  // fish by their place in the cast.
  const noFish = (slot: number): string => `slot ${slot} has no fish — ${castWhy} (slots 0–${cast - 1})`;
  const follow = Math.round(num('cameraFollow', -1));
  if (follow >= cast) out.push({ path: 'cameraFollow', also: castParams, message: noFish(follow) });
  const rig = parseSpotRig(str('spotRig')).spots;
  const spot = Math.round(num('followSpot', -1));
  if (rig.length && set('followSpot')) out.push({ path: 'followSpot', also: ['spotRig'], message: 'ignored: a spotRig replaces the single followSpot' });
  else if (spot >= cast) out.push({ path: 'followSpot', also: castParams, message: noFish(spot) });
  for (const s of rig) if (!s.mark && s.slot >= cast) out.push({ path: 'spotRig', also: castParams, message: noFish(s.slot) });
  if (str('vignette')) {
    const v = parseVignette(resolveVignette(str('vignette')), { ...OPEN_MARKS, ...INTERIOR_MARKS });
    const { actors } = v;
    if (actors > cast) out.push({ path: 'vignette', also: castParams, message: `needs ${actors} fish (actors a–${'abcd'[actors - 1]} are slots 0–${actors - 1}), but ${castWhy}` });
    // A breed's own gesture (an octopus's ink) on an actor of another breed does nothing.
    const slotBreeds = expandFishMixSlots(mix, 3).map((sl) => sl.breed);
    for (const [g, breeds] of Object.entries(BREED_GESTURES) as [string, readonly string[]][]) {
      for (let a = 0; a < actors; a++) {
        if (!v.beats.some((b) => b.actors[a]?.gesture === g)) continue;
        const breed = slotBreeds[a] ?? 'fish';
        if (!breeds.includes(breed)) out.push({ path: 'vignette', also: ['fishMix'], message: `"${'abcd'[a]} ${g}" does nothing: ${g} is the ${breeds.join('/')}'s own, and actor ${'abcd'[a]} (slot ${a}) is a ${breed}` });
      }
    }
  }

  // Off switches: a param that only shapes something that is not there.
  const dance = str('starfishDance', 'off') || 'off';
  // Slots fill in entry order and the cast is capped, so a starfish past slot CAST_CAP never swims.
  const starfishSwims = mix.some((e, i) => e.breed === 'starfish' && mix.slice(0, i).reduce((n, p) => n + p.count, 0) < CAST_CAP);
  if (dance !== 'off' && !starfishSwims) {  // no fishMix = one minted fish, never a starfish
    out.push({ path: 'starfishDance', also: ['fishMix'], message: 'no starfish in the cast to dance — add e.g. starfish:7 (slots past the cap never swim)' });
  }
  if (set('danceTempo') && dance === 'off') out.push({ path: 'danceTempo', also: ['starfishDance'], message: 'does nothing while starfishDance is off' });
  // A follow slot past the cast never activates (the orbit shot stays), and is flagged above.
  if (follow < 0) {
    for (const k of ['followDistance', 'followAngle', 'followAvoid']) if (set(k)) out.push({ path: k, also: ['cameraFollow'], message: 'does nothing while cameraFollow is -1 (the orbit camera)' });
  } else if (follow < cast) {
    for (const k of ORBIT_PARAMS) if (set(k)) out.push({ path: k, also: ['cameraFollow'], message: `ignored while cameraFollow rides with slot ${follow} — they return when it is -1` });
  }
  const spotOn = rig.length > 0 || spot >= 0;
  if (!spotOn) {
    for (const k of ['spotStrength', 'spotShadow', 'spotColor']) if (set(k)) out.push({ path: k, also: ['followSpot', 'spotRig'], message: 'does nothing with no spot on (followSpot is -1 and spotRig is empty)' });
  } else if (rig.length && set('spotColor')) {
    out.push({ path: 'spotColor', also: ['spotRig'], message: 'colours the single followSpot; a spotRig gives each of its spots its own colour (slot/#rrggbb)' });
  }
  if (set('signFlicker') && !str('signs')) out.push({ path: 'signFlicker', also: ['signs'], message: 'does nothing with no signs' });
  if (Math.round(num('shoal', 0) * CAST_CAP * 2.5) < 3) {  // the tank builds no school under 3 fish
    for (const k of ['shoalKind', 'shoalSpeed']) if (set(k)) out.push({ path: k, also: ['shoal'], message: 'does nothing while shoal is too low to make a school (under 3 fish; 0 is off)' });
  }
  if (num('floraDensity', 0) <= 0) {
    for (const k of ['floraMix', 'floraPalette', 'floraLayout']) if (set(k)) out.push({ path: k, also: ['floraDensity'], message: 'does nothing while floraDensity is 0 (no plants)' });
  }
  return out;
}
