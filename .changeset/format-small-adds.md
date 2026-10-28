---
'@idle-screens/schema': minor
---

Small format adds from agent feedback:

- **`points` polygons take path paint** (X711): `stroke`, `fill: false` and `gradient` on a `points` polygon draw the closed path through its points, so a keyed `points` array is cheap line art (a stick figure, a wire rig) instead of a path morph. Plain `points` polygons are unchanged.
- **`textBlock.number.minDigits`** (X677): zero-pads the integer part (1..12) for fixed-width counters — `FRAME 0042`. Padded before grouping, as `Intl` does; pair with `grouping: false`.
- **`stroke.draw.mode: "each"`** (X676): every subpath of a path stroke draws over the same span at once (bursts, tick dials, hatching); `"run"` (default) keeps the one pen run.
- **`transform.scaleY`** (X698): vertical scale on layer and group transforms, next to `scaleX`, for squash-and-stretch. It glides and keys like `scaleX`. A stored scene that already carried a `scaleY` (previously warned as unknown and ignored) now renders it.
- **Docs** (X707): FORMAT.md states the `glyphFade` progress→glyph mapping (glyph g of N is fully shown at `f + (g/N)(1−f)`, N = graphemes of the broken lines) and when `mode: "line"` shows line k.
