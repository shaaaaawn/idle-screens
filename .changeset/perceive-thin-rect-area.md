---
'@idle-screens/schema': patch
---

`luminanceGrid` (and so `perceiveScene`, `previewScene`) now weights `rect` and `bar` sprites by the area of each grid cell they cover, as the canvas `fillRect` does. A thin rect used to paint its whole grid row at full alpha: 270 scan lines at alpha 0.35 over mid grey read mean 0.035 where the canvas paints 0.41, which crushed contrast, vignette and coverage for any scene with scan lines, rules or hairline bars. Rect edges that fall mid-cell are now fractional too, so perception of rect-built scenes moves slightly closer to the canvas.

`adviseSequence` no longer raises `boundary-luminance-jump` at a boundary whose outgoing segment declares a `fade` transition, the remedy FORMAT.md names. The advisory message now names that remedy.
