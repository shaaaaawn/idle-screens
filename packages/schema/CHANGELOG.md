# @idle-screens/schema

## 2.4.0

### Minor Changes

- 9dcfba7: Perception overhaul for non-vision authoring + spin ranges

  - **Additive-glow calibration**: `luminanceGrid`/`perceiveScene` coverage now models the halo of soft circles drawn with `blend: lighter`/`screen` (previously hard-edged, which badly under-reported glow-heavy scenes), so coverage tracks the live canvas far more closely. The spread constant is a first pass pending live calibration.
  - **Geometry-aware dominance**: thin-but-bright structures (rings, streaks, link lines) get a line-salience boost in `dominanceRanking`, so they register instead of vanishing behind filled discs.
  - **Higher-resolution density map**: new `renderDensityMap(grid)` — one ASCII density char per cell, 1:1 with the grid. Pair with a larger `cols`/`rows` (e.g. `{cols: 120, rows: 48}`) for a sharper read than braille; also exposed as `perceiveScene().density`.
  - **Text listing**: new `textSprites(spec)` / `perceiveScene().text` reports the literal strings and rendered sizes of text layers — glyphs are invisible in the luminance maps.
  - **`spin` accepts `[min, max]`**: per-entity seeded rotation speed (confetti, tumbling debris, foliage), parallel to `speed`/`alpha`. Existing scalar specs produce byte-identical entity streams (the range form draws one extra seeded value only when present).

## 2.3.0

### Minor Changes

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

## 2.2.0

### Minor Changes

- 3a4a5bd: Trails, background drift, and authoring improvements

  - **Trails** (`trail: { length, fade? }` on layers): afterglow behind moving entities, sampled analytically from past positions with wrap-seam break. Zero impact on RNG streams.
  - **Background drift** (`drift: { period, amount? }` on gradient backgrounds): slow sinusoidal oscillation of gradient stop positions with per-stop phase offsets.
  - **Comets example**: new spec showcasing trails + drift with 3 layers (stars, comets, fireflies).
  - **Density scaling**: `describeScene` and `adviseSpec` improvements for coverage-based advisories.
  - **Steer export**: `steerablePaths()` now exported for MCP/server consumption.
  - **Validation warnings**: `validateSpec` now returns non-blocking `warnings[]` for unknown properties, misplaced properties (e.g. `blend` inside sprite → "move it up one level"), common renames (`id` → `key`), and near-zero speeds. Helps MCP/server surface actionable feedback to LLM authors.
  - **Security**: esbuild override to 0.28.1, top-level permissions on release workflow.

## 2.1.0

### Minor Changes

- cf2591b: SaverSpec format upgrades: multi-color circles (colors[]), glyph/text cycling (cycle.period), inter-entity links (links with k-nearest toroidal neighbors), viewport-relative units, sparse-scene advisory, constellation example saver, and toroidal link drawing fix.

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
