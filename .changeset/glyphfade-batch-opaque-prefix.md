---
'@idle-screens/schema': patch
---

glyphFade draws the fully-opaque leading run as a single fillText: long
reveal blocks stop paying an O(n²) per-frame prefix re-measure, and a fully
revealed block now forms ligatures and pair kerning identically to the same
block without `reveal`. Only the still-fading tail draws glyph-by-glyph, at
the same prefix advances as before. (#97)
