---
'@idle-screens/schema': minor
---

Advisory and analysis fixes from the MCP feedback log (F19, F20, F34.5, F35, F48, F49). They were written on 2026-09-05, but the commit never reached `develop` until now.

- **`low-contrast-layer` (F19):** a layer is judged against the background sampled across its own vertical extent (region or position), not the gradient's mean. Bottom-anchored silhouettes over a warm ground no longer trip it.
- **`off-center` (F20):** suppressed when the offset is along one axis and most composed entities come from layers region-anchored to an edge on that axis. A skyline along the bottom is the composition.
- **New `additive-saturation` advisory (F35):** fires when `lighter`/`screen` layers stack more than 1.0 viewport-areas of alpha-weighted light. The analytic model sums glow with no ceiling and cannot see this. No shipped or prod example reaches it.
- **`streak-on-static` (F34.5):** no longer fires for a layer with `spin`.
- **`describeScene` (F48, F49):** an omitted `units` now means viewport, matching `compileSaver`/`perceiveScene`/`adviseSpec`. Every shipped example was being described at 1/1080th scale. Scaled counts are clamped to `LIMITS.maxTotal` like the renderer. All four builders share one `entityScales()` helper.
- **FORMAT.md:** a negative orbit speed reverses direction, and an orbit parent layer must have `count: 1`. A path `scatter` must be > 0, and a single entity cannot show a path's curve.
