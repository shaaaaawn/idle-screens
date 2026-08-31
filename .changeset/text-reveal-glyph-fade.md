---
'@idle-screens/schema': minor
---

`glyphFade`, the fourth `textBlock.reveal` mode — the caption look, where each glyph fades up over a staggered alpha ramp instead of appearing whole. Additive: a spec without `reveal` renders exactly as before, and the three existing modes are untouched.

`mode: 'glyphFade'` gains one companion field, `fade` (each glyph's fade window as a fraction of `progress`, 0 exclusive to 1, default 0.15 — small reads as a soft typewriter, large as a wave of overlapping fades). The alpha law: glyph `g` of `total` starts at `(g/total)·(1−fade)` and ramps linearly to opaque over a `fade`-wide window, so `progress` 0 paints nothing and 1 paints everything, and the whole animation stays one steerable numeric glide rather than a burst of per-keystroke cues.

The mode holds the format's load-bearing invariant — layout is computed from the full text, always, and reveal only masks paint. Per-glyph x-positions come from `measureText` prefix advances (the trick the caret already established: paint-only, never an input to layout), so a glyph's position depends only on its fixed prefix and cannot shift as its alpha ramps; a mocked-ctx test pins the same glyph to the same x at two different progress values, and a playground pixel e2e asserts ink grows monotonically with progress on a real canvas.

`perceive` reports `revealed` as the **mean glyph alpha** rather than the frontier fraction — partial-alpha ink is not the same quantity as a hard frontier — and luminance/coverage scale with it, so a non-vision agent steering the mode still sees what it painted. `validate` accepts the new mode and bounds `fade`. Native clients (iOS/tvOS) route unknown modes into the typewriter arm, so a `glyphFade` spec degrades to typewriter on t3 and baked full text on t2; this is documented in FORMAT.md.

Note for the release cutter: this code has been on `main` since 2026-08-22 (PR #94) with no changeset, so npm has been a release behind the source. This changeset is the version bump it never got.
