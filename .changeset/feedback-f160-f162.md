---
"@idle-screens/schema": patch
---

Advisories and docs from MCP feedback F160 and F162:

- `adviseSpec` with no `t`: a layer whose opacity (`opacity`, a textBlock's `sprite.opacity`, its group's `opacity`) or text colour is keyed on the `timeline` is judged at its most visible before `sparse-scene`, the "declared dense" density mismatch or `text-legibility` fire. A caption that fades in at 1 s and out by 4.6 s no longer reads as empty and illegible at the default 5 s instant. The peak is analytic (the max over the key values), computed only when one of those warnings is about to fire. With an explicit `t`, nothing changes.
- The validator warns `no-effect` on a `text` layer's `size` when its `font` carries a px size, because the font's px size sets the glyph size.
- FORMAT.md, the JSON Schema and the validator message state the path-part `stroke.width` cap (`0 < width ≤ 0.5`, unit-box units, `width × radius × min(w, h)` px). FORMAT.md no longer says that every stroke width is a fraction of `min(width, height)`.
