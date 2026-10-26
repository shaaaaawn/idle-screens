---
'@idle-screens/schema': minor
---

Motion vocabulary (#316): the moves a scene author reaches for first, without a timeline.

- `draw` on `stroke` sprites and path strokes: a line that draws itself on, holds and draws off.
- `in` / `out` / `spring` glide eases on timeline keys and live steers.
- `rock` motion, `life.stagger` for a wave across a layer, and `reveal.rise` for text that rises in.
- `textBlock.number`: a counter that eases between values.
- The `wipe` transition between sequence segments.
- `scenePeriod` and the `loop-seam` advisory, so a looping scene can say how long its loop is and hear when the seam shows.
- Hints when a spec uses another tool's motion words, and the draw-span helpers (`drawSpan`, `trimPolyline`, `trimLines`, `strokeLines`, `strokeDrawnSamples`) exported for hosts.
- The `ink-tide` example shows all of it in one scene.
