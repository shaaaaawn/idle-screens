---
'@idle-screens/schema': patch
---

Renderer fixes for live-vs-intent divergences. `rect.feather` paints one smooth falloff (a cached alpha mask stretched to the rect) instead of six stepped nested fills (X383). A `taper` stroke fills its outline once, so a wide translucent mark no longer beads at every segment joint (X386). `trail` echoes of shaped sprites (polygon, stroke, rect, ring, streak, bar) draw the sprite's own shape at the echo's time instead of discs (X387), and a fast mover's echoes are gap-filled (sampled at their own times, budgeted per layer) so a quick path draws a continuous ribbon rather than spaced dots (X469); trails whose echoes already overlap draw exactly as before. Perception samples trails through the same sampler.
