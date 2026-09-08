# @idle-screens/schema

## 3.6.1

### Patch Changes

- acd6078: FORMAT.md: a measured scale section. `radius`, text/emoji size, `speed` and
  `links.maxDist` each get a ladder of landmarks at 1920×1080 — px figures,
  `perceiveScene` coverage, and how long a given speed takes to cross the frame —
  plus four named recipes (parallax depth, glow stacking, graph web, focal pin).
  Scale intuition was the biggest blind spot for agents authoring against this
  format; every number is measured rather than estimated. Docs only, no
  behaviour change.

## 3.6.0

### Minor Changes

- cb1c4fd: Data layout — the dashboard genre stops needing one layer per number
  (idle-mono registry #49):
  
  - **`layout: { type: 'list', gap? }`** and **`{ type: 'table', columns, gap? }`**
    place a layer's entities in reading order — one column, or `columns`
    row-major — `gap` apart (viewport units of `min(w,h)`, default 0.06), from
    `position` as the block's top-left anchor (now allowed with any `count`
    under these layouts) or centred in `region`. Text and emoji sprites take
    `strings[i]` / `glyphs[i]` in order instead of a seeded pick, and palette
    `colors[i]` likewise, so N labels are one layer. The layouts burn the two
    scatter draws, so toggling one on or off leaves the rest of the layer's
    stream intact.
  - **`bar`** sprite — `{ values, length, thickness, color, max?, direction? }`.
    Entity i draws `length × values[i] / max` toward `direction` (`right`
    default, `left`, `up`, `down`). `values` are paint, read at draw time, so
    `setParam("bars.values", [...])` glides every bar; `max` defaults to the
    largest value. Perception measures each bar at its current value.
  - New advisory warning `list-length-mismatch` when a data layout's `count`
    disagrees with the number of strings / glyphs / values it will read.
  
  New shipped example `relay-board`: a six-row status chart in five layers —
  labels, bars, readouts, a title and a dust field — where the benchmark
  dashboards averaged twenty-five hand-positioned `count: 1` blocks. Existing
  entity streams are byte-identical.
- 01a6e80: `density: 'sparse' | 'normal' | 'dense'` — a declared density intent on the spec, the way `motionIntensity` declares tempo. `sparse` says the emptiness is the point: `adviseSpec` withholds `sparse-scene`, and coverage-gated scorers can read the declaration before scoring a faithful one-mark scene as broken (the holdout house style built on restraint sat at the suite floor for exactly this reason). `dense` withholds `dense-scene`. The declaration is checked against measured coverage and a new `density-mismatch` advisory fires when the scene contradicts it. Additive: specs without `density` render and advise exactly as before.
- 3142a7d: Layer cohesion — the perception channel that answers "does this read as one form, or as a pile of sprites?"
  
  Every other channel measures ink, not edges. A layer whose circles merged into a silhouette and one whose circles stayed legible as circles have the same coverage, the same luminance, the same dominance share and the same braille map, so an agent drawing a *shape* out of sprites could not tell success from failure without publishing and looking at real pixels.
  
  `layerCohesion(spec, opts)` (also `perceiveScene().form`) reports two independent facts per layer:
  
  - **`overlap`** — geometry. The mean fraction of an entity's outline buried inside a same-layer sibling, traced with 24 outline samples against every sibling. `null` for kinds where a merged silhouette is not a meaningful idea (ring, streak, stroke, bar, emoji, text, textBlock) and for single-entity layers.
  - **`seamless` / `seamCause`** — paint. Whether those overlaps vanish or draw a visible internal edge, and which field is responsible: `soft`, `rect.feather`, any `blend`, `alpha` below 1, `pulse`, or a multi-colour palette. Opacity is judged over the whole timeline, not the sampled instant, so a pulsing layer is correctly called out.
  
  `reads` combines them into `mass`, `seamed` or `marks`.
  
  A new `overlap-seams` advisory fires on the trap: a layer packed tightly enough to have been drawn as one shape, whose paint settings defeat it. It is gated to stay off deliberate washes — at least 6 entities, mean base alpha at or above 0.45, and never under `blend: lighter` / `screen`. **No shipped example trips it**, and a test pins that.
  
  Calibration is measured, not guessed: across all 42 fillable layers in `src/examples/`, particle fields top out at 0.154 while a packed silhouette measures 0.79 to 0.85, with nothing in between. `aurora`'s wander curtains are the one shipped layer in the upper band, at 0.892, correctly reported as `seamed` and correctly left un-warned.
  
  FORMAT.md also gains the positive rule this exposes: overlapping sprites merge only at one flat colour, alpha 1, no blend, no pulse and hard edges, with depth coming from layer order instead of alpha.
