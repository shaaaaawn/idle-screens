# @idle-screens/saver-metaquarium

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
