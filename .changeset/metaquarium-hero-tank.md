---
'@idle-screens/core': patch
'@idle-screens/saver-metaquarium': minor
---

New saver package `@idle-screens/saver-metaquarium`: a three.js (WebGL2) port
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
