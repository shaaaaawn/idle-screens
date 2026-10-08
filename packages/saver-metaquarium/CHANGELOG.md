# @idle-screens/saver-metaquarium

## 0.16.0

### Minor Changes

- ea0bbdd: Minted fish no longer come from IPFS. Every token of a minted breed is the same model and differs only in its paint, measured over all 512. So the package now bundles four models, one per breed, plus a paint table: each token's materials, and which part of the model wears which. A fish is rebuilt exactly as its original GLB was, verified triangle for triangle against the originals, with the same names, colours, glow, eyes and metal.
  
  - **Angelfish, seahorses and sea turtles** need no network at all. Each breed's model is one lazy chunk shared by every token (88–125 KB), and they draw about half the triangles the originals did.
  - **Betafish** keep their own texture atlas. A 256² WebP of about 15 KB rides in the package, and a 512² copy from `assets.idlescreens.com` swaps in when that host answers. The originals were 2048² JPEGs: up to 1.1 MB to download and about 22 MB of GPU memory per fish.
  
  Scenes and presets that name a minted fish by its IPFS URL take the new path unchanged. If the bundled path fails, the tank falls back to the original model.
- 6b2ecda: The minted breeds get rigs, as the other breeds have. Each breed is one model, so one rig built in Blender animates every token of it, and every token keeps its paint. Each rig is soft — every vertex's weights come from where it lies — so the skin bends and never cracks.
  
  - **Angelfish** (all 200): a snout, head and three-bone back that curve as one, three bones along each of the dorsal and anal fins, and nine moves — nibble, curious, kiss, soar, pirouette, bow, flutter, sway, stretch.
  - **Sea turtles** (all 16): a neck, a three-bone chain in each fore-flipper (a stroke runs out along the wing), hind flippers and a tail; ten moves including a barrel roll, a somersault, a wave and a face-wipe. They used to glide rigid.
  - **Seahorses** (all 40): a six-bone prehensile tail that coils into a spiral, a rippling dorsal fin, a neck and snout; ten moves including a twirl, a courtship dance and a feeding strike. They used to be bent by a vertex patch.
  - **Betafish** (all 256): a fan tail of three two-bone rays, a dorsal, side fins and gill covers that flare; ten moves including the full flare. Their painted eyes now look about — the pupil glides inside the white, in each token's own colours.
  
  Every fish has a personality drawn from its slot: a temperament, a favourite move, its own tempo and rhythm, and its own way of meeting the viewer — a curious turtle stretches its neck toward you, a shy one draws its head in, a fighter betta flares at you.
  
  Every fish in the tank, rigged or not, also moves more smoothly:
  
  - It faces along a chord of its route rather than its instant tangent, and the default `wander` route no longer hairpins at every waypoint — fish used to spin up to 3 rad in a frame there.
  - The dodge between passing fish turns the nose by its sideways share, eased, instead of flipping it ±0.5 rad.
  - A rigged fish's bend and look come off compressed, front-gated inputs, so a hairpin or a viewer behind it never snaps the body or the head.

## 0.15.1

### Patch Changes

- cb4ac8d: Minted fish load again. The public IPFS gateways the tank fetched every minted fish's model (and the lo-fi tank its icons) from — dweb.link and ipfs.io — retired on 2026-09-21, so since then every minted fish, the default scene's included, has swum as a placeholder blob. All 512 models and icons are now mirrored byte for byte at `assets.idlescreens.com/ipfs/<cid>/<file>`, the first rung of the ladder; Pinata and Filebase stay behind it as fallbacks, and the dead gateways (and an unanswering private node) are gone.

## 0.15.0

### Minor Changes

- db1569e: `describeMetaquarium(params)` reads a scene back as parts: cast rows (count, breed, how it moves, which slots it fills), Room · World · Stage · Camera · Motion · Look sections holding only what the author set, the palette on screen (the author's colours, else the room's own), choreographed changes, and the params that do nothing. `metaquariumParamsFromTrack(deltas)` folds a control track into the params in force at mount, treating live steers (`liveAt`) as already arrived. Both are zero-dep and exported through `./manifest`, so a viewer's scene card or a channel's state can explain a classic scene the way a SaverSpec's layers explain themselves.
- db1569e: Fish make way for each other. A pair about to meet sees it coming up to 1.6 s ahead and parts across its line of travel, over or under before round. The smaller fish gives more, and each fish turns its nose into the dodge so it never slides sideways. Nothing is simulated: the dodge is a pure function of where every fish's route puts it at t, so the same spec, seed and t still give the same frame on every screen.
  
  New param `fishAvoid` (0..1, smooth). **It defaults to 1, which changes how existing channels look**: this is the one param whose default does not keep the old look, because fish swimming through fish was a bug. Set `fishAvoid: 0` for the old pass-through. Measured on a 17-fish reef, frames with a fish inside another fell from 79% to 1%; on 8 fish, from 44% to 0%.
  
  `inspect()` gains `crowding`, which counts the pairs touching now, lists the worst three as `[slot, slot, overlap]`, and gives `without`, the count that would be touching with it off. `perceiveChannel` returns it in `frame.state`.
  
  Two cases fall outside the dodge. Floor creatures and vignette actors hold their ground and the others go round them. A pair passing exactly nose to nose has no side to part to, and the dodge fades there rather than flicking.

### Patch Changes

- db1569e: For agents — `validateMetaquariumParams` now also reports params that would silently do nothing: `fishCount`/`fishUrl` beside a non-empty `fishMix` (which sets the cast), a mix over the 24-fish cap, a `cameraFollow`/`followSpot`/`spotRig` slot or vignette actor past the end of the cast, `starfishDance` with no starfish in the mix, and dials on something switched off (`danceTempo`, `followDistance`/`followAngle`, orbit params while following, spot params with no spot, `shoalKind`/`shoalSpeed` with no shoal, `floraMix`/`floraPalette`/`floraLayout` with no plants). Each problem names the other params it is about in a new optional `also` field. Two recipes cast the bundled characters: `reef-characters` (tangs, blowfish, an octopus and a crab on a reef) and `starfish-class` (an aerobics class on an ice floor). The manifest description now says what the tank is rather than how it was first built.
- db1569e: Octopus review fixes. Its arms curl the same way, a pinwheel (curling opposite ways, neighbouring arms crossed); every raised arm tip stands on its arm; the siphon sits on the body; all six mantle rings are there (two fell outside the mantle). Each arm vertex blends along its own arm, not a neighbour's. It breathes while it sleeps. A stop's activity (a wave, a look) ends with its clip instead of running the whole stop. The intake no longer draws a quad twice when one triangle bends and its twin does not (the octopus had sixteen such squares; every other breed is byte-identical).

## 0.14.0

### Minor Changes

- a183559: The babyfish — the babies of the metaquarium — are rigged, animated and dressed in candy colours.
  
  - **A rig.** `breeds/rig/babyfish.py` rigs the delivered model in Blender without changing a visible voxel: head, body, two tail links and a forked fin as a soft spine (the joints blend, so it bends as one piece instead of cracking into blocks), a dorsal fin that flutters, and two eyes.
  - **A baby's swim.** A quick, fluttery stroke phased by the distance swum — the tail a wave down three links, the head countering it, a bob and a squash-and-stretch twice a stroke.
  - **Moments of its own** (`src/babyfish.ts`), one a cycle: a zoom (wind up, burst of flutters, stretched long), a happy wiggle with its eyes squeezed into arcs, a barrel roll, a curious peek (head tilted one way and the other, two blinks), a hiccup (a jolt up, eyes popped wide), a chase round after its own tail, and a sleepy yawn (droopy eyes, a stretch, a shake awake). It blinks every few seconds in between. Each eye clip moves only the eyes, so it plays over whatever the body is doing.
  - **Babies copy each other.** A baby catches the moments of the baby ahead of it (the one before it in the mix — in a `@follow` line, the one in front) a beat later, so a yawn or a tail-chase runs down a line of ducklings. Yawns are the most catching, barrel rolls the least. It stays a closed form in t: a baby's moments are its leader's (shifted, some kept) plus its own that keep clear of them, so two never overlap; a run of babies is cut into lines of eight.
  - **Hiccup bubbles** (`src/burps.ts`). At a hiccup's jolt a bubble pops out of the baby's mouth with a tiny one after it; they leave with the baby's speed, lose it to the water, and wobble up — quickening, swelling a little — and pop at the end of their life or at the ceiling. A bubble is an emission with a closed-form flight; the tank makes the layer with its first babyfish, so a tank without one draws nothing new. `inspect()` lists the bubbles in flight.
  - **Candy-bright coats.** New material roles: `VIVID-<n>` puts a band `n`% of the way between a fish's two coats — the ends held at least 70° apart in hue, saturated, and glowing a little of their own colour so dark water does not dim them — so the babyfish's bands run head to tail as one vivid gradient; `PAINT-#rrggbb` is a fixed colour on every fish — the babyfish's stripe and mouth are sunny yellow, glowing a little more than the coat so blue water light does not turn it olive.
  - **Sparkly eyes.** `EYES-Sparkle` puts one catchlight in each pupil: a soft-edged white square high on the face that looks out of the head, placed in the pupils' own bounds, riding the eye as it moves and squashing with a blink. It fades out when the pupil is only a few pixels across, so it never shimmers.
