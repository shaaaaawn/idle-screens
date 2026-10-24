---
'@idle-screens/schema': minor
---

`timelineFlashReport(spec)` checks a timeline's combined effect on the frame for photosensitive flashing. The validator's timeline rule is per path (keys on one path ≥ 200 ms apart), and paint keys on several paths can still combine past it. A top layer's opacity switching between its own colour and the colour beneath, with all three paths keyed at the floor 67 ms apart, flickers the full frame 5 times a second. That spec was valid.

Wherever one second holds 7 or more key boundaries on paint paths, the report resolves the frame just before and after each boundary, at most 64 frames. It runs the WCAG 2.3.1 analyzer from `@idle-screens/validator` over the result: more than 3 flashes a second over a quarter of the frame fails. Most scenes have no such second and cost nothing.

It is meant for publish and preview, not `validateSpec`, which runs on every viewer mount. `@idle-screens/schema` now depends on `@idle-screens/validator`.
