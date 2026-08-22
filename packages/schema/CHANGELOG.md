# @idle-screens/schema

## 3.4.5

### Patch Changes

- bc403ec: core `peerDependency` is now `workspace:^` so publishes emit a caret range instead of an exact pin. Mixed-version installs of sibling savers previously failed `npm ci` with ERESOLVE. (`saver-metaquarium` ships the same change in the gateway-resilience changeset.)

## 3.4.4

### Patch Changes

- 1204859: Sequence resize now persists into the child mount context. `SequenceInstance` creates its per-segment `SpecInstance` children lazily (first rAF tick, segment cuts, morph finalization), and `resize()` only forwarded to children that already existed — the new dimensions were forgotten for every child created afterwards. A viewer that mounted in a hidden or unpainted tab (0×0 viewport) stayed a 1×1 canvas forever, and any segment cut after a resize snapped the shared canvas back to the stale mount-time size.
- Updated dependencies [1204859]
  - @idle-screens/core@0.4.5

## 3.4.3

### Patch Changes

- b12c902: Grid layers are exempt from viewport count scaling. Scaling a grid's count
  doesn't thin it like a scatter field — it truncates the lattice row-major, so
  on sub-reference viewports an 18-column single-row grid rendered only 12 cells
  and stopped at two-thirds width while the analytic perception path showed it
  full-width. Grids now always build their authored count in both directions
  (no truncated rows on small viewports, no phantom cells on large ones).

## 3.4.2

### Patch Changes

- 8d8973b: Auto-default `sprite.color` from `colors[0]` when missing (F3)

  Before validation, if a sprite declares `colors[]` but omits `color`, default
  `color` to `colors[0]`. Applies in both `validateSpec()` and per-segment scene
  normalization in `validateSequence()`.

## 3.4.1

### Patch Changes

- Updated dependencies [374814d]
  - @idle-screens/core@0.4.4

## 3.4.0

### Minor Changes

- fdefb61: Add `textBlock.reveal` — animated typing/deleting via one steerable paint param

  Optional `reveal` on textBlock sprites: `{ progress, mode: "typewriter", speed, caret }`.
  Layout always runs on the full text; reveal only masks which glyphs are painted, so
  alignment stays stable as text types. Steer `reveal.progress` (and optionally `speed`)
  live via setParam — agents can glide to 0, swap `text` while invisible, then reveal again.

  ***

### Patch Changes

- d9c0d3b: Fix idle-sequence black canvas — SequenceInstance now self-drives via rAF

  Sequences mounted but never painted in live viewers: SpecInstance runs its own
  requestAnimationFrame loop, SequenceInstance did not. Add the same
  start/stop/loop clock, keep child SpecInstances parent-driven (never forward
  pause=false to children — that double-scheduled rAF), and prefer seq.seed for
  the outer clock seed.

## 3.3.0

### Minor Changes

- 55a51d8: Add morph segue transition and adviseSequence

  Morph segue: sequence boundaries where adjacent segments share a structural
  signature now support smooth paint glides (colors, backgrounds) instead of
  hard cuts. Chained morphs use chain-root seeding for continuous entity
  placement. Falls back to cut when structures differ.

  adviseSequence: cross-segment advisory for validated sequences — boundary
  luminance jump detection, morph structural mismatch warnings, and
  per-segment adviseSpec propagation.

## 3.2.0

### Minor Changes

- f4aecf9: Add `idle-sequence` envelope format — multi-segment timelines over SaverSpecs

  New top-level format for composing multiple SaverSpecs into a sequenced
  timeline. Each segment carries an unmodified SaverSpec, a duration, and an
  advance mode (`auto`, `input`, or `either`). Global time `T` maps to
  `(segmentIndex, localT)` via prefix sums; the final segment may omit duration
  to hold indefinitely. `loop: true` wraps the timeline.

  `compileSequence()` returns an ordinary `SaverPlugin` — the viewer needs zero
  changes. The instance lazily mounts child SpecInstances and delegates
  `renderFrame(T, seed)` to the resolved child. Segment switching via
  `applyTrack` uses the `sequence.segment` path, so existing `setParam`
  machinery becomes the clicker with no new server verbs.

  Transitions are `cut`-only in v1 (`fade` rejected at validation). Flash safety
  is preserved: the minimum segment duration (1000 ms) prevents strobing cuts.
  The `advance` field is validated but not wired to runtime behavior — timer and
  input drivers are planned for a follow-up.

- f4aecf9: Add `textBlock` sprite kind — deterministic multi-line text blocks

  New sprite variant for multi-line text that wraps within a `maxWidth` boundary.
  All dimensions (fontSize, maxWidth) are viewport fractions of `min(w,h)` so
  blocks scale with the display. `units: 'px'` specs with textBlock sprites are
  now rejected at validation time (textBlock is viewport-fraction only).

  Line breaks are computed from a fixed character-class metrics table (narrow,
  normal, wide buckets) so wrapping is identical across platforms — no
  `measureText` in the layout path. Supports `align` (left/center/right) and
  `lineHeight`. Perception (`textSprites`, `luminanceGrid`, `dominanceRanking`)
  reports textBlock layers analytically.

