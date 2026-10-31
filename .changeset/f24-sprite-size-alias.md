---
'@idle-screens/schema': patch
---

Repair a `size` misplaced inside an emoji/text sprite, and flag giant glyphs (F24)

- `validateSpec` moves `sprite.size` on an emoji or text sprite up to the
  layer when the layer has no `size` of its own, with a `misplaced-property`
  warning: "'size' belongs on the layer, not inside sprite — move it up one
  level". Before, the field was ignored and the layer fell back to the default
  size. If `layer.size` is also set, the layer's value wins and the warning
  says `sprite.size` is ignored. On other sprite kinds (which never read
  `layer.size`) `sprite.size` stays an `unknown-property`, and the message now
  names the field that sizes that kind (`radius`, `width`, `length`,
  `fontSize`). The JSON Schema still rejects `sprite.size`.
- New `giant-entity` advisory in `adviseSpec`: an emoji/text layer whose
  glyphs render taller than the viewport's min dimension, the usual sign of
  px numbers in a viewport-unit spec.
- FORMAT.md: `size` is documented as a layer field next to `count`, with an
  emoji example, and the runtime repairs and `giant-entity` are described.
