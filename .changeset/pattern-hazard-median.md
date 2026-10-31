---
'@idle-screens/schema': patch
---

`patternHazardReport` sorts each stripe patch's periods and slants once, where it re-sorted the whole patch for every run in it. That made the scan quadratic in patch size on patterned scenes. The reports are unchanged: they match a snapshot taken before the change, field for field.
