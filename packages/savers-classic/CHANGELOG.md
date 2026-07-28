# @idle-screens/savers-classic

## 4.0.0

### Minor Changes

- bae7b6b: Mystify and pipes join the closed-form classics: both compile a per-run plan
  and evaluate it at `t` (fold vertices + ghost trails for mystify; epoch pipe
  network for pipes). Typed params, demo tracks, and deterministic
  `renderFrame(t, seed)` coverage land with them.

### Patch Changes

- bae7b6b: `SaverManifest.timeModel` (`'closed-form' | 'simulated'`) — a semantic claim
  about how the saver relates to time, so tooling can prefer it over hardcoded
  per-saver capability lists. Catalog savers declare theirs; the playground
  properties panel surfaces the claim.
- Updated dependencies [bae7b6b]
  - @idle-screens/core@0.5.0

## 3.1.0

### Minor Changes

- 3a10f2c: The first artist-workshop batch: five classics brought up to the full modern
  kit (typed params, closed-form `renderFrame(t, seed)`, exported demo tracks,
  worker-ready where canvas-only), with their original motion signatures
  preserved exactly.

  - **Bouncing Logo (`dvd`)** — `dvd` + `logo` consolidated into one canvas
    saver (`logo` id retired). Marks: generic dvd wordmark / idle-screens /
    diamond / ring — drawn, never trademarked assets. Wall-hit hue steps and
    corner celebrations are ANALYTIC (hit counts from floor(t/period)), zero
    accumulated state, zero RNG. Now worker-ready.
  - **Warp** — closed-form starfield (per-star identity from `rng.fork(i)`,
    progress pure in t). The classic spawn pop-in is gone: a smoothstep alpha
    envelope, continuous through the recycle wrap. Params: density, speed,
    tint, streak, twinkle (shimmer ≥800ms, flash-safe).
  - **Globe** — kept 0.9 rad/s spin, 90 px/s bounce, 21/11 lattice as defaults.
    Aliasing fixed: dot scatter → polyline strokes at 0.85/dpr with
    back-hemisphere depth fade and an additive limb glow. Params: density,
    spin, bounce, wire, glow, depthFade.
  - **Fade Out** — rebuilt from CSS onto canvas: seeded per-cell thresholds
    (row/col-salted forks — resize never re-rolls surviving cells) dissolve and
    reform the field; dissolve/scan/blinds patterns; every cell eases over
    ~200ms of phase, spread across the cycle by construction (flash-safe by
    math, not luck). The 40s Fade Away leg is preserved.
  - **Flurry** — trail converted from accumulated pixel fades (unseekable) to
    analytic look-back sampling of the same closed-form arm path. Params:
    arms, speed, glow, trail, palette (aurora/ember/mono/spectrum), size.

  Pause/resume keeps its place. The closed-form loops these savers moved to
  derive logical time from the rAF clock, and `start()` re-anchors that origin —
  correct at mount, but it made the first frame after every `setPaused(false)`
  render logical time zero, so pausing and resuming (or toggling reduced motion)
  snapped Warp, DVD and Flurry back to their opening frame and restarted any
  applied control track. The frozen time is now carried across the re-anchor.

  Classic catalogue: 19 → 18 savers (logo folded into dvd).

### Patch Changes

- Updated dependencies [3a10f2c]
  - @idle-screens/core@0.4.1

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
