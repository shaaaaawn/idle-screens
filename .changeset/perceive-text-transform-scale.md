---
"@idle-screens/schema": patch
---

Perception now honours a paint `transform.scale` on `text` and `textBlock` layers. The luminance grid, coverage and `text[].sizePx` used to measure scaled words at their unscaled size, while the renderer, the SVG preview and dominance all scaled them (X834). Kinetic type that pulses on scale now reads the way it draws.
