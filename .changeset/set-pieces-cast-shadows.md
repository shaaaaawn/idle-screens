---
'@idle-screens/saver-limelight': minor
'@idle-screens/saver-tide': patch
---

New package: `@idle-screens/saver-limelight` — the third deep passthrough saver,
and the first where the page's blocks interact with **each other**.

A key light hangs from a rig OFF-SCREEN above the stage and rakes its pool
across the live page. Every block gets a height (small chips read as standing
flats, a hero image is stage floor), stands off the page with viewer-relative
parallax and visible side walls, and casts a distance-faded silhouette shadow
from an apex above the frame — so shadows sweep the page in near-parallel
instead of radiating from a hotspot in the content. A cold counter-light hung
opposite the key adds a second, fainter shadow and a blue rim.

The picture is built so the set acts on the light, not just under it: the pool
is an additive glow the shadows visibly carve (which is what makes the shadow
story read even on dark pages), and the volumetric shaft is drawn on its own
layer with the set's shadow slots punched out of it before compositing — the
beam is visibly interrupted by the page's own content, with dust riding it and
a terminal splash where it lands. And a block standing behind another block is
dimmed by it: that block-on-block occlusion is the step past black hole (a
field applied to blocks) and tide (a field's derivative applied to blocks).
The content is the set.

The light aims in **content-box space**, not viewport space: `lightX: 0.5`
means "the middle of the content", so on a page with a centered column the
pool tracks the column instead of spending half its roam lighting empty
margin. `lightX`/`lightY` are the steered aim and the roam is an offset around
it, so a track pinning `roamX: 0, roamY: 0` gives an agent absolute control.
18 typed params plus a `demoTrack` that rakes cross-stage and tightens to a
warm followspot.

Occlusion resolves on a clock bucket derived from `t` — never a frame counter —
so `renderFrame(t, seed)` reproduces a frame exactly, page transforms included.

**tide (patch):** per-block buoyancy, draft and bob phase now come from
`rng.fork(index)` rather than the shared cursor. `resize()` re-collects victims,
and drawing from the shared stream silently re-rolled every block's buoyancy on
each viewport change — so the same `t` rendered differently before and after a
resize. Caught by the new seek-and-resize determinism test.
