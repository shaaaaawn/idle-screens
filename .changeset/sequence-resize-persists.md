---
'@idle-screens/schema': patch
---

Sequence resize now persists into the child mount context. `SequenceInstance` creates its per-segment `SpecInstance` children lazily (first rAF tick, segment cuts, morph finalization), and `resize()` only forwarded to children that already existed — the new dimensions were forgotten for every child created afterwards. A viewer that mounted in a hidden or unpainted tab (0×0 viewport) stayed a 1×1 canvas forever, and any segment cut after a resize snapped the shared canvas back to the stale mount-time size.
