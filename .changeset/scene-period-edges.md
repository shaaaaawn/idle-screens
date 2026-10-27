---
'@idle-screens/schema': patch
---

`scenePeriod` edge cases (Greptile on the 3.15.0 release PR): a field background with `drift.amount: 0` is held still, so its drift period no longer counts towards the scene's period and no longer triggers a false `loop-seam` advisory; and a layer whose entities enter at once but staggered (`life: { enter: 0, fade: 0, stagger }`) now counts as a one-shot build, so it is no longer reported as static.
