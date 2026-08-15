# @idle-screens/saver-metaquarium

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
