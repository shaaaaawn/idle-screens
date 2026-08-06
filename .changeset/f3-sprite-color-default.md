---
'@idle-screens/schema': patch
---

Auto-default `sprite.color` from `colors[0]` when missing (F3)

Before validation, if a sprite declares `colors[]` but omits `color`, default
`color` to `colors[0]`. Applies in both `validateSpec()` and per-segment scene
normalization in `validateSequence()`.
