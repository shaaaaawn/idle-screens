---
"@idle-screens/schema": patch
"@idle-screens/validator": patch
"@idle-screens/core": patch
"@idle-screens/saver-metaquarium": patch
---

Fixes from an audit; no format change.

- **schema:** a number after `Z` in a path (`M0 0 L1 0 L1 1 Z 5 5`) made the parser repeat `Z` forever, so `flattenPath`, `validateSpec` and `compileSaver` never returned. It is now a parse error, "expected a command after Z".
- **schema:** the publish flash gate did not count a whole-object key on `groups.<id>` (a value like `{ opacity: 0 }`) as a luminance change, so a timeline that strobed whole groups that way passed. It is checked like `groups.<id>.opacity` now.
- **schema:** `perceiveScene` gave `adviseSpec` the timeline-resolved spec, so the timeline-aware advisories (`life-runs-once`, `flash-near-limit`, `loop-seam`, `path-runs-once`) were missing from perception while `adviseSpec` on the same spec reported them.
- **validator:** `analyzeFlashes([])` threw; it now returns a passing report. With `areaThreshold: 0`, a clip with no flashes no longer fails.
- **core:** closing `<idle-screen>`, or removing it from the page, while an async saver `mount()` was still in flight let that saver install into the closed dialog and keep running hidden. Both now invalidate the pending mount.
- **saver-metaquarium:** names in the param mini-languages were looked up through the prototype chain, so `constructor` or `toString` passed as a real kind, mark or material. `floorCover: "constructor/x"` then threw on every frame and in `validateMetaquariumParams`. `floorCover`, `vignette`, `choreography`, `pyramidMix` and the guide's mark checks now accept own names only, and `pyramidMix` refuses a non-finite weight. The guide also checks vignette gestures for all four actors (a–d); actor d used to read as "fish".
