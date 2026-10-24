---
'@idle-screens/schema': patch
---

Perception and advisories now read what is actually on screen. Spin's reports X603 and X605–X610, plus X616, each gave a repro that read wrong; all eight now read right.

- **Dominance and scene colour** count only the part of each entity inside the viewport (X616). A path drawing counts the ink its parts lay down: a part at opacity 0 adds nothing (X609), and an open `fill: false` line counts its stroke, not the area its points enclose (X605). The same per-part ink feeds `additive-saturation`.
- **`low-contrast-layer`** judges a path drawing by the colours its parts paint (fills, gradient stops, strokes), not its base `color` (X608). A layer seen through a hole in an opaque drawing above it is also judged against that frame (X610).
- **`perception.motion`** counts `spin`: a turning shape's ink moves even when its centre stands still (X607). Circles and rings are excluded, since they look the same turned.
- **The luminance maps and centroid** turn a layer's outline by its paint `transform.rotate` (and its group's), not just its position (X606).
- **`text-off-screen`** judges text by its box after the layer's `rotate`, so a vertical caption is no longer flagged (X603).
