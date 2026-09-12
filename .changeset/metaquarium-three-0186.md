---
"@idle-screens/saver-metaquarium": patch
---

Bump `three` to `^0.186.0` (r186). On a 0.x package the caret does not span
minors, so consumers resolve r186 only once this ships. r186 removes nothing
metaquarium imports (no `PCFSoftShadowMap`, minified or CommonJS builds); the
changes touching the classes it uses are fixes and additions.
