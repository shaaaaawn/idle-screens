---
"@idle-screens/schema": patch
---

`sequenceSwapCompatible` (and so `hotSwapSequence`) returns `false` for anything that is not an `idle-sequence` instead of throwing on `segments.length`. A host that handed it a plain scene, as idle-server's viewer did when stepping back from a sequence to a scene at the same seed, now remounts instead of crashing.
