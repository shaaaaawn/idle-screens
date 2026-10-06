# @idle-screens/core

## 0.4.7

### Patch Changes

- f43fb23: `SaverInstance.inspect?()` — an optional synchronous state dump (plain JSON, a few KB) that says what a pixel capture cannot: which objects exist, where they are, what behaviour is in flight. Worker savers answer it over new `inspect`/`inspected` protocol verbs; the mounted `SaverInstance` the element hands out exposes `inspect()` (the last answer, null until one has arrived) and `inspectAsync()` (a round trip, 2 s timeout), and `<idle-screen>` itself carries the same two as conveniences that forward to whatever is mounted (null when nothing is).

## 0.4.6

### Patch Changes

- 395cf2a: Engine-side frame capture: `SaverInstance.capture()` snapshots the current frame as an ImageBitmap, covering the two cases page JS cannot read — worker-transferred canvases (new `capture`/`captured` verbs in the worker protocol, correlated by id, with the element's worker proxy implementing `capture()` end to end) and WebGL canvases in hidden tabs (metaquarium renders a fresh frame and reads it in the same task, before the non-preserveDrawingBuffer buffer is cleared by presentation). Hosts that upload viewer thumbnails or answer on-demand capture requests should prefer `instance.capture()` when present.

## 0.4.5

### Patch Changes

- 1204859: `integrateParam` — closed-form ∫₀ᵗ of a tracked number param's curve, mirroring `sampleTrack`'s exact ramp semantics (dur-ramps, previous-keyframe ramps, step/linear/smooth eases, loop wrap). For savers that multiply a rate by a steered param: integrating the curve makes rate changes glide instead of rescaling all elapsed motion, while staying pure and deterministic — `integrateParam(space, track, path, t, bounds?)`, same inputs, same integral. Optional `bounds` clamps the curve's keyframe values to a declared range (endpoint clamping bounds the whole curve, since every ease is monotone). For number params, `sampleTrack` now coerces finite numeric-string keyframes and ignores junk values — the stringified-`value` MCP trap previously made "22" step as a string instead of meaning 22.

## 0.4.4

### Patch Changes

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

## 0.4.3

### Patch Changes

- f0831ef: Add optional `SaverManifest.description` and fill it on every classic saver so hosts (e.g. MCP `listSavers`) can catalog from the package instead of a hand-maintained id list.

## 0.4.2

### Patch Changes

- bae7b6b: `SaverManifest.timeModel` (`'closed-form' | 'simulated'`) — a semantic claim
  about how the saver relates to time, so tooling can prefer it over hardcoded
  per-saver capability lists. Catalog savers declare theirs; the playground
  properties panel surfaces the claim.

## 0.4.1

### Patch Changes

- 3a10f2c: Raise the `@preact/signals-core` floor from `^1.8.0` to `^1.14.4`.

  It is a real runtime dependency of this package, so the floor is what consumers
  actually install — worth stating rather than letting it drift silently in the
  lockfile. No API change; `^1.8.0` and `^1.14.4` resolve to the same major.

## 0.4.0

### Minor Changes

- 072780b: **core:** new optional `SaverInstance.composition(): SaverLayer[]` — a mounted
  instance can describe its practical composition stack, bottom-up: the `page`
  deck a passthrough saver performs on (host-bound; the saver only borrows the
  document), the `surface`(s) it owns, and the logical draw `pass`es inside
  them. Deliberately distinct from the schema's declared sprite layers, and
  deliberately small: multi-surface savers, per-pass toggles and cross-saver
  scenes extend this model rather than replacing it.

  All four deep passthrough savers (catwalk, tide, limelight, slipstream) now
  describe their stacks. The playground's Layers panel renders the stack for
  any mounted saver — compositor-style, top deck first, with eye toggles that
  solo decks for inspection (hide the page, keep the performer; hide the
  overlay, watch the pure page deformation).

- 072780b: **savers-classic — Messages consolidated and modernized.** The two hard-coded
  CSS keyframe ports ("Out to Lunch" and "Macintosh") are now two `mode`s of ONE
  canvas saver. `messages2` is removed (its behaviour lives on as
  `mode: 'drift'`). The new saver is closed-form in `t` (the timeline scrubs
  it), worker-ready, typeset on a modern system stack instead of 1992 Times New
  Roman, and carries 7 typed params (`phrase`, `mode`, `speed`, `textScale`,
  `ink`, `glow`, `trail`) plus a demo track. Classic 19 → 18 savers.

  **core — `SaverManifest.attribution`.** Savers derived from licensed or
  third-party work now declare their lineage in the manifest itself
  (`source`, `license`, `url`), so every surface that showcases a saver can
  show its license. All ten After Dark-descended savers and Mystify carry it;
  the playground shows Source/License rows in Properties and a line in the
  fullscreen preview. CREDITS.md remains the full ledger.

  **schema — Control Center rebuilt as a real ops wall.** The example is now
  VIREO-9, Trans-Lunar Relay Operations: framed zones, three dish arrays with
  live signal bars, a cislunar orbital plot with a five-craft fleet on orbit
  motion (trails + hairline chain links as the relay web), telemetry with a
  hero signal readout, an event log, an alert chip, a relay-load meter and a
  pass schedule — booted in stages, composed deliberately against the 36-layer
  ceiling. (Entity-stream snapshot regenerated: the spec change is the point.)

## 0.3.0

### Minor Changes

- 7c68846: Worker/OffscreenCanvas rendering for canvas savers (`workerReady`, generation-token mount races fixed); new savers (pipes, bsod, flurry, fluid, reaction-diffusion, mystify) with WebGPU dual-path where applicable and WKWebView GPU skip; schema v2 primitives (alpha, blend, region, pulse, soft) plus published SaverSpec JSON Schema + FORMAT.md; live steering via `applyTrack` on compiled specs (`steer` helpers exported); host-owned fallback slot on `<idle-screen>` (`slot="fallback"` when mount fails); `previewAt` hook for timeline-driven previews; security: prototype-pollution guard in `resolveSpecPath`, `validateSpec` gate on track deltas, worker mount clears fallback class

## 0.2.0

### Minor Changes

- 9fa2a68: Add Worker/OffscreenCanvas rendering, new savers (pipes, bsod, flurry, fluid, reaction-diffusion), and schema extensions (static motion, positioning, text alignment, dashboard support)
