---
'@idle-screens/saver-metaquarium': minor
---

The surface mirror. A new `surfaceMirror` param (0..1, default 0) makes the water's surface, seen from below, a window straight up to the light and a rippling mirror of the tank everywhere else. That covers Snell's window (about 48.6° either side of straight up), total internal reflection outside it, and Fresnel in between.

- **High tier:** it reflects the real tank. The tank is drawn once more from a camera reflected in the surface, at half size into a corner of the canvas, then copied into a texture. That keeps the same shader programs and the same display-space blending. An oblique near plane clips the reflection at the surface. The pass is skipped whenever the mirrored tank can't be on screen, and latched off for good if the pixel governor has to drop.
- **Mid tier:** it reflects the lit water with no second render. **Low tier:** off.
- **Tint:** with a water tint, the reflection takes the lit in-scatter the light really travels through.
- **Where to use it:** it needs reef, kelp, ice or lagoon, and pays off on the `surface` and `low` shots.
