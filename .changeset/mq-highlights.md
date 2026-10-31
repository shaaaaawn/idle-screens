---
'@idle-screens/saver-metaquarium': minor
---

`highlights` (0–1, default 0): bright light rolls off instead of clipping. The tank draws into a half-float buffer that keeps display-space values past white, and a shoulder eases them into it with the hue kept — a fish in a god ray stays a fish, bright water keeps its blue gradient. With `finish` on, the shoulder runs after the grade, so the grade cannot clip it again. Mid and high tiers on WebGL2; 0 draws as before.
