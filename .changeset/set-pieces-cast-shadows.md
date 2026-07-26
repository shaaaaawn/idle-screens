---
'@idle-screens/saver-limelight': minor
'@idle-screens/saver-tide': patch
---

New package: `@idle-screens/saver-limelight` — the third deep passthrough saver,
and the first where the page's blocks interact with **each other**.

A roaming key light rakes across the live page. Every block gets a height (small
chips read as standing flats, a hero image is stage floor), stands off the page
with viewer-relative parallax, and casts a real silhouette shadow — projected
from the block's *lifted* corners, so the shadow stays welded to what you
actually see. And a block standing behind another block is dimmed by it: that
block-on-block occlusion is the step past black hole (a field applied to blocks)
and tide (a field's derivative applied to blocks). The content is the set.

`lightX`/`lightY` are the steered position of the light and the roam is an offset
around them, so a track pinning `roamX: 0, roamY: 0` gives an agent absolute
control of where the light points — a better steering surface than nudging a
scalar. 14 typed params plus a `demoTrack` that rakes cross-stage and tightens
to a followspot.

Occlusion resolves on a clock bucket derived from `t` — never a frame counter —
so `renderFrame(t, seed)` reproduces a frame exactly, page transforms included.

**tide (patch):** per-block buoyancy, draft and bob phase now come from
`rng.fork(index)` rather than the shared cursor. `resize()` re-collects victims,
and drawing from the shared stream silently re-rolled every block's buoyancy on
each viewport change — so the same `t` rendered differently before and after a
resize. Caught by the new seek-and-resize determinism test.