- 25cf7d8: Shape glyphs — the path-based sprite family nine of the fifteen style
  profiles asked for (idle-mono registry #46):
  
  - **`polygon`** — `{ radius, color, sides? | points?, soft? }`. A regular
    n-gon (3..12 sides, default 6, point up) of the seeded circumradius, or any
    facet from 3..24 unit-coordinate `points` scaled by the radius. `soft`
    feathers the fill from the centre. Rotates with `spin`; `points` are paint,
    so two polygons with the same point count `morph`.
  - **`stroke`** — `{ length, points, color, width?, curve?, taper?, orient? }`.
    A freehand mark: a Catmull-Rom spline (or polyline) through 2..24
    unit-coordinate points, scaled so the unit box spans the seeded `length`,
    stroked with round joins; `taper` thins it to almost nothing at both ends
    (a brush stroke, not a line); `orient` turns it along the heading like
    `streak`.
  - **`rect.feather`** (0..1) — a soft-edged rectangle: that fraction of the
    half-size fades out toward the border, drawn as nested fills whose
    composited alpha ramps linearly (exact under source-over, summed under
    additive blends).
  
  Both new kinds take `colors[]` / `colorWeights` like every shaped sprite,
  and every geometric fact lives in one module (`shapes.ts`) shared by the
  renderer and the perception model: polygons splat as their disc weighted by
  fill ratio, strokes stamp along their sampled path, feathered rects weigh
  their soft band at half. New shipped example `facets`. Existing entity
  streams are byte-identical (no new draws for existing kinds).
- 423b40f: Time structure — three additive, closed-form primitives the style evals kept
  asking for (idle-mono registry #47):
  
  - `layer.emit: { every, life, jitter?, grow? }` — **sparse events**. Each
    entity is dark except for a `life`-ms window every `every` ms at a
    per-entity offset (`jitter` 0 staggers entities evenly, one event at a
    time; 1, the default, seeds the offsets). Inside a window the entity fades
    in over the first quarter and out over the rest, and `grow: [from, to]`
    scales its size across the window — expansion rather than travel, the "one
    ping" primitive a house style could not author before. Flash safety:
    `every` ≥ 1000 ms, `life` ≥ 500 ms, smooth envelope always.
  - `layer.clock: { phase?, rate? }` — **phase-lock**. Replaces the seeded
    per-entity phases of `pulse`, `grow` and `cycle` with one shared phase
    (turns) and a time multiplier, so two layers can breathe in step or at a
    fixed offset. Because a clocked layer moves in unison, its periods must
    satisfy `period / rate ≥ 1000 ms`. A `pulse.wave` keeps its position-derived
    phase on top of the clock's.
  - `motion.ease: { type: 'settle' | 'buoyant', tau }` on `drift`, `rise` and
    `wander` — closed-form velocity easing: `settle` decelerates from speed to
    rest (travelling `speed × tau`), `buoyant` accelerates from rest. With
    `emit`, the eased travel restarts on every event.
  
  All three are pure functions of `t`; `perceiveScene`, `adviseSpec` (whose
  coverage now weighs an emit layer by its duty cycle) and `motionStats` see
  them through the same `alphaAt` / `sizeAt` / `positionAt` the renderer uses.
  Entity streams of existing specs are unchanged, and so are those of a spec
  you add these to: `emit` offsets come from a fixed low-discrepancy sequence
  (not the seeded stream), and `clock` and `ease` draw nothing, so declaring
  any of the three disturbs no other layer. New exports `emitWindow` /
  `emitEnvelope`; new shipped example `pings`. A validator warning
  `emit-overlap` fires when `jitter: 0` cannot keep one event at a time.

## 3.5.0

### Minor Changes

- ec9c568: The sequence clicker. `advance: 'input'` now does what FORMAT.md always said:
  a timed segment holds at the end of its `duration` until a `sequence.segment`
  steer releases it, and the held scene keeps animating rather than freezing.
  `auto` and `either` advance on the timer as before.
  
  The `sequence.segment` steer is now sticky. `applyTrack` used to switch the
  active segment and lose it on the next animation frame, because `renderFrame`
  re-derived the segment from the wall clock alone. The steer now displaces the
  sequence's clock so the target segment starts at its own `localT` 0 and then
  runs on the timer — the next frame resolves to the same segment. A steer to
  segment `n` releases every `advance: 'input'` hold before `n` and leaves the
  rest armed, so steering backwards re-arms the holds in between; in `loop`
  mode an unreleased hold blocks the wrap and a fresh lap re-arms every hold.
  
  `resolveSegment` gains an optional `{ releasedBelow }` argument and reports
  `held: true` on a waiting segment; `segmentStart(seq, index)` is exported.
  Sequences without `advance: 'input'` resolve exactly as before.
- 31f9d13: Spatial text advisories. `adviseSpec` (and so `perceiveScene().advisories`)
  gains the two checks every text-bearing scene was missing: `text-off-screen`
  when a static `text` / `textBlock` box crosses the viewport edge by more than
  1% of that dimension, and `text-overlap` when two static text layers share
  more than 10% of the smaller box (reported once per layer pair). Boxes mirror
  the renderer — `position` semantics, `align` / `baseline`, `maxWidth` as a
  hard cap for `text`, `breakTextBlock` line-breaking for `textBlock` — using
  the character-class width table the line-breaker already uses, so an author
  without eyes now hears about the most common layout bug it makes. Moving text
  is not judged. All shipped examples still produce zero advisories.
- c2d6757: `glyphFade`, the fourth `textBlock.reveal` mode — the caption look, where each glyph fades up over a staggered alpha ramp instead of appearing whole. Additive: a spec without `reveal` renders exactly as before, and the three existing modes are untouched.
  
  `mode: 'glyphFade'` gains one companion field, `fade` (each glyph's fade window as a fraction of `progress`, 0 exclusive to 1, default 0.15 — small reads as a soft typewriter, large as a wave of overlapping fades). The alpha law: glyph `g` of `total` starts at `(g/total)·(1−fade)` and ramps linearly to opaque over a `fade`-wide window, so `progress` 0 paints nothing and 1 paints everything, and the whole animation stays one steerable numeric glide rather than a burst of per-keystroke cues.
  
  The mode holds the format's load-bearing invariant — layout is computed from the full text, always, and reveal only masks paint. Per-glyph x-positions come from `measureText` prefix advances (the trick the caret already established: paint-only, never an input to layout), so a glyph's position depends only on its fixed prefix and cannot shift as its alpha ramps; a mocked-ctx test pins the same glyph to the same x at two different progress values, and a playground pixel e2e asserts ink grows monotonically with progress on a real canvas.
  
  `perceive` reports `revealed` as the **mean glyph alpha** rather than the frontier fraction — partial-alpha ink is not the same quantity as a hard frontier — and luminance/coverage scale with it, so a non-vision agent steering the mode still sees what it painted. `validate` accepts the new mode and bounds `fade`. Native clients (iOS/tvOS) route unknown modes into the typewriter arm, so a `glyphFade` spec degrades to typewriter on t3 and baked full text on t2; this is documented in FORMAT.md.
  
  Note for the release cutter: this code has been on `main` since 2026-08-22 (PR #94) with no changeset, so npm has been a release behind the source. This changeset is the version bump it never got.

### Patch Changes

- 5b194c6: FORMAT.md: the `trail` row now states that `length` is **milliseconds** (max
  5000) and `fade` is a **number 0..1** — not a boolean. `links.falloff` two rows
  down *is* a boolean, so `{"length": 1600, "fade": true}` was the natural guess
  and the validator's `must be 0..1` was the only place that said otherwise
  (mcp_feedback F16, and F9 for the millisecond half). Documentation only — the
  JSON Schema and the runtime validator already carried the type.
- a729243: glyphFade draws the fully-opaque leading run as a single fillText: long
  reveal blocks stop paying an O(n²) per-frame prefix re-measure, and a fully
  revealed block now forms ligatures and pair kerning identically to the same
  block without `reveal`. Only the still-fading tail draws glyph-by-glyph, at
  the same prefix advances as before. (#97)
- Updated dependencies [f43fb23]
  - @idle-screens/core@0.4.7

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
