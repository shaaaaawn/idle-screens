---
'@idle-screens/schema': minor
'@idle-screens/saver-metaquarium': patch
---

Four additive schema features, all opt-in — a spec that omits them renders exactly as before.

**Field background.** A seeded value-noise sampler as a background type, rendered
once into a cached low-res raster and stretched, so a full-frame texture costs a
blit per frame rather than per-pixel work. Perceivable and steerable like any
other background; `inkOverBed` advises against the bed's own seed.

**Finish.** A grain-and-dither screen over the finished scene — the print-finish
pass. It presents on its own canvas so it never feeds ghosting's persistence
buffer, and its paths are steerable, so the grain is paint rather than a fixed
post-effect. Its grain seed resolves the same way the scene's does, which is what
keeps `renderFrame(t, seed)` frame-addressable with a finish attached.

**`rotate`.** Static per-entity rotation. `spin: [0, 0]` zeroes the angular
velocity but does not hold the seeded angle, so there was no way to ask for
"tilted, not spinning" — `rotate` is that.

**`SequenceInstance.hotSwapSequence`.** Publish a new sequence into a running
instance without remounting: the swap happens in place and the retained control
track survives it. Structural edits are refused rather than silently accepted,
since those genuinely need a remount.

Also ships the `thermal-field` example — six riso bands, warped and drifting,
wearing the grain-and-dither finish — as the worked demonstration of both new
background and finish paths.

**metaquarium (patch).** `LogicalClock` now tracks paused state explicitly. A
sample taken before the first `resume()`, or while paused, advanced the clock
because `origin === null` cannot distinguish "just resumed" from "still paused" —
both leave it null. Frozen until resumed now.
