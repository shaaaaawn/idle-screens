# @idle-screens/capabilities

## 0.2.1

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

## 0.2.0

### Minor Changes

- 9fa2a68: Add Worker/OffscreenCanvas rendering, new savers (pipes, bsod, flurry, fluid, reaction-diffusion), and schema extensions (static motion, positioning, text alignment, dashboard support)
