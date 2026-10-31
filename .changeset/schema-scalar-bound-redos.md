---
'@idle-screens/schema': patch
---

The validator's shape-hint pattern for one-number bounds (`must be 0..1`) is linear on any input: each number in it is now unambiguous, where `[\d.]*\.\.` backtracked quadratically on a long run of dots (CodeQL js/polynomial-redos, high).
