---
'@idle-screens/schema': patch
---

Timeline flash gate (X681): a layer whose only geometry keys are on its own `transform` (or its group's) no longer counts as reaching every cell of the flash grid. Its reach is now everywhere the keyed transform can carry its drawing while `x`, `y`, `scale`, `scaleX` and `rotate` range over their base and keyed values: a tile turning about its anchor stays in its own cells, a turn about the viewport centre sweeps its arc, and an `x`/`y` glide covers the cells along the way. A staggered colour wave over turning tiles is no longer refused as "too dense to verify". A key the gate cannot bound, such as one that moves the pivot, still reaches every cell.