## 3.1.1

### Patch Changes

- Updated dependencies [f0831ef]
  - @idle-screens/core@0.4.3

## 3.1.0

### Minor Changes

- bae7b6b: New `low-contrast-layer` advisory: catches a layer painted too close to its own
  background to be seen. `invisible-layer` only measures radius × alpha, so a
  full-size, fully-opaque layer in a background-matched colour previously passed
  every check in `adviseSpec` — nothing in the perception surface read colour
  against the plate behind it.

  The measure is a **colour distance, not a luminance one**, and that distinction
  is load-bearing: equal-luminance/contrasting-hue is a real technique, not a
  mistake. A pointillist field of golden `#e8c060` dots over a pale grey-blue
  ground differs by only 0.013 in luma and is perfectly visible — a luma-based
  test flags exactly the screens it should leave alone. Additive layers
  (`lighter`/`screen`) are judged instead by the light they add, since a
  background-matched colour still brightens the plate under those blends.

  Alpha and radius are deliberately excluded so that deliberately faint
  atmospheric layers — a pattern the format guidance recommends — are not
  flagged; that axis belongs to `invisible-layer`.

  Also extracts the shared luma/colour helpers into `luma.ts`, since `perceive`
  already imports `advise` and the dependency can only run one way.

- bae7b6b: Persistence-aware perception: `luminanceGrid` (and everything built on it —
  braille/density maps, coverage, meanLuminance, centroid, transects,
  `diffScenes`, `perceiveScene`) now models `ghosting` and `trail` analytically
  instead of ignoring them. Ghosting splats decayed past frames (ink from m
  frames ago at weight g^m, mirroring the renderer's bounded warm-up replay);
  trails mirror `drawTrail`'s past-position sampling with decaying alpha and
  shrinking radius. A spec at `ghosting: 0.9` no longer perceives identically to
  `ghosting: 0` — the smear agents are told to reach for is finally measurable
  without a renderer. `dominanceRanking` counts the same persistence ink as
  swept ribbons, so a comet layer is ranked by its comet rather than its head.
  Specs without persistence produce byte-identical grids to before.

### Patch Changes

- Updated dependencies [bae7b6b]
  - @idle-screens/core@0.4.2

## 3.0.1

### Patch Changes

- 3a10f2c: Fix a denial of service in font-size parsing (CodeQL `js/polynomial-redos`).

  `compileSaver` matched the size token in a CSS font shorthand with
  `(\d*\.?\d+)px`. Two quantifiers can split the same digit run many ways, so a
  run that never reaches `px` made the engine retry every split at every start
  position. `sprite.font` is authored input, which makes this reachable by
  anyone who can publish a spec:

  | `font` value   | before  | after |
  | -------------- | ------- | ----- |
  | 1 000 digits   | 600 ms  | <1 ms |
  | 5 000 digits   | 62 s    | <1 ms |
  | 200 000 digits | (hours) | 4 ms  |

  The digit runs are now bounded, making the work per start position constant.
  No behaviour change for real font shorthands — `16px`, `16.5px`, `.5px`,
  `bold 26px monospace` and `12px/1.4 system-ui` all parse exactly as before.

- Updated dependencies [3a10f2c]
  - @idle-screens/core@0.4.1

## 3.0.0

### Minor Changes

- 072780b: Add Nostalghia's Candle schema example — Tarkovsky-inspired single-flame devotion scene.
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

- 072780b: Scale absolute `px` font sizes with the viewport in normalized specs.

  A spec using the default `units: 'viewport'` expresses every dimension as a
  fraction of `min(w, h)`, but a `sprite.font` carrying an explicit px size was
  used verbatim — so `bold 26px monospace` rendered at 26px whether the canvas was
  1920 or 320 wide. In a small viewport the text stayed full size and overlapped
  itself, which is what made `DASHBOARD_SPEC` unreadable as a thumbnail.

  Explicit px sizes in such specs are now scaled by
  `min(w, h) / referenceViewport`, matching how the rest of the spec adapts.
  Measured on `DASHBOARD_SPEC`, thumbnail-vs-fullsize ink coverage moved from
  6.5× to 0.93× (1.0 = proportional).

  Specs that opt into `units: 'px'` are asking for absolute sizes and are
  unaffected. No bundled example uses `units: 'px'`, so nothing in the shipped
  catalogue changes except the dashboard rendering correctly at small sizes.

### Patch Changes

- Updated dependencies [072780b]
- Updated dependencies [072780b]
  - @idle-screens/core@0.4.0

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
