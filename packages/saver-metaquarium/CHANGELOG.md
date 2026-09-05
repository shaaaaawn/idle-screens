# @idle-screens/saver-metaquarium

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
