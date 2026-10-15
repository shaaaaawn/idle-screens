---
'@idle-screens/schema': patch
---

Perception reads what the canvas paints. `luminanceGrid` / `perceiveScene` were scored against rendered pixels (464 stored scenes, two sizes, two times) and corrected where they disagreed: round sprites and text light cells by the ink they lay; soft sprites follow the renderer's own radial gradient with no modelled halo (`GLOW_SPREAD` removed — additive glow had read 4× the pixels); discs smaller than a cell keep their ink; and a text sprite's px font scales with the viewport the way the renderer draws it, so `textSprites().sizePx` reports the size on screen. Fidelity to pixels on held-out scenes rose from 0.71 to 0.84. Coverage numbers fall for glow- and text-heavy scenes; that is the correction, not a regression.
