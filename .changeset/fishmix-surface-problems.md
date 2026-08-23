---
'@idle-screens/saver-metaquarium': patch
---

fishMix parse problems are no longer silent: the tank warns once per mix change (with a note when the mix fell back to fishUrl/fishCount), and a count above 24 now clamps to 24 instead of discarding the whole token. `parseFishMix` still records the clamp in `problems`, so validators can surface it.
