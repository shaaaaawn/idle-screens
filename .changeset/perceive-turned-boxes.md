---
"@idle-screens/schema": patch
---

Perception now turns a `rect`, `text`, `textBlock` and `emoji` in the luminance maps, as the renderer does (`rotate`, `spin`, `rock`, and a layer's or group's `transform.rotate`). Before, they were measured as unrotated boxes, so a plank stood on end, or a label turned to run down the screen, read as lying flat. Each one now counts by the exact area of its turned box in each grid cell. A `bar` turns the same way. It used to be measured by the bounding box of its turned box, which lit about ten times a thin bar's ink at 37°. Sprites that don't turn are measured as before. FORMAT.md's perception section and its `rock` row say so.
