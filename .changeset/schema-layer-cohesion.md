---
'@idle-screens/schema': minor
---

Layer cohesion — the perception channel that answers "does this read as one form, or as a pile of sprites?"

Every other channel measures ink, not edges. A layer whose circles merged into a silhouette and one whose circles stayed legible as circles have the same coverage, the same luminance, the same dominance share and the same braille map, so an agent drawing a *shape* out of sprites could not tell success from failure without publishing and looking at real pixels.

`layerCohesion(spec, opts)` (also `perceiveScene().form`) reports two independent facts per layer:

- **`overlap`** — geometry. The mean fraction of an entity's outline buried inside a same-layer sibling, traced with 24 outline samples against every sibling. `null` for kinds where a merged silhouette is not a meaningful idea (ring, streak, stroke, bar, emoji, text, textBlock) and for single-entity layers.
- **`seamless` / `seamCause`** — paint. Whether those overlaps vanish or draw a visible internal edge, and which field is responsible: `soft`, `rect.feather`, any `blend`, `alpha` below 1, `pulse`, or a multi-colour palette. Opacity is judged over the whole timeline, not the sampled instant, so a pulsing layer is correctly called out.

`reads` combines them into `mass`, `seamed` or `marks`.

A new `overlap-seams` advisory fires on the trap: a layer packed tightly enough to have been drawn as one shape, whose paint settings defeat it. It is gated to stay off deliberate washes — at least 6 entities, mean base alpha at or above 0.45, and never under `blend: lighter` / `screen`. **No shipped example trips it**, and a test pins that.

Calibration is measured, not guessed: across all 42 fillable layers in `src/examples/`, particle fields top out at 0.167 while a packed silhouette measures 0.79 to 0.85, with nothing in between. `aurora`'s wander curtains are the one shipped layer in the upper band, at 0.892, correctly reported as `seamed` and correctly left un-warned.

FORMAT.md also gains the positive rule this exposes: overlapping sprites merge only at one flat colour, alpha 1, no blend, no pulse and hard edges, with depth coming from layer order instead of alpha.
