---
"@idle-screens/schema": minor
---

Perception overhaul for non-vision authoring + spin ranges

- **Additive-glow calibration**: `luminanceGrid`/`perceiveScene` coverage now models the halo of soft circles drawn with `blend: lighter`/`screen` (previously hard-edged, which badly under-reported glow-heavy scenes), so coverage tracks the live canvas far more closely. The spread constant is a first pass pending live calibration.
- **Geometry-aware dominance**: thin-but-bright structures (rings, streaks, link lines) get a line-salience boost in `dominanceRanking`, so they register instead of vanishing behind filled discs.
- **Higher-resolution density map**: new `renderDensityMap(grid)` — one ASCII density char per cell, 1:1 with the grid. Pair with a larger `cols`/`rows` (e.g. `{cols: 120, rows: 48}`) for a sharper read than braille; also exposed as `perceiveScene().density`.
- **Text listing**: new `textSprites(spec)` / `perceiveScene().text` reports the literal strings and rendered sizes of text layers — glyphs are invisible in the luminance maps.
- **`spin` accepts `[min, max]`**: per-entity seeded rotation speed (confetti, tumbling debris, foliage), parallel to `speed`/`alpha`. Existing scalar specs produce byte-identical entity streams (the range form draws one extra seeded value only when present).
