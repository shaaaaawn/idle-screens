---
'@idle-screens/saver-metaquarium': patch
---

Fixes for the 0.9.0 mineral-world release, found in post-merge review:

- `vignette`: `follow` onto a mark (not another actor) now reports a
  validation problem instead of silently doing nothing; a `circle` beat
  combined with `>mark` no longer leaves a stale position that teleports
  the actor at the next beat boundary.
- `recipeTrack()` now returns the `program`/`seed` fields its `ControlTrack`
  return type promises, so a recipe can be published directly.
- Crystal floor light pools now use the emitter's full `reach` (was scaled
  by `0.55`), matching the light field fish and other geometry sample.
- A fish spawned before the tank's first material-mode reconcile now gets
  the correct lit/flat material immediately, instead of momentarily
  defaulting to flat regardless of `fishLighting`.
