---
'@idle-screens/saver-metaquarium': patch
---

The anchor rule that spreads a cast along its route at mount is now a named function (`anchorFraction`) with a test, instead of an inline condition. No behaviour change — it is the same rule that shipped in the live-QA fix — but the earlier version of it exempted every `travel = 1` style, so patrol, bottom and surface mounted as one knot dead-centre and took minutes to disperse. The existing tests all passed while that was happening: they covered the per-fish hash, and the bug was in how the tank used it. The new gate asserts the rule the tank actually calls, over every style in the catalogue.
