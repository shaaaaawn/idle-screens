---
'@idle-screens/schema': minor
---

Spatial text advisories. `adviseSpec` (and so `perceiveScene().advisories`)
gains the two checks every text-bearing scene was missing: `text-off-screen`
when a static `text` / `textBlock` box crosses the viewport edge by more than
1% of that dimension, and `text-overlap` when two static text layers share
more than 10% of the smaller box (reported once per layer pair). Boxes mirror
the renderer — `position` semantics, `align` / `baseline`, `maxWidth` as a
hard cap for `text`, `breakTextBlock` line-breaking for `textBlock` — using
the character-class width table the line-breaker already uses, so an author
without eyes now hears about the most common layout bug it makes. Moving text
is not judged. All shipped examples still produce zero advisories.