- a183559: The blowfish — a pufferfish, and a flirt — is rigged, and it changes size.
  
  - **It puffs up.** `breeds/rig/blowfish.py` hangs the whole fish off a `puff` bone whose clip is a dial: its time is how puffed it is. Puffed, the fish grows round (wider and taller more than longer) and its spines stand up from half tucked — a relaxed puffer's spines lie flat. `src/puffer.ts` breathes it a little always, and now and then puts on a show: gulping itself up at a puffer's 2.5 gulps a second, holding the ball, and letting it go — burping the water back out in steps with a bubble each (the real way: slower than it went in) or zipping round like a let-go balloon, its eyes rolling. Sometimes just a half-puffed pout.
  - **Its eyes flirt.** True puffers can close their eyes (the eye draws in and the skin closes round it — Ogimoto 2021), so the blowfish winks. Every frame `src/puffer.ts` aims, opens, closes and dilates each eye: it scans in saccades, now and then lets its eyes go their own ways, finds the viewer and holds their eye with wide pupils, and flirts — a wink, batted lashes, slow bedroom eyes, a sly side-eye, an eyebrow flash. It shuts its eyes for a kiss, peeks back through half-shut lids when shy, goes wide-eyed and tiny-pupilled as it gulps. `inspect()` reports each blowfish's puff, lids, gaze and flirt.
  - **A dozen acts,** one every 8–13 s: a kiss (it turns to you, puckers, mwah — a bubble), a shimmy, a pirouette, a back flip, bounces, a water jet, a big round yawn, a shy turn and peek, a wave, a crunch — and the puff show. It holds still for them and catches up after. It swims a puffer's way: pectorals beating half a stroke apart, a little mouth-up.
  - **A rig faces the way it was built.** The tank guessed a model's heading from its longest side, and the blowfish — wider than long — swam sideways. A rigged model (`mqRig`) now faces +z, as every rig script builds it.
  - **Unhurried.** A puffer is a slow, deliberate swimmer: the pectorals flutter at ~3 Hz, every act is played a third to a half slower than first cut, an act comes every 13–20 s, the eyes jump less often, and the travel an act holds back is made good over 6 s, not in a dash.
  - **Clean eyes.** Each eye is rebuilt as one white box and its pupil as one quad on its face (`common.clean_eyes`, the dori's too): the delivered cubes showed a line through, or at the edge of, a sliding pupil.
- a183559: The dori — a blue tang — is rigged, and it is the first fish in the tank that swims on its fins and the first whose eyes are the show.
  
  - **It flies on its fins.** A tang is a labriform swimmer: its body stays rigid while its pectorals beat like wings — out and back, then in and forward, twisting as they go — and it only kicks its tail to burst. The stroke runs on time as well as distance, so the fins keep beating while it holds station, and the tail comes in exactly when the tank makes it dart.
  - **Its eyes look at things.** Fish have no eyelids and a fixed pupil, so the dori never blinks: its life is in where it looks. Every frame each eye's box swivels and its pupil slides across the eye's face (`src/tang.ts`). It scans the tank in saccades — quick jumps, then still — and turns to the viewer and holds their eye while it can reach them, the second eye a beat behind the first. Before it snaps at plankton both eyes converge on the speck. It never looks through the back of its head, nor at the camera it is riding in. `inspect()` reports what each dori is looking at, and how far off the viewer its eyes point.
  - **Moments of its own,** one every 10–18 s: snapping up plankton, a display (dorsal raised, fins spread, curled into a C, the tail flicked twice to flash the scalpel), a headstand at a cleaning station, backing off warily on its fins, and — rarely, briefly — playing dead on its side before righting itself with a kick. It holds still for them (the tank holds back its travel, then lets it catch up to where it would have been), so a headstand is a pose, not a glide, and a follower behind it stops too.
  - **The rig.** `breeds/rig/dori.py` rigs the delivered model without changing a visible voxel: its GPU-instanced marking is joined (36 doubled cubes dropped), its clashing material names are matched by colour, and each eye is rebuilt as one white box with its pupil one quad on its face — a sliding pupil uncovers white and shows no seam. The eye display (`eyeLife`) leaves the dori alone.
- a183559: The octopus — a new bundled breed (id 610), drawn in-house in the designer's voxel style and rigged in Blender.
  
  - **The model** (`breeds/rig/octopus-model.mjs`): a round mantle bulb leaning back, two big eyes low on its front with horizontal bar pupils, brow ridges, a siphon, eight arms that sweep round as they reach with up-curled pale tips, freckles, and glowing rings after the blue-ringed octopus.
  - **The rig** (`breeds/rig/octopus.py`): a crown, a head and a breathing mantle, a siphon, eight four-link arms hinged underneath and blended at their joints, eyes, pupils and brows as bones of their own; clips idle (an octopus's ~18 breaths a minute), crawl, jet, drift, tiptoe, wave, beckon, reach (a bend travelling down the arm), peek, ink, pounce, sleep.
  - **It moves three ways** (`src/octopus.ts`), a floor creature like the crab and the starfish: it crawls (sometimes sidelong — an octopus's heading is its own), jets mantle-first and pale, rising off the floor and parachuting back down — sometimes squirting ink first (`src/ink.ts`) — and walks backwards on its two rear arms, the other six coiled up. At a stop it looks at you, waves, beckons, reaches, peeks (pressed flat, eyes up on stalks), pounces (the web spread over), or naps — eyes shut, pale, its colours flickering as it dreams.
  - **Its pupils stay level.** An octopus's statocysts roll its eyes so the slit pupil stays horizontal however its body turns; every frame each pupil turns back against the body's roll (up to 80°). It rounds its pupils when excited, slits them when calm, has a favourite eye, closes its lids, and raises its brows.
  - **It changes colour.** Every octopus has a repertoire of its own — the coat the tank dresses it in and four rich colours (coral, violet, teal, gold, magenta, cobalt, lime…) — and every so often (at most stops, now and then mid-crawl) it changes among them, the new colour sweeping down it from the top of its head to its arm tips in about a second. Across a cast that is a lot of colour, always moving.
  - **Its skin changes:** pale in a jet and asleep, flushed when excited, fading toward the floor's colour when it sits still, and passing clouds — dark bands sweeping over it — when it hunts. Its rings glow brighter when alarmed. `inspect()` reports each octopus's doing, gaze, lids, and its pupils' and body's roll.
  - **Intake:** a breed may keep its bending faces unmerged (`mergeBends: false` — the octopus's arms bend every which way), and a quad that bends in one triangle finds its fourth corner's skin from its twin; every other breed is unchanged byte for byte.
- a183559: The bundled jellyfish is removed. It was a draft model and isn't part of the cast any more: its GLB, its lazy chunk and its catalog entry are gone. `fishMix: "jellyfish"` and id 607 are now unknown, so they're reported and dropped like any misspelt breed, and the rest of the scene plays. The other bundled breeds keep their ids (601–606, 608). The jellyfish lanterns of `skyLanterns` are separate built-in models and are unchanged.
- a183559: A new bundled creature: the starfish (`fishMix: 'starfish:3'`, id 609), the first breed drawn in-house in our designer's voxel style.
  
  - **The model.** `breeds/rig/starfish-model.mjs` draws it voxel by voxel: a five-armed star with a chunky disc, white eyes with black pupils and a black smile on top, dotted arms, and glowing tips (`GLOW-Tips`). Its coat is seeded per fish like every bundled breed.
  - **The rig.** `breeds/rig/starfish.py` rigs it in Blender: the disc and its face, two blinking eyes, five arms of three rigid links each, hinged on the underside so a curl closes its seams. Clips: crawl (a ripple running round the arms), idle, wave (a side arm, so the face stays in view), stand (up on two arms, face to you, a five-pointed star) and curl (every arm up round the disc).
  - **In the tank** (`src/starfish.ts`) it crawls the seabed face first and climbs the rocks, the crab's way: a closed form in t, its own pace, room for its neighbours (crabs included). When it stops it looks about, curls up, or turns to the camera to wave or stand.
  - **Glow that suits a floor creature.** The intake can split one glow material into a primitive per bone (`splitByBone`), so each tip is its own small light on its own arm and stays lit in the neon look; a glow material shared by several meshes is coloured once. A rig can set how much glow it throws (`bloom`): the starfish keeps its tips' bloom low lying down, so it doesn't light the floor like a lamp, and lets it rise as it stands.
  - **It stands up like a person** — our first character that does. Its front arms are legs, its side arms arms, the back arm its head. Some bouts it walks upright instead of crawling (it rises over its toes at the end of the stop before, and sits back down after), arms swinging, phased by distance (`mqWalkStride`).
  - **It dances.** `starfishDance: 'aerobics'` stands every starfish in the cast up in a class at the tank's centre, an instructor in front and rows behind facing the camera, dancing a routine in unison: march, jumping jacks, side reaches, kicks, twists, arm circles, the disco point and a spin, a bar each. `'freestyle'` gives each dancer its own move every eight counts. `danceTempo` (BPM, default 128) sets the beat and is integrated when steered, so a tempo glide stays on it. Every move starts and ends on the same standing pose (tested), so the routine cuts on the bar line.
  - **And it dances with a partner.** `starfishDance: 'duet'` is the Dirty Dancing number: couples side by side, face to face in a dance frame and cheated out to the room, dancing the basic (mambo), a cheek-to-cheek sway, a twirl under his hand, the dip, and the lift — they turn out to the room, she steps in front of him, and he raises her overhead, arms spread. Each role plays its own clip; every partner clip starts and ends on the same frame pose (tested). Light the couple with `spotRig` on slots 0 and 1.

## 0.13.0

### Minor Changes

- 9ad212f: The crab lives on the seabed now. It used to swim the floor band like a fish, rigid, nose first; it now walks on its own legs.
  
  - **A real rig.** `breeds/rig/crab.py` rigs the delivered model in Blender without changing a voxel of it: 23 rigid parts (body, eye stalks, claw arms and jaws, two-segment legs) and six clips — walk, idle, pinch, forage, wave, cheer. The intake carries the skeleton and clips through greedy meshing, part by part (1,482 triangles once buried faces are culled, down from 5,960).
  - **It walks like a crab.** Sideways, in an alternating tetrapod gait placed by two-bone IK, with the gait's phase set from distance so the feet never slide. It walks in bouts and stops: to pick at the floor and feed, snap its claws, wave a claw like a fiddler crab, cheer with both claws up, or just look around. For a wave or a cheer it turns to face the camera. Between bouts it sometimes turns all the way round, stepping as it goes.
  - **On the ground, over the rocks.** It stands on the terrain, on the boulders' real top surface (`ground.ts` rasterises their stone, so it neither hovers on a fish's padded dome nor sinks in), and on a low mound over a crystal colony, tilting with the slope. Crabs give each other room. A soft contact shadow sits under each crab, on the ground it stands on, so it reads as standing rather than hovering. A crab keeps its own pace: the global `swimSpeed` no longer hurries or slows it.
  
  Everything is a closed form in t, like the rest of the tank. Scenes without a crab are unchanged.
  
  The crab's mouth (and the dori's eyes) no longer flicker. The breed intake drops a body face that lies under an eye decal, but it keyed faces by an unsnapped plane, and the delivered models put the body a hair (0.0002) off the decal's plane, so the two stayed and z-fought. Planes snap to the lattice now; a breed test holds every voxel breed to no body face under a decal.
- 9ad212f: Flora: twelve new species (anemone, staghorn, brain coral, sea whip, barrel sponge, glow caps, sea pen, bubble algae, fiddlehead curl, orb pod, a giant clam and the elder blossom tree, the last two specimens capped per garden), and a `floraMix` param (`kelp:3, whip, seapen`). With `floraMix` empty the environment picks the garden: coral on a reef, kelp and whips in the kelp forest, tube worms and glow caps at the vent.
  
  Plants grow in colonies that share a colour, ramp from a deeper base to a brighter tip, and about one colony in thirty is a rare nacreous morph. Stony corals barely sway and clams not at all; anemone tentacles writhe from the crown. On mid and high tiers plants take the crystal pools and follow-spots (multiplied into their own colour, hue kept), and sheen gleams on tentacles, bubble algae and rare morphs. Pearls rise only off leaves; the shoal keeps above every plant, lit or not. Existing scenes with `floraDensity` > 0 grow a different, more varied garden.
  
  After No Man's Sky's flora: plants answer passing fish (anemone crowns fold, tube worms duck, sea pens pull down, pods swell, lamps flare), siblings may grow as their species' small form, and `floraPalette` (`world` or up to six `#rrggbb`) gives a garden one colour scheme. `floraLayout: gallery` plants one of each species (or each one `floraMix` names) in its own plot across the front of the tank, so every kind can be seen at once.
- 9ad212f: The glowfish fishes now, and the crab can go neon.
  
  - **A rigged anglerfish.** `breeds/rig/glowfish.py` rigs the delivered model in Blender without changing a voxel: the great lower jaw, a head that flips open on its back edge, a tail, two eyes that blink, and a three-link lure with the glowing bulb on its tip. Four clips — swim, lure, chomp, blink — driven by `src/angler.ts`: the tail beats with the distance swum; once a cycle it hovers nose-down, mouth agape, and fishes, dangling and twitching the bait; on some bouts it strikes, head flung open, lunging, jaws snapping shut; it blinks on its own clock.
  - **Its light lives.** The lure breathes slowly, beckons while it fishes and goes dark at the strike, then comes back — its bloom, halo and the light it throws all follow the lure as it swings (a glow part riding one bone is placed from that bone). Flash-safe by construction: never faster than 1.5 Hz.
  - **More colour.** The lure and the eyes no longer have fixed colours: each fish draws its own from the glow palette.
  - **Metal teeth.** A new `METAL-` role: a polished plate that takes the studio environment when lit, chrome when flat (`fishMetal: 'off'` keeps the authored colour). The glowfish's teeth wear it.
  - **`fishLook: 'neon'`.** The bundled creatures in blacklight: coats near black, the dark of the eyes — and a crab's mouth — glowing a seeded neon that blooms; small glow (a lure, a fin's accent) stays lit, while a glow part that is a big piece of the animal (a crab's claws) goes dark. Best in a dark room with `finish`. `natural` (the default) is unchanged.
  - **One Blender file for every rig.** `breeds/rig/common.py` is what rigs share; `build.py` puts every rig in one .blend, a scene per breed, and `export.py` ships a hand edit from it.
  - A crab's claw glow sat a little off the claws (its body stands off the fish's origin, and the glow placement ignored that); it is where the claws are now.
- 9ad212f: The hackerfish is half fish, half computer now: its face is a screen.
  
  - **A rigged hackerfish.** `breeds/rig/hackerfish.py` rigs the delivered model in Blender without changing a voxel: the monitor-head box, its screen (on a bone of its own, so it can rattle in its bezel), two paddle fins and a tail. Clips swim, type and glitch, driven by `src/hacker.ts`.
  - **A face that is a display.** A new `SCREEN-` role (`src/screen.ts`): the glass and the face pixels become one 10×10 phosphor display on the screen's front, the designer's own face its neutral expression, doubled. It changes expression every few seconds with a scan-down refresh — happy, wink, cool, love, surprised, sleepy — and the neutral face blinks. Once a cycle it hacks: a focused face, then code rain while its fins type. Some hacks end in a crash: the screen tears, shows x_x, boots with a spinner, and comes back happy. Each fish has its own phosphor (green, amber, cyan, the designer's pink, cold white), and the screen throws its light. Never more than three changes a second.
  - **`followAngle`.** Swings the chase camera round the followed fish (0 behind, 180 in front looking back at its face) — a hackerfish's screen, a crab's smile.
- 9ad212f: The shark hunts now, and the bundled voxel breeds got much lighter.
  
  - **A rigged shark.** `breeds/rig/shark.py` rigs the delivered model in Blender without changing a visible voxel, cut by position (its fins sit off the lattice): the head, a lower jaw ringed with metal teeth, eyes that roll back, the pectorals, and a three-link tail so the swim is a true wave down the body. Clips swim and bite, driven by `src/shark.ts`: the tail beats slow and heavy with the distance swum (it patrols by default), and on some cycles it strikes — snout up, jaw wide, eyes rolled back, the lunge, the snap, a thrash.
  - **One body, not three pieces.** The spine is soft: body vertices blend between neighbouring spine bones over a few voxels, so the bite and the thrash bend the shark instead of splitting it at the joints. The jaw rests nearly closed, and the thrash is spread down the whole body.
  - **Metal teeth that don't flicker** (the `METAL-` role, as the glowfish's). Lit metal is satin now (metalness 0.75, roughness 0.38, a little light of its own): a mirror-flat voxel face reflected one direction of the room and flipped white ↔ black as the jaw moved. Where two materials share a face of a cell, the intake keeps the smaller one, and eye, metal and kept parts get a polygon offset, so teeth and eyes never z-fight the body.
  - **Buried faces culled.** The intake drops every face that a whole cube sits right in front of. Some sources kept every face of every cube: the shark goes from 5,726 triangles to 3,476 (215 KB to 213 KB, soft spine included), the crab from 4,540 to 1,482, the dori from 1,692 to 452, the blowfish from 2,280 to 1,274, the hackerfish from 612 to 204. Every breed's visible surface is unchanged (compared cell by cell and in the breed lab).
  - **`followAngle`** now swings the camera round the fish's own heading, so a side or face camera stays square to a long fish too.
- 9ad212f: The town square and the floor. `fountain` (`vent` | `geode`) stands where the paths meet: a hot-vent chimney with a citrine-hot mouth, or a great geode basin on a plinth, with a bubble column, a pebble plaza, light that draws the fish and a vignette mark `fountain`. `streetLamps` sets slate posts with crystal crowns round the plaza and along the paths, each with a halo and light on the floor. Three carved `floorKind`s: `shelf` (the town on a plateau with a terraced lip), `trench` (a channel across the front) and `terraces` (tiers climbing behind), slope-shaded so their faces read. `inspect()` reports each fish's drawn height.
- 9ad212f: Wild geodes (`geodes`, `geodeMix`, `geodeMineral`, `geodeLayout`), four assets made properly: split geodes (one in three a thunder egg with a star core), amethyst cathedrals, crystal clusters and one mega cavern geode. Agate banding is drawn per pixel from a noise-warped band field; crystals are real quartz habit (hexagonal prism and point), scattered without a grid, colour-zoned root to tip, with facet highlights, a fresnel rim and druse that twinkles. Nine minerals and a rare iridescent aura morph; self-lit, so they read in a flat tank; crystals wake when a fish comes close. Geode homes get a multi-band agate rind; glow-cap gills are a ring under the cap.
- 9ad212f: Seahorses move like seahorses. The body wave is wrong for an upright animal, so seahorses were excluded from it and hovered completely rigid; their only clip moves the whole model.
  
  With `swimWave` on, a seahorse now gets its own rig (`seahorse.ts`):
  
  - **The dorsal fin** ripples: a fast wave runs up it, sideways with the rays flexing fore and aft, so it reads from any camera. It beats faster when the animal works.
  - **The prehensile tail** coils forward under the body and lets go on a slow, per-fish clock. It coils harder under effort (a maneuver, a turn), bending progressively toward the tip about the tail's root.
  - **The head** nods about the neck, and the whole animal rocks gently upright.
  
  It is a vertex patch in the fish's frame, the same shape as the swim wave, so eyes and glow shells move with the body. The anatomy is quoted as fractions of the shared seahorse geometry, which all forty tokens use, and a JS mirror of the GLSL tests it. At `swimWave` 0 nothing changes.
  
  The playground breed lab can now review motion: `/breeds.html?url=…&rig=seahorse&times=…` renders the rigged model at chosen moments, side-on, or with `&view=34` from behind; `&effort=1.9` shows a working animal.

## 0.12.0

### Minor Changes

- eaf84f7: The eight unminted creatures now swim anywhere the package runs, the wall included: shark, crab, jellyfish, dori, glowfish, babyfish, hackerfish and blowfish. Before this they only loaded in the playground, which served their models from its own folder.
  
  **What they are now.** Each breed is bundled in its own lazy chunk (`src/breeds/<breed>.ts`), so a scene pays only for the breeds it casts. There is no IPFS pin, no host asset route and no Draco decoder to serve. `fishMix` takes them by name or id 601–608 in the default catalog; they are species, so a count is copies.
  
  **What a new breed goes through.** They come in through a standard intake, documented in `breeds/README.md` and run by the `metaquarium-breed-intake` skill:
  
  - **Audit** each model and review it in the new playground breed lab (`/breeds.html`).
  - **Decode Draco, bake GPU instancing and node transforms, and join primitives by material.**
  - **Greedy-mesh voxel models.**
    - Merging happens across the swim axis only, so the body wave can't crack a face.
    - Eye primitives are left untouched.
    - Body faces lying under an eye decal are dropped.
  - **Decimate smooth ones.**
  - **Rename every material to the role the tank reads.**
  
  Results:
  
  | breed | triangles before | after |
  |---|---|---|
  | shark | 28.8k | 5.7k |
  | crab | 24.5k | 6.0k |
  | jellyfish | 13.5k | 2.5k |
  | blowfish | 9.4k | 2.3k |
  | hackerfish | 7.6k | 1.3k |
  | glowfish | 5.9k | 1.2k |
  | dori | 3.9k | 1.7k |
  | babyfish | 1.0k | 336 |
  
  Materials the tank couldn't read before now have roles:
  - **dori and hackerfish:** their materials were all `Material.00x`, which the tank painted a random patchwork.
  - **anglerfish (glowfish):** its red eyes would have been repainted as black pupils; they now glow.
  - **jellyfish:** it shipped fully metallic (black in dark rooms) and without normals; both are fixed.
  
  **Also new: the `KEEP-<part>` material role.** A part named this way keeps its authored colour; the hackerfish's screen and the shark's teeth use it. Any other unrecognised name still gets a random coat.
- eaf84f7: Fish come in sizes. **This changes the default look of every tank.**
  
  Before this change:
  - every model was normalised to one fish length, so a shark was the size of a babyfish;
  - the only spread was a five-step cycle by cast slot (0.8 → 1.2), so every fifth fish matched.
  
  Now a fish's length is four factors multiplied together:
  
  - **Its breed's nominal length** (`BREED_SIZE`): shark 2.2, seaturtle 1.35, crab 0.9, dori 0.9, hackerfish 0.85, seahorse, jellyfish, glowfish and blowfish 0.8, babyfish 0.45, minted betafish and angelfish 1.
  - **Its token's `*size`** in `fishMix`, for example `shark:1@patrol*1.5`. The range is 0.25–4; values outside it are clamped, and a malformed size is reported without dropping the fish.
  - **Its own seeded spread**, set by the new `sizeVariance` (0–1, default 0.5, smooth). The spread is log-symmetric: 0.5 gives about ×0.76–×1.32, 1 about ×0.57–×1.74. It is independent of speed, so `swimVariance` no longer changes size.
  - **`fishSize`**, a new global multiplier (0.3–3, default 1, smooth). Gliding it grows or shrinks the whole cast.
  
  Everything that spaced fish in one fixed body length now uses the actual fish's length:
  
  - **Formation seating:** a school spaces in its biggest member's lengths, so the no-pair-inside-a-body-length law holds at any size. A `ball` of big fish that the 57-unit water column would squash lays out as a flat sunflower disc instead.
  - **Bonds:** follow and chase lags, and pair orbits.
  - **Maneuver displacements.**
  - **The follow camera:** `followDistance` is now in minted-fish lengths of the followed fish, and so are the eye-view threshold and the camera lift.
  - **Spotlight shadows.**
  
  `inspect()` reports each fish's `size`.
- eaf84f7: Rocks look like the crystals burst out of them. **This changes the default look of every scene with `rockDensity` > 0**, because `rockVeins` defaults to 0.7.
  
  What was there before:
  - glowing lava rivulets running the length of each boulder, which from a low camera read as a spider's legs draped over the stone;
  - a few flat three-triangle "shards" at each crown, a different species from the real crystals beside them.
  
  What replaces them:
  - **A breach in each crown.** The stone is pushed down into a pit with a lifted rim, and angular chips of the same stone lie on the rim.
  - **Fractures:** a few short, dark splits, with colour only right at the breach.
  - **A real crystal colony.** Each rock grows a druse crust or a stand of spires from its pit: `growCluster` shards in the same geometry variants, material, pulse, fog and halo as `propMix`, rooted inside the stone and leaned with the crown.
  - **Host rocks:** a rock under a `propMix` cluster is broken open under that cluster and grows no colony of its own.
  - **The arch** is crowned the same way.
  
  The colonies are built as a second instanced crystal field driven by the same per-frame call:
  - no new shader programs;
  - about 7 extra draw calls;
  - no floor light: they join no pools, so night floors keep their colour.
  
  Fish clear each colony with its own clearance dome, except the arch's, which stands over the opening they swim through. More `rockVeins` means more rocks split, deeper breaches and bigger colonies. 0 is still plain stone.

### Patch Changes

- eaf84f7: The shoal's tetras no longer shimmer. Each slice of a shoal fish built its lateral line as a box 2 % wider than the body, laid over it: the stripe's side faces sat ~0.001 units off the body's and its slice ends were coincident with them, inside the depth buffer's resolution at viewing distance, so stripe and body fought pixel by pixel — a flickering comb of blue teeth along every neon (and a torn silver line on rummy-nose and ember). The back, lateral line and belly are now three bands stacked flush with no overlap; the look is otherwise identical (same colours, same bands, same vertex count, no shader change). A geometry test now fails on any pair of same-facing faces that are coincident or within 0.01 units with overlapping extent.

## 0.11.0

### Minor Changes

- 9f38cfd: Caustics: a new `caustics` param (0..1, default 0) throws the surface's dancing net of light over the floor, rocks, plants and fish, and `causticScale` sizes the cells. The net is procedural, two layers of animated Voronoi F2−F1 edges, and averages about 1, so it moves light around rather than brightening the scene. It projects down a slightly slanted sun and softens and dims with depth below the water surface, which follows the ceiling. It is strongest on faces that look up and absent underneath, with the face normal taken from screen derivatives, so it works on every material. It modulates the lit colour, the floor's light pools included. The low tier uses one layer. Rates divide a 20-minute window, so long uptime stays exact. At 0 the stock programs compile.
- 9f38cfd: The finish: a new `finish` param (0..1, default 0) adds one full-screen pass over the finished frame. It gives a gentle grade: a touch of S-curve contrast, +8 % saturation, cool shadows, warm highlights and a soft vignette. It also adds ±1 LSB triangular dither against banding on 8-bit TV panels, and restrained bloom on the high tier. The scene draws to the canvas exactly as before. The pass copies that frame and works in display space, so the tank's hand-rolled shaders and additive glows are untouched. It is mid and high tier only, and `finish: 0` skips the pass entirely.
- 9f38cfd: The water's light on the fish. The new `fishAmbient` param (0..1, default 0, lit mode only) lights fish the way a lit tank does:
  - their backs take the bright water above;
  - their flanks take the water around them;
  - their bellies take the floor below;
  - metal plates mirror all three, weaker, since they already reflect the studio.
  
  The colours come from the scene each frame: `waterTint`, else the surface or the shafts, the in-scatter, and the floor, with more bounce when caustics are on. They dim with a follow-spot's house lights, so a spotlit stage stays dark outside the spot. It applies only to coats and plates, never eyes or glow parts, and includes the shoal.
- 9f38cfd: `cameraFollow` + `followDistance` — ride with one fish. The camera sits `followDistance` behind the chosen cast slot along the way it has been swimming (the chord to where it was two lengths back on its own closed-form path, so a wiggle or a kick does not swing the shot), lifted a little, looking just past it; kept above the floor and any scenery and under the water ceiling. Under about one body length it becomes the fish's own eye and the fish is hidden. Everything is sampled closed-form at `t`, so the shot is the same however a frame is reached. The orbit params are ignored while following; `-1` (default) is the orbit camera, byte-for-byte as before. `inspect().camera.follow` reports the camera's position.
- 9f38cfd: Living bubbles, all opt-in (defaults unchanged). `bubbleStyle: 'live'` puts the vents on a real bubble life: each bubble grows at the mouth, lets go, rises in a widening helix, sits at the water surface (when the environment has one) and pops. A vent coughs, and goes quiet for a minute or two now and then. `pearling` grows oxygen beads on the flora's leaves over half a minute or more; they ride the leaf as it sways, then let go. It needs `floraDensity`. `co2Mist` adds a fine haze of tiny bubbles and soft puffs drifting from the vents on a slow current. Distant bubbles dim instead of fattening into 3-px dots, and bubbles under ~3 px draw as soft beads. Everything is closed-form in one draw call. Periods divide a 20-minute window, so long uptime stays exact.
- 9f38cfd: One caustic system. The surface net, the follow-spot's web, the light shafts, the water's surface and the crystals now all read the same caustic function, on the same clock and cell size.
  
  - **Follow-spot pools** draw the shared net in place of their own sine web. A spot inside caustic-lit water shows one pattern, not two. The web keeps moving even when `caustics` is 0.
  - **Shafts** brighten where the net focuses at the surface above them, with slow bands running down them.
  - **The water's surface**, seen from below, carries the net, and its far edge fades into the water instead of drawing a line to the horizon.
  - **Crystal shards** take a glass share of the net.
  - **Light sources are no longer lit:** fish glow parts, eyes, lantern cores, the horizon, glowing veins and flora lamps opt out.
  - **Layer count** is now a uniform the tier sets, not a shader macro, and the shared functions are include-guarded. Patches stack in any order.
  - **Visible change:** with `caustics` 0 everything is as before, except the follow-spot's web, which now uses the shared net's look.
- 9f38cfd: The shoal gets its own clock and swims in open water.
  
  - **Own speed:** `shoalSpeed` (0.3–2, default 0.8) sets how fast the school travels, independent of `swimSpeed`. It glides when steered. The school's life (tail beats, breathing, excursions) runs on real time, so a slow scene no longer has a near-frozen school.
  - **Above the plants:** the school keeps above a precomputed canopy of ground, rocks, crystal domes and every plant's tip plus its sway. Each fish stays at least 1.2 body lengths clear, and the school rises ahead of a tall kelp bed. It gets a taller height band of its own (the surface less two lengths, at most 110).
  - **In front of the camera:** with a still camera the school follows a crossing lane across the front of the shot. With an orbiting camera it follows the figure of eight.
  - `inspect().shoal.inView` reports the share of the school inside the frame.
  - **Look change:** scenes that already use `shoal` will see the school higher, in front, and at its own pace.
- 9f38cfd: The shoal: a new `shoal` param (0..1, default 0) adds an ambient school of small voxel fish beside the cast, and `shoalKind` picks `neon`, `rummynose` or `ember`. Seats are relaxed at seed time into an even, row-free school. Each fish follows the route at its own distance along it, so the school bends through a turn instead of pivoting. They beat in burst-and-coast with a body wave, and now and then one drops back, rises or slips out to the side and returns, at most three at a time. Headings follow the route, steered by each fish's own motion. A stateless separation pass keeps fish at least 0.8 body lengths apart. It is closed-form in t and one instanced draw, with up to 2.5× the tier's fish cap. `inspect()` reports the count, the fish out, the nearest pair and polarisation.
- 9f38cfd: Named shots. A new `shot` param cuts between framings:
  - `orbit` (the classic camera, exactly, and the default)
  - `hero` (three-quarter establishing)
  - `front` (level, long lens)
  - `low` (among the plants, looking up)
  - `top` (steep, the floor as a map)
  - `surface` (looking up at the water's underside)
  - `macro` (close on the biggest landmark near the front)
  
  Azimuth and autoRotate still turn a shot, and distance scales it. Shots stay inside the water, never above the surface or under the floor. The follow camera still takes precedence. `inspect()` now reports `render: { programs, calls, triangles }` and the current `shot`.
- 9f38cfd: The surface mirror. A new `surfaceMirror` param (0..1, default 0) makes the water's surface, seen from below, a window straight up to the light and a rippling mirror of the tank everywhere else. That covers Snell's window (about 48.6° either side of straight up), total internal reflection outside it, and Fresnel in between.
  
  - **High tier:** it reflects the real tank. The tank is drawn once more from a camera reflected in the surface, at half size into a corner of the canvas, then copied into a texture. That keeps the same shader programs and the same display-space blending. An oblique near plane clips the reflection at the surface. The pass is skipped whenever the mirrored tank can't be on screen, and latched off for good if the pixel governor has to drop.
  - **Mid tier:** it reflects the lit water with no second render. **Low tier:** off.
  - **Tint:** with a water tint, the reflection takes the lit in-scatter the light really travels through.
  - **Where to use it:** it needs reef, kelp, ice or lagoon, and pays off on the `surface` and `low` shots.
- 9f38cfd: Swim wave: new `swimWave` param (0..1, default 0). Fish bend as they swim: a wave runs from nose to tail, beating with distance swum and working harder in a flurry, and the body curls into turns. It replaces the rigid yaw and the angelfish's whole-node clip while on; the turtle, seahorse, crab, jellyfish and skeleton-rigged fish keep their own motion. At 0 the stock programs compile and nothing changes. `inspect()` reports `waving` per fish. Shader patches now stack through a shared helper, so the eye display and the wave survive each other.
- 9f38cfd: Water clarity and tint, and the environment palettes finally apply.
  
  - **`waterClarity`** (0..1, default 0.5) only acts when `water` is on, and 0.5 is exactly the water as before. At 0 the water is murky: red and green go fast and the reach closes to ×0.7. At 1 it is clear: colour loss relaxes and the reach stretches to ×1.5.
  - **`waterTint`** (`#rrggbb`, empty = off) is the sunlit water.
    - Distant things fade into it looking up toward the light, half of it on the level, and none of it looking down into the deep.
    - The background becomes a dome shaded with the same function, so the far fade and the background agree.
    - The crystals and the horizon take the same in-scatter.
    - With `water` on and no tint set, reef, kelp, ice and lagoon bring their own.
  - **Palette fix (visible change):** the environment palettes (fog, floor, mote colours for abyss, reef, kelp, ice, vent, lagoon and universe) never applied, because every param arrives pre-filled. They now apply wherever a scene leaves that colour at its default and no track steers it. Scenes on those environments that don't set their own colours will change colour on this release.
- 9f38cfd: `water` — water instead of fog. Each colour channel fades toward the water colour over its own span: red first (40 % of the fog span), green next (70 %), blue last on today's exact curve, so a red fish goes blue-green before it goes into the murk and everything still meets the background at `fogFar`. 0 (default) is today's fog to the bit. Installed per material, lazily (the first time water is on), wrapping any existing shader patch and extending its program key; the crystal, halo and glow-card shaders share the same function (additive layers take only the loss, never the in-scatter).
  
  `dither` (default `off`) — three's output dither on every material: ±½ of an 8-bit step, the cure for banding in dark fogged gradients on TV panels. Off by default only because turning it on recompiles every material once; recommended alongside `water`.

## 0.10.0

### Minor Changes

- db21004: Jellyfish are glass. The flotilla is drawn three times from one geometry — the lit cores opaque, the shells into depth only, then the shells' colour blended — so a bell is see-through to its own lantern and to the water (and the fish) behind it, but never to its own inner voxel faces. Face-on it is nearly clear, at a grazing edge solid and bright, lit from inside (more on the squeeze), with a faint film of colour in the rim; lines stay nearly solid and the far giants fainter. Behaviour: each jelly is thrown upward by its squeeze and sinks until the next (a quick rise, a long fall), and beats at its own rate — small bells quicker, the far giants slow. Two extra draw calls for the whole sky.

### Patch Changes

- 971f03e: Fixes for the 0.9.0 mineral-world release, found in post-merge review:
  
  - `vignette`: `follow` onto a mark (not another actor) now reports a
    validation problem instead of silently doing nothing; a `circle` beat
    combined with `>mark` no longer leaves a stale position that teleports
    the actor at the next beat boundary.
  - `recipeTrack()` now returns the `program`/`seed` fields its `ControlTrack`
    return type promises, so a recipe can be published directly.
  - Crystal floor light pools now use the emitter's full `reach` (was scaled
    by `0.55`), matching the light field fish and other geometry sample.
  - A fish spawned before the tank's first material-mode reconcile now gets
    the correct lit/flat material immediately, instead of momentarily
    defaulting to flat regardless of `fishLighting`.

## 0.9.0

### Minor Changes

- 5e911f5: Crystals — the first scenery prop, generated from the seed and instanced
  (`propMix: "crystal#hero:1@lotus/hotpink, crystal:5@druse"`). Habits `lotus`
  (the original cluster's measured 1/6/9/16 rosette), `spire`, `druse`,
  `scatter`, and a branching `coral`; `crystalWild` makes every cluster an
  individual — leaning, bald on one side, lopsided, two-toned, branching — the
  way no two coral heads match. Palettes follow the room, a named colour, `rainbow`, or `glass`.
  Nothing is fetched: a scene of clusters is ~5–10k triangles in seven draw
  calls, where one original crystal GLB was 39.6k.
  
  A closed-form light field lights without lights: crystals shade from their
  own facets, glow through a halo shell and one card per cluster, throw
  pulsing colour pools on the floor, and (opt-in, `crystalTint`) tint fish that
  swim past. Fish ride over clusters instead of through them. New params:
  `propMix`, `envProps` (off by default — a room only brings its own crystals
  when asked), `crystalScale`, `crystalWild`, `crystalGlow`, `crystalPulse`, `crystalTint`.
  `inspect()` reports every cluster. An empty `propMix` builds nothing and
  compiles the stock floor program, so published scenes are unchanged.
- 8fc8ab5: Fish `GLOW-*` parts are light sources now. `fishGlow` (default 0.6) gives every
  glowing fish a soft bloom card that spills over its own body (one instanced
  draw for the whole cast — still no composer), a white-hot breathing core, and
  colour thrown on the floor beneath low swimmers through the same light field
  the crystals use; with `crystalTint` on, glowing fish tint their neighbours
  too. A glow part that is the whole silhouette keeps its colour and blooms
  fainter, and unsaturated glows never bloom as grey fog. `fishMetal` (default
  on) renders metallic plates with a generated chrome matcap — reflection with
  no environment map and no lights — instead of a flat unlit atlas. `fishGlow: 0`
  and `fishMetal: off` restore the previous look exactly: at 0 every glow core is
  written back to its authored colour and holds it, no bloom, no breathing (with
  `fishLighting: flat`, below, for the original unlit tank).
  
  `fishLighting` (default `lit`): fish take light. A key and a fill shade every
  voxel face by where it points; a generated studio environment (prefiltered once,
  nothing fetched) gives PBR metal something to reflect; and a fixed pool of point
  lights (4 / 3 / 0 by tier) rides the glow parts nearest the camera, lifted
  toward the lens so a glowing fin colours the body beside it. Bloom is now one
  card per glowing part, in that part's colour. `fishLighting: flat` is the
  original unlit tank.
- 96baf08: The mineral world: opt-in scenery layers that turn a tank into a place, all
  generated from the seed (nothing fetched), all batched, all motion a pure
  function of the tank clock. Nothing is on by default — every layer is 0, and
  the one non-zero default, `rockVeins` (0.7), only applies once `rockDensity`
  is above zero — so existing scenes are unchanged.
  
  - `geodeHomes` (0–3) — real geodes: a displaced boulder broken along a jagged
    plane, an agate rind, a throat of inward crystal teeth, and a voxel house
    recessed inside (round door, lit window, lamp, steps, a chimney that vents
    bubbles). Three habits — cottage, hall, tower. Each home is a warm emitter in
    the light field.
  - `interior: geode` — sets the whole scene INSIDE a geode home: a dome lined
    with thousands of small crystals over agate strata, a plank floor and rug, and
    the inhabitants' voxel furniture (bed, tea table, bookshelf, stove and kettle,
    reading corner, round door and window, chandelier). Its lights are emitters in
    the light field and wear bloom cards; the fish swim the room.
  - `rockDensity` (0–1) + `rockVeins` (0–1, default 0.7) — boulders, a ridge and an
    arch, fractured by fissures cut from the stone's own facets, with forks, a
    white-hot core and crystals pushing out of the crack.
  - `floraDensity` (0–1) — three voxel species (kelp, reed clumps, lantern bulbs)
    that lean toward and take the colour of their nearest crystal, with a gust
    that travels across the field.
  - `bubbleVents` (0–1) — puffs from chimneys, fissure crowns and crystal bases;
    bubbles quicken, swell and wander as they rise.
  - `marineSnow` (0–1) — slow snow lit by the crystals it falls through.
  
  The world's one rule: minerals are faceted, the living and the made are voxel.
  
  `vignette` — small scripted scenes for two or three fish. A script of beats in
  which actors `a b c` (the first fish of the cast) go to the space's named marks,
  face each other and take turns at gestures (`talk nod shake hop spin wiggle bow
  peek rest`, plus `circle` and `follow`): a visitor is met at the door and sat
  down to tea; lamps out and bed; hide and seek for three. Presets `tea`,
  `bedtime`, `seek`, or write your own. Closed-form and looping (a closing beat
  walks everyone home), so it is frame-addressable like the rest of the tank;
  `inspect()` reports what each actor is doing. Zero-dep parser exported from
  `/manifest` for server-side validation.
  
  `followSpot` — a stage follow-spot on one fish: a soft beam from the rig, a pool
  of moving caustics where it lands, a light riding with the fish, and the house
  lights brought down by `spotStrength`. `propMix` tokens take `*size` (0.3–8) for
  castle-scale crystals planted past the swim space.
- 14cd2aa: `skyLanterns` — the sky motif. Voxel jellyfish lanterns drift in the water overhead, pulsing as they rise and sink, with a few hanging far out as fogged silhouettes. One draw call, moved entirely in the vertex shader; they borrow the scene's crystal colours and join the light field. Glow cards now lift toward the lens along the view ray, so a bloom sits on its source at the edge of frame too. Bubbles are properly round (the wobble no longer clips on the sprite's square) with fresnel rims sized in pixels.
  
  `horizon` — the far distance. Three hazed rings of silhouettes past the fog line: rock spires, castle-sized crystals in the scene's colours and (from 0.4) one grand geode with its door lit. Unlit, one draw call; drawn as light added to the water colour, so it reads on a black ocean and a bright one alike.
  
  Flora moves again, at no frame cost: the sway is an S-curve that climbs the stalk (kelp snakes, grass flutters), gusts cross the garden and bow each plant as they pass, a band of light runs up every plant and flares its lamp on arrival, and the lamps shed rising spores (one extra Points draw).
  
  `landmark: castle` — the one thing bigger than everything else: voxel curtain walls and six drum towers roofed with glowing crystal spires, a lit gatehouse, banners, a paved road between lamp posts to a round plaza, and a grand geode for a keep. Two draw calls; its spires, gate and lamps join the light field. Bubble highlights now sit at a per-bubble bearing and slide as the bubble wobbles.
  
  `spotRig` + `spotCues` — a rig of up to three follow-spots (`0/#ff8ad0*26, 1/#7fdcff`), each on its own fish in its own colour, and a looping cue sheet (`8s:a, 8s:b, 12s:a+b, 4s:-`) that cross-fades solos, duets and blackouts. Pools add where they cross. New open-stage vignettes `duet` and `trio` ship with matching sheets (`VIGNETTE_CUES`), and a vignette can now send actors to the world's own marks (a castle's `gate`, `plaza`, `courtyard`). `followSpot` alone behaves as before.
  
  `landmark: citadel` — the castle's two-storey version: a wider outer ward, and inside it a raised terrace with its own crenellated ring, four taller spired towers, a stair up from the courtyard, and the keep on top.
  
  Geode homes publish door marks (`home1`…, and `home1in`… inside the throat), so a vignette can send a fish home: out of its own door, to the middle of the village, and back in.
  
  `eyeLife` (default 0 — the stock eye program, byte for byte; a scene opts in with 1) — the eyes are alive, and pixel-true. A survey of the breeds found every minted eye is a tiny voxel GRID (3×3 betafish and seahorse, 3×2 angelfish, 2×2 sea turtle), one voxel deep, whose black/white pattern is the token's own (`eyes` is an ASCII-glyph trait). So the rig never moves a vertex: both eye materials run one fragment function that knows the grid and redraws the token's pattern — the pupil a whole cell toward where the fish looks (only if the eye HAS a pupil: a compact rectangle; glyph eyes keep their identity), lids closing row by row from top and bottom to a lash line, a ring-wider pupil for a hop, a `^` for delight. Black and white only. Blinks on a personal clock, idle saccades, eyes on whoever a vignette has the fish facing, a glance at the camera. The grid is recovered from geometry alone (thin axis, not winding or face area: mirrored halves, whole-cube meshes and a turtle's turned head all read correctly); one-colour eyes and models without eye materials are left untouched. At `0` the stock program is compiled, untouched.
  
  `spotShadow` (default 1) — a spotted fish casts its shadow in its own pool: a body and fanned tail seen from above, turned with its heading, larger and softer the higher it swims. It dims only its own lamp, so a second spot crossing the pool fills it in.
  
  Jellyfish pass: bells are domed SHELLS with lit windows and radial stripes; the squeeze snaps shut and eases open, and rolls from crown to rim; arms and lines hear the beat late (the lower, the later), stream in behind the surge and drift apart between beats; the animal leans into its drift; three species (lantern, moon, comb) in one flotilla; lines read as beaded lines. `skyHeight` (default 1) sets how high the flotilla rides — ~0.3 brings it down among the houses.
  
  For agents — `./manifest` now exports a zero-dep guide: `PARAM_DOCS` (one line per param; a test holds it to the param space), `RECIPES` (ten named, channel-safe scenes: geode-harbor, moonlit-grove, castle, citadel, commute, stage-duet, stage-trio, follow-spot, tea, jellyfish), `recipeTrack()` (a recipe as the control track `publishScene` takes), `GRAMMAR` (fishMix · propMix · spotRig · spotCues · vignette, with the marks), and `validateMetaquariumParams()` — every DSL parser at once, for publish advisories. The playground mounts every recipe as-is on a "recipes" shelf.
  
  Geode home fronts rebuilt, and kept plain: a round door in a ring of dressed stone — painted boards with a brass knob dead centre — under one awning in the same paint; a lighter plank wall; one framed window (two on a hall); a lantern beside the door; cheek walls on the steps. Each home's paint is the cottage colour furthest round the wheel from its own crystal (an orange geode gets a blue door).
  
  `paths` + `pathMaterial` — layout. A walk from the real foot of every home's steps to a village hub, a road from the hub to the landmark, and (above 0.5) trails out to the big crystals: meandering, seeded, routed round obstacles. With a castle, its paved road is the spine: each door joins it at the nearest point on its own side, and the homes stand either side of it, facing it. Painted by the floor's own shader, so paths lie on any terrain and cost no geometry — and laid as TILES on the castle paving's grid (coverage is decided per tile, with a dark joint and a lit lip), so they step like the rest of a voxel world instead of smearing across it. Mostly algae-green slabs, paler where walked, with the odd stretch of grey cobbles or sandstone flags, and some walks change part-way. Nothing grows on a walk, a road or a plaza. Adds the vignette mark `hub`.
  
  A small white GLOW part is a lamp: the glowfish's angler lure (`GLOW-White`) now blooms, a touch warm. (Bloom is earned by saturation so that white COATS do not fog a fish; a few voxels of white cannot, so they are exempt.)

## 0.8.0

### Minor Changes

- 52669c8: Lofi backend: the Apple TV's 2D aquarium, in the browser.
  
  `createMetaquarium({ backend: 'lofi' })` mounts a Canvas2D tank instead of
  three.js: every fish's `_transparent_icon.png` swimming a layered After Dark
  aquarium — water gradient, light shafts, dunes, swaying kelp, rising bubbles.
  It is a port of `AquariumField.swift`, down to the Mulberry32 stream, so one
  seed lays out the same tank on a browser and a TV. That makes it a QA surface
  for the tvOS renderer as well as a nostalgia mode.
  
  - Reads the scene's `environment` (the TV's room palettes) and `fishMix`
    (parsed with the engine's own DSL, so any of the 512 minted icons, not the
    TV's bundled 15). Breed motion carries over: turtles' top-down icons turn to
    face travel, seahorses sway upright.
  - Never loads three.js — its own lazy chunk.
  - Icons go through the gateway ladder and decode from a Blob, so the canvas is
    never tainted and thumbnails keep working.
  - Reads only `environment` and `fishMix` and always swims 8 fish (13 on
    high-tier devices), as the TV does; other params are no-ops in lofi.
  - Opt-in and host-side. Not a scene param: a published channel means the same
    thing whichever backend a screen chose. The playground exposes it as
    `?lofi=1`.

### Patch Changes

- f668083: Bump `three` to `^0.186.0` (r186). On a 0.x package the caret does not span
  minors, so consumers resolve r186 only once this ships. r186 removes nothing
  metaquarium imports (no `PCFSoftShadowMap`, minified or CommonJS builds); the
  changes touching the classes it uses are fixes and additions.

## 0.7.2

### Patch Changes

- 8a989d4: Four additive schema features, all opt-in — a spec that omits them renders exactly as before.
  
  **Field background.** A seeded value-noise sampler as a background type, rendered
  once into a cached low-res raster and stretched, so a full-frame texture costs a
  blit per frame rather than per-pixel work. Perceivable and steerable like any
  other background; `inkOverBed` advises against the bed's own seed.
  
  **Finish.** A grain-and-dither screen over the finished scene — the print-finish
  pass. It presents on its own canvas so it never feeds ghosting's persistence
  buffer, and its paths are steerable, so the grain is paint rather than a fixed
  post-effect. Its grain seed resolves the same way the scene's does, which is what
  keeps `renderFrame(t, seed)` frame-addressable with a finish attached.
  
  **`rotate`.** Static per-entity rotation. `spin: [0, 0]` zeroes the angular
  velocity but does not hold the seeded angle, so there was no way to ask for
  "tilted, not spinning" — `rotate` is that.
  
  **`SequenceInstance.hotSwapSequence`.** Publish a new sequence into a running
  instance without remounting: the swap happens in place and the retained control
  track survives it. Structural edits are refused rather than silently accepted,
  since those genuinely need a remount.
  
  Also ships the `thermal-field` example — six riso bands, warped and drifting,
  wearing the grain-and-dither finish — as the worked demonstration of both new
  background and finish paths.
  
  **metaquarium (patch).** `LogicalClock` now tracks paused state explicitly. A
  sample taken before the first `resume()`, or while paused, advanced the clock
  because `origin === null` cannot distinguish "just resumed" from "still paused" —
  both leave it null. Frozen until resumed now.

## 0.7.1

### Patch Changes

- 4bfcd9e: Tank lifetime: skip rendering after dispose, scope Draco workers to in-flight
  decodes, keep the logical clock running across pause/resume, and apply camera
  rotation from the steered azimuth. Paired with the size-ladder schema patch
  in the same develop train (#144).

## 0.7.0

### Minor Changes

- ffcf882: `fishMix` tokens can carry their own swim style — `id[:count]@style` (`457:3@hover,257:6@school,497:1@surface`) — so one tank holds several behaviours instead of a monoculture. Untagged tokens follow `swimStyle`; an unknown style is reported as a problem and the fish swims on the scene's style. Formation seats are allotted over the fish whose effective style forms, so a `@school` trio in a hovering tank is a school of three. New `expandFishMixSlots` carries the per-slot style; `expandFishMix` is unchanged.
- f43fb23: Behaviour pack 2 — fish that know other fish, and a tank that can describe itself.
  
  - **Relationships**: three new swim styles bond a fish to the nearest preceding unbonded fish in the mix. `follow` rides its leader's route in a file, `pair` orbits a shared point with its partner, `chase` closes on its leader and falls back, tail working hardest as it closes. Bonded fish swim in their leader's depth band, so `seaturtle:1@surface, angelfish:3@follow` is a turtle with an escort at the surface. Closed-form: a follower is the leader's own curve sampled at a lag.
  - **`swimStyle: 'auto'`**: each untagged fishMix token swims the way its breed does (seahorse hover, turtle skim, angelfish school, betafish drift; the NPC set mapped too). A token's `@style` still wins; unknown breeds loop.
  - **`lightSeek`** (0–1, default 0): free fish are drawn toward the room's light shafts, each to its own pool by a per-fish appetite. Staging follows the light.
  - **`formationBreathe`** (0–1, default 0): the school relaxes outward and draws back on a ~15 s cycle. Only ever expands, so the no-pair-inside-a-body-length law holds.
  - **Proximity startle**: free fish now flinch in a wave from a sentinel fish, delayed by ground distance (the formation wave already did this by seat). A startle no neighbour answers is not a startle.
  - **`pathShape: 'crossing'`**: a camera-relative parade lane — across the frame in front, back the other way behind, laid against `cameraAzimuth` when the shape is chosen. The procession that used to be an orbit hack.
  - **`formationShape: 'wheel'`**: the ring tilted, so it reads as a wheel from a side camera instead of a flat line. A new shape — `ring` itself is untouched.
  - **Idle sway**: station-keeping styles (hover, drift) turn in place while holding station instead of pointing rigidly down a loop they barely travel.
  - **`inspect()`**: the tank reports its frame in numbers — camera, room, cast by style, each fish's breed/style/bond/seat/position/heading and whether a maneuver is displacing it, maneuver activity, centroid and spread. The analytic perception a classic saver never had.
  
  Every new param defaults to the previous behaviour; `loop`, the formations' spacing, and every published scene render as before.

### Patch Changes

- Updated dependencies [f43fb23]
  - @idle-screens/core@0.4.7

## 0.6.0

### Minor Changes

- f204739: Maneuvers have shapes now, not just distances. A QA pass proved every maneuver reduced to "a fish moved further than the others" in stills. Now: `graze` pitches nose-down over the substrate (a pitch term applied after the band level-lock, which had zeroed exactly the styles grazers live in) and sinks 3x deeper; `startle` is contagious in formations — one shared event propagating through the lattice as a wave at seat-distance delays, with the kick scaled 1.8x so scattered fish clear the seating instead of landing on another seat; `zoomies` gets a real dwell between its three surges (the seams were zero-width velocity minima — invisible); `hover` un-freezes (speedMul 0.2→0.55; two multiplied slowdowns had pinned fish to a fixed screen position); the permanent advance is scaled per fish so histories genuinely diverge; and `maneuverRate` extends to 3 — above 1 shortens the interval, breaking the 14-20s legibility ceiling the old cap baked in. Values ≤1 mean exactly what they always did.
- 4336460: A minted fish is an individual: no token id appears twice in one scene. Counts now cast DISTINCT fish — `300:12` is twelve different angelfish (the named id plus its nearest unused breed neighbours), `betafish:5` five spread across the range — so every school keeps its population and gains variety. A named id that collides with an earlier token gets a "swims instead" advisory; an exhausted breed clamps with a problem. Custom catalogs are exempt (closed worlds; NPC entries are species). Enforced in the shared zero-dep parser, so the tank, the playground, and the server all inherit it.

### Patch Changes

- 395cf2a: Engine-side frame capture: `SaverInstance.capture()` snapshots the current frame as an ImageBitmap, covering the two cases page JS cannot read — worker-transferred canvases (new `capture`/`captured` verbs in the worker protocol, correlated by id, with the element's worker proxy implementing `capture()` end to end) and WebGL canvases in hidden tabs (metaquarium renders a fresh frame and reads it in the same task, before the non-preserveDrawingBuffer buffer is cleared by presentation). Hosts that upload viewer thumbnails or answer on-demand capture requests should prefer `instance.capture()` when present.
- 7d26f97: Environments are distinct places now. A QA pass measured vent, universe, and kelp rendering byte-identical (0.000 pixel difference) — shared floor kind, one terrain seed, no palette. Every named environment now carries a room palette applied only where the author left fog/floor/mote colors untouched (an authored color always wins), and its own terrain seed. Light shafts are rebuilt to span the tank instead of the light source (vent's shafts sat entirely under the seabed; rayStrength 0→1 measured 0.07/255 — a dial that did nothing), fade peaking in the fish band, and are built even at strength 0 so later steering works. Terrain relief is baked as vertex-color lambert shading (flat→dunes was 2.6/255, hills nobody could see). Single-layer wedges droop their wings so the V reads in 3D.
- 0b510e2: The anchor rule that spreads a cast along its route at mount is now a named function (`anchorFraction`) with a test, instead of an inline condition. No behaviour change — it is the same rule that shipped in the live-QA fix — but the earlier version of it exempted every `travel = 1` style, so patrol, bottom and surface mounted as one knot dead-centre and took minutes to disperse. The existing tests all passed while that was happening: they covered the per-fish hash, and the bug was in how the tank used it. The new gate asserts the rule the tank actually calls, over every style in the catalogue.
- 52e44ad: Terrain you can see, wedges that stack. `dunes` had 571-unit swells — less than one in frame at any camera, so it rendered as a smooth tilt (a QA A/B showed identical rooms with only ridges showing relief); wavelengths now put 2-3 swells in the visible footprint, and `basin` gains a near-floor ripple. Stacked wedges get wing droop too (centred on the mean rank so the vertical extent never grows), with a tighter multi-layer pitch so three Vs plus droop fit the water column. Light-shaft alpha retuned 0.34→0.13 and cones narrowed — with the shafts finally in frame, the pass-1 alpha turned ice into white pyramids.
- Updated dependencies [395cf2a]
  - @idle-screens/core@0.4.6

## 0.5.1

### Patch Changes

- 31e53ba: Glow halos no longer ghost. Shell push was proportional to the glow PART's bounding sphere, and the crystal-finned breeds carry a glow part larger than their body — the shells became a displaced double of the whole fish, visible on the wall as a smeared shadow. Push is now quoted against the whole model (~1.5%/3.5%, under one voxel, so cube-normal face separation is subpixel), and a whole-silhouette glow part gets a single faint veil instead of a bright double.

## 0.5.0

### Minor Changes

- eb8d3ae: Choreography: three orthogonal layers agents compose over any scene, every default a no-op. `pathShape` picks where a fish's loop lives (`wander`, `orbit`, `eight`, `helix`, `canyon`) — five waypoint generators on one spline engine, steerable live with in-place plan recompilation. `formationShape` picks how a school holds together (`phalanx`, `line`, `ring`, `wedge`, `ball`) — five seating charts under one tested law: no two seats inside a body length, at any count or variance. `maneuver` + `maneuverRate` + `maneuverIntensity` give each fish a seeded schedule of recognizable events (`dart`, `startle`, `graze`, `curious`, `zoomies`), displacement-based so every frame stays a pure function of (t, seed).
- 63c7e4c: Material-aware lighting and the unminted breeds. Eyes render unlit pure white/black (the GLBs ship them as 0.8-gray PBR that the hemisphere light dimmed); glow color follows the material — authored emissive first, the color the name spells second, seeded pick last — with selective bloom via additive normal-pushed shells, no composer; metallic atlases (glTF default metallicFactor 1.0 renders black unlit) become unlit basics wearing the same texture; NPC PrimaryColor/SecondaryColor coats are a coherent seeded two-tone. All eight unminted breeds (blowfish, hackerfish, glowfish, babyfish, shark, crab, jellyfish, dori) ship as `NPC_CATALOG` with synthetic ids — resolvable wherever a host serves the bundled GLBs, honestly "not hosted here" elsewhere.

## 0.4.1

### Patch Changes

- 0969daa: fishMix parse problems are no longer silent: the tank warns once per mix change (with a note when the mix fell back to fishUrl/fishCount), and a count above 24 now clamps to 24 instead of discarding the whole token. `parseFishMix` still records the clamp in `problems`, so validators can surface it.

## 0.4.0

### Minor Changes

- b2a6ab5: Environments — the tank as a room. An `environment` param names a place (`void` is exactly the pre-environment scene, so the default changes nothing) and builds it from three tier-budgeted layers: a rippling water ceiling that makes the scene read as *under* something, procedural terrain (`dunes`/`ridges`/`basin`, generated from the mount seed — no assets, no network), and volumetric light shafts that can come from below. Overrides: `floorKind`, `waterY`, `rayStrength` (-1 = follow the environment). Everything is closed-form in `t`, so `renderFrame(t, seed)` stays frame-addressable; the room rebuilds only when its inputs change, and a weak device drops the shafts before the ceiling.
- 92fb13c: Swim styles: a curated `swimStyle` enum (`loop` — the pre-style behaviour, so the default changes nothing — plus `school`, `drift`, `hover`, `patrol`, `bottom`, `surface`), with two uniqueness dials rather than per-fish authoring: `swimVariance` (0 a uniform shoal, 1 every fish visibly its own animal) and `bodyWiggle`, a distance-driven body yaw for the many models that carry no animation clip and were previously gliding rigidly. Both default to 0, like every param this saver adds: a scene already on a wall does not move differently because a dependency was bumped.
  
  `school` is a closed-form carrier formation — one arc sample per frame, fish held at rigid offsets from it. Measured over 4 seeds x 600 frames at 8 fish and variance 0.6: independent loops put a neighbour inside one body length in 27.8% of fish-frames (closest approach 1.3 units, polarisation 0.38); the formation reaches 0.0% (closest approach 27.3 units, polarisation 1.00). The spacing half of that is a unit test, so the claim is enforceable rather than remembered. Earlier drafts of this changeset quoted 0.85 polarisation from the boids spike — that number described the prototype, not this port.

## 0.3.0

### Minor Changes

- 4697d39: Draco support: many Metaquarium models are `KHR_draco_mesh_compression`-required and were silently rendering as fallback blobs, because `GLTFLoader` without a decoder fails deep inside parse with no usable signal. The package now ships three's own gltf decoder in `dist/draco/` (no CDN, works offline on the native hosts), sniffs the GLB container so the decoder is only instantiated when a model actually needs it, shares one decoder per page, and exposes a `dracoPath` param for hosts that serve it from their own static path. Hosts that rebundle this package into a single chunk must copy `dist/draco/` next to that chunk or set `dracoPath` — `import.meta.url` will not find the decoder inside `node_modules`. Unlocks the ~30x-smaller model variants (shark 62KB vs 2MB).
- b1c537c: The farm, in-house (`./farm`): a static 512-entry asset-CID manifest plus breed ranges, trait vocabulary and pure URL builders — `fishAssets(85)` resolves every asset for any minted token with no AWS call, no metadata round-trip and no third-party resolver on the path to a frame. `fishMix` now accepts **any** token id 1–512 (`"2,85,124,234"`), not just the six curated entries, and knows the eight designed-but-unminted breeds (blowfish, hackerfish, glowfish, babyfish, shark, crab, jellyfish, dori) for future tank life.

### Patch Changes

- cc2b980: Gateway resilience (MQ21): `ipfs://` fish URLs now resolve through an ordered gateway ladder (`resolveIpfsUrls`) with a per-gateway timeout — one flaky gateway degrades to the next instead of to a fallback blob — and a slot that did spawn as a fallback gets one delayed heal retry that swaps in the real fish when the load recovers. Also: every package's core peerDependency is now `workspace:^`, so publishes emit a caret range instead of an exact pin (mixed-version installs of sibling savers previously failed npm ci with ERESOLVE).

## 0.2.0

### Minor Changes

- 1204859: Atmosphere pack, no composer: `fogNear`/`fogFar` (the previously hardcoded Fog(60, 500) becomes steerable), `moteDensity`/`moteColor` (seeded plankton drifting closed-form in the vertex shader — one time uniform, zero CPU per frame, tier-capped 400/250/120), and `floorColor`. Every default reproduces the pre-atmosphere constants exactly, so existing scenes are pixel-identical until steered. The package `demoTrack` is now a 40s looping tour of every steerable feature.
- 1204859: `fishMix` — mixed breeds in one tank. One steerable string param (`"257:3,100:2"`, catalog token ids or breed aliases, absolute counts, tier-capped), parsed and validated by the zero-dep manifest module so servers can check it without three.js. Non-empty mix overrides `fishUrl`/`fishCount`; bad tokens degrade instead of blanking the tank. Population changes (mount, growth, url swap, mix) now flow through one want-based reconcile that respawns only changed slots, and `createMetaquarium` accepts a `catalog` override — the seam for local assets and future GLB packs.

### Patch Changes

- 1204859: Hardening pass (Phase 0 of the overhaul): fish identity keys off the spawn slot instead of GLB-arrival order (prerequisite for mixed breeds); steered `swimSpeed` glides via the closed-form speed-curve integral instead of teleporting; teardown disposes only tank-owned GPU resources (template-shared geometry and eyes materials are never touched; per-clone skeleton boneTextures now freed); the fish pool allocates what `fishCount` asks and grows on demand as documented; tracked numbers clamp to their declared range and coerce stringified values.
- Updated dependencies [1204859]
  - @idle-screens/core@0.4.5

## 0.1.0

### Minor Changes

- 374814d: New saver package `@idle-screens/saver-metaquarium`: a three.js (WebGL2) port
  of Metaquarium (metaquarium.xyz). Hero mode stages one real textured NFT
  betafish center-stage in a dark, fogged, selective-bloom tank; seeded analytic
  swim makes `renderFrame(t, seed)` frame-addressable; the farm/IPFS pipeline
  (with per-fish media envelope), the original's material name-prefix contract
  (seeded Miami-Vice coats for untextured breeds, authored atlases preserved),
  HDR emissive normalization, device-tier quality scaling, and a canvas-2d
  never-blank fallback. Zero-dep `./manifest` subpath for server-side param
  validation.

  core: `ParamType` gains `'string'` (snaps like enum — asset ids, token lists),
  and `SaverContext.params` carries initial paramSpace overrides at mount (the
  seam a channel's published `{id, params}` scene mounts through).

  core: graceful runtime-fault ladder — when the active saver throws in its
  loop (GL crash, bad frame), the `<idle-screen>` element swaps to the saver
  configured as `crashSaverId` (the BSOD, fittingly) instead of freezing on a
  black rectangle, falling back to a built-in flash-safe DOM fault screen when
  that saver is missing, is the faulted saver itself, or faults too. Engine
  gains `pluginById(id)`. The screen stays a screen; any key still wakes.

### Patch Changes

- Updated dependencies [374814d]
  - @idle-screens/core@0.4.4
