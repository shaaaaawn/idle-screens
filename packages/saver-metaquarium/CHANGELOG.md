# @idle-screens/saver-metaquarium

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
