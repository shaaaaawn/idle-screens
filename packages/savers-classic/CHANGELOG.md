# @idle-screens/savers-classic

## 3.0.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [072780b]
- Updated dependencies [072780b]
  - @idle-screens/core@0.4.0

## 2.0.1

### Patch Changes

- 3a4a5bd: v1-ceiling spec surface, perception module, and bug fixes

  **@idle-screens/schema (minor):**

  - **New sprite kinds**: `ring`, `streak`, `rect` with stroke width, gradient tails, and aspect ratios.
  - **New motion types**: `orbit`, `wander`, `warp`, `path` — orbiting parents, Brownian wander, depth-mapped warp stars, waypoint paths.
  - **Ghosting**: frame-persistence smear (`ghosting: 0..0.95`) with deterministic warm-up replay on seeks.
  - **Trails**: afterglow behind moving entities, sampled from past positions with wrap-seam break.
  - **Background drift**: slow sinusoidal gradient oscillation.
  - **Layer lifecycle**: `life: { enter, exit, fade }` for staggered layer fade-in/out.
  - **Links**: inter-entity connections with `nearest`, `chain`, `random` wiring modes.
  - **Pulse wave**: position-derived phase offsets for organic breathing.
  - **Grid layout**: regular grid spawning instead of random scatter.
  - **colorWeights**: weighted random color selection.
  - **Perception module**: `perceiveScene()` — renderer-free analytical scene analysis (luminance grid, braille map, dominance ranking, motion stats) for non-vision LLM agents.
  - **5 new example specs**: aurora, matrix-rain, polygons, night-procession, warp-tunnel.
  - **Bug fixes**: CSS font shorthand ordering, negative speed validation, perceive ring/rect area, cross-platform determinism snapshots.

  **@idle-screens/capabilities (patch):**

  - Test typecheck fix (canvas element casting).

  **@idle-screens/savers-classic (patch):**

  - Test typecheck fix (explicit `this` parameter).

## 2.0.0

### Minor Changes

- 7c68846: Worker/OffscreenCanvas rendering for canvas savers (`workerReady`, generation-token mount races fixed); new savers (pipes, bsod, flurry, fluid, reaction-diffusion, mystify) with WebGPU dual-path where applicable and WKWebView GPU skip; schema v2 primitives (alpha, blend, region, pulse, soft) plus published SaverSpec JSON Schema + FORMAT.md; live steering via `applyTrack` on compiled specs (`steer` helpers exported); host-owned fallback slot on `<idle-screen>` (`slot="fallback"` when mount fails); `previewAt` hook for timeline-driven previews; security: prototype-pollution guard in `resolveSpecPath`, `validateSpec` gate on track deltas, worker mount clears fallback class

### Patch Changes

- Updated dependencies [7c68846]
  - @idle-screens/core@0.3.0

## 1.0.0

### Minor Changes

- 9fa2a68: Add Worker/OffscreenCanvas rendering, new savers (pipes, bsod, flurry, fluid, reaction-diffusion), and schema extensions (static motion, positioning, text alignment, dashboard support)

### Patch Changes

- Updated dependencies [9fa2a68]
  - @idle-screens/core@0.2.0
