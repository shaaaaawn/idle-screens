---
'@idle-screens/schema': patch
'@idle-screens/saver-metaquarium': patch
---

Docs only.
- **FORMAT.md Timeline:** a key's `dur` is capped at 30000 ms. A longer one fails validation for the whole spec, so split a slower glide into consecutive keys (X436).
- **metaquarium `rayStrength`:** the guide and README now say which devices draw light shafts. The high tier draws 5 and standard draws 2. The lowest tier draws none in a room with a water surface (reef, kelp, ice or lagoon), because the surface takes that budget. Abyss, vent and universe keep 2. `perceiveChannel` reads `room.rayStrength` 0 where shafts were dropped (X442).
