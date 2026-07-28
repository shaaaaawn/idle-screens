---
'@idle-screens/schema': minor
---

Add `textBlock` sprite kind — deterministic multi-line text blocks

New sprite variant for multi-line text that wraps within a `maxWidth` boundary.
All dimensions (fontSize, maxWidth) are viewport fractions of `min(w,h)` so
blocks scale with the display. `units: 'px'` specs with textBlock sprites are
now rejected at validation time (textBlock is viewport-fraction only).

Line breaks are computed from a fixed character-class metrics table (narrow,
normal, wide buckets) so wrapping is identical across platforms — no
`measureText` in the layout path. Supports `align` (left/center/right) and
`lineHeight`. Perception (`textSprites`, `luminanceGrid`, `dominanceRanking`)
reports textBlock layers analytically.
