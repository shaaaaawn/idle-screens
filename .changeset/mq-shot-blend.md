---
'@idle-screens/saver-metaquarium': minor
---

`shotBlend` (seconds, 0–12, default 0): a change of `shot` on the track eases instead of cutting — the camera moves from where the old framing would stand now to the new one (position, aim and lens, smootherstep), `cast` included on either side. Read from the track (`lastStepChange`, loop seams included), so a frame is still a function of t. A hero→cast change that jumped 145 units in one frame moves at most 2.2 per frame with `shotBlend: 4`.
