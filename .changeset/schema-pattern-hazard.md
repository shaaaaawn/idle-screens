---
'@idle-screens/schema': minor
'@idle-screens/validator': patch
---

`patternHazardReport(spec, opts?)`: a publish-time photosensitivity check for regular spatial patterns, after ITU-R BT.1702-3 Annex 1. It draws the scene with the analytic perception raster at 216 cells on the short side and scans every row and column for stripes. A scene fails when more than five light-dark pairs of regular stripes, with a flash-level swing (0.1 relative luminance, darker side under 0.8), cover more than 40 % of the frame while still, or more than 25 % while they spin, rock, orbit, pulse or are keyed. One-way flow is judged as still, and fails once its stripes cross a point more than 3 times a second over 25 % of the frame. The check needs no timeline and covers `spin` and motion on its own. It returns the measured area, pitch, contrast and flicker, plus a `message` naming what would pass. Like `timelineFlashReport`, it is not part of `validateSpec` or `compileSaver`. Also exported: `patternSampleTimes`, `layerPatternMotion` and the `PATTERN_*` thresholds.

`luminanceGrid`, on a grid with more cells on either axis than a `field` background's render raster (96 cells on the short side, the long side by aspect), now reads that raster nearest-neighbour, as the canvas paints it, instead of sampling the field per grid cell. Coarser grids, including every default, are unchanged.

FORMAT.md's safety invariants now separate what the format guarantees by construction from what is checked at publish and what nothing checks. The validator exports its WCAG flash constants (`FLASH_SWING_THRESHOLD`, `FLASH_DARK_MAX`, `FLASH_MAX_PER_SECOND`), and the pattern check reuses them.
