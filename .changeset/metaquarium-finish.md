---
'@idle-screens/saver-metaquarium': minor
---

The finish: a new `finish` param (0..1, default 0) adds one full-screen pass over the finished frame. It gives a gentle grade: a touch of S-curve contrast, +8 % saturation, cool shadows, warm highlights and a soft vignette. It also adds ±1 LSB triangular dither against banding on 8-bit TV panels, and restrained bloom on the high tier. The scene draws to the canvas exactly as before. The pass copies that frame and works in display space, so the tank's hand-rolled shaders and additive glows are untouched. It is mid and high tier only, and `finish: 0` skips the pass entirely.
