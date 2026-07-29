---
'@idle-screens/schema': minor
---

Add morph segue transition and adviseSequence

Morph segue: sequence boundaries where adjacent segments share a structural
signature now support smooth paint glides (colors, backgrounds) instead of
hard cuts. Chained morphs use chain-root seeding for continuous entity
placement. Falls back to cut when structures differ.

adviseSequence: cross-segment advisory for validated sequences — boundary
luminance jump detection, morph structural mismatch warnings, and
per-segment adviseSpec propagation.
