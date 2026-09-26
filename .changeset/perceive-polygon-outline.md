---
'@idle-screens/schema': minor
---

Perception now sees polygons by their real outline. `luminanceGrid` (and everything built on it — `perceiveScene`, coverage, centroid, the row/column profiles, `diffScenes`, `perceiveSequenceFrame`) used to splat every `polygon` as the disc of its circumradius, weighted by its fill ratio. A large, non-round `points` polygon was materially wrong: a full-width flat band read as a circle, and a ridge silhouette along the bottom edge read as a dome covering ~85% of the frame.

A polygon spanning three or more grid cells is now scanline-rasterized by its outline, the same path the renderer fills: rotated by `rotate`/`spin`, filled with the canvas `nonzero` rule, each cell weighted by the fraction it covers. `soft` is the renderer's centred radial gradient clipped to that outline, and a soft `lighter`/`screen` polygon's halo spreads past the outline by a band sized from the glyph's thickness (2·area/perimeter) instead of its circumradius, so a glowing band doesn't re-inflate into a dome. Polygons smaller than three cells keep the cheap disc splat.

`adviseSpec`'s alpha-weighted coverage and `describeScene`'s layer coverage now count a polygon by its outline area instead of its bounding square, so a thin band no longer trips `density-mismatch` under `density: 'sparse'`.

Expect coverage and mean luminance to drop for scenes with large non-round polygons. That is the fix. Small polygons and regular `sides` glyphs under the threshold are unchanged.
