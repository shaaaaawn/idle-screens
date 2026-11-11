# @idle-screens/validator

## 0.1.3

### Patch Changes

- aaf2a5d: Fixes from an audit; no format change.
  
  - **schema:** a number after `Z` in a path (`M0 0 L1 0 L1 1 Z 5 5`) made the parser repeat `Z` forever, so `flattenPath`, `validateSpec` and `compileSaver` never returned. It is now a parse error, "expected a command after Z".
  - **schema:** the publish flash gate did not count a whole-object key on `groups.<id>` (a value like `{ opacity: 0 }`) as a luminance change, so a timeline that strobed whole groups that way passed. It is checked like `groups.<id>.opacity` now.
  - **schema:** `perceiveScene` gave `adviseSpec` the timeline-resolved spec, so the timeline-aware advisories (`life-runs-once`, `flash-near-limit`, `loop-seam`, `path-runs-once`) were missing from perception while `adviseSpec` on the same spec reported them.
  - **validator:** `analyzeFlashes([])` threw; it now returns a passing report. With `areaThreshold: 0`, a clip with no flashes no longer fails.
  - **core:** closing `<idle-screen>`, or removing it from the page, while an async saver `mount()` was still in flight let that saver install into the closed dialog and keep running hidden. Both now invalidate the pending mount.
  - **saver-metaquarium:** names in the param mini-languages were looked up through the prototype chain, so `constructor` or `toString` passed as a real kind, mark or material. `floorCover: "constructor/x"` then threw on every frame and in `validateMetaquariumParams`. `floorCover`, `vignette`, `choreography`, `pyramidMix` and the guide's mark checks now accept own names only, and `pyramidMix` refuses a weight above 1e6 (a non-finite one, or two near 1e308, broke its weighted pick). The guide also checks vignette gestures for all four actors (a–d); actor d used to read as "fish".

## 0.1.2

### Patch Changes

- 8ff9e87: `patternHazardReport(spec, opts?)`: a publish-time photosensitivity check for regular spatial patterns, after ITU-R BT.1702-3 Annex 1. It draws the scene with the analytic perception raster at 216 cells on the short side and scans every row and column for stripes. A scene fails when more than five light-dark pairs of regular stripes, with a flash-level swing (0.1 relative luminance, darker side under 0.8), cover more than 40 % of the frame while still, or more than 25 % while they spin, rock, orbit, pulse or are keyed. One-way flow is judged as still, and fails once its stripes cross a point more than 3 times a second over 25 % of the frame. The check needs no timeline and covers `spin` and motion on its own. It returns the measured area, pitch, contrast and flicker, plus a `message` naming what would pass. Like `timelineFlashReport`, it is not part of `validateSpec` or `compileSaver`. Also exported: `patternSampleTimes`, `layerPatternMotion` and the `PATTERN_*` thresholds.
  
  `luminanceGrid`, on a grid with more cells on either axis than a `field` background's render raster (96 cells on the short side, the long side by aspect), now reads that raster nearest-neighbour, as the canvas paints it, instead of sampling the field per grid cell. Coarser grids, including every default, are unchanged.
  
  FORMAT.md's safety invariants now separate what the format guarantees by construction from what is checked at publish and what nothing checks. The validator exports its WCAG flash constants (`FLASH_SWING_THRESHOLD`, `FLASH_DARK_MAX`, `FLASH_MAX_PER_SECOND`), and the pattern check reuses them.

## 0.1.1

### Patch Changes

- 9fa2a68: Add Worker/OffscreenCanvas rendering, new savers (pipes, bsod, flurry, fluid, reaction-diffusion), and schema extensions (static motion, positioning, text alignment, dashboard support)
