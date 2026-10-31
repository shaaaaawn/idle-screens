---
'@idle-screens/schema': patch
---

`patternHazardReport`: a stripe run must now sit on a regular lattice. Its stripes are fitted to x₀ + k·p, and every stripe and every spacing must lie within one raster cell plus 15 % of the pitch. Before, each spacing was compared only with the one before it, so the spacing could wander. A dense random scatter (for example 792 small drifting polygons) then chained into long "runs" and was refused as a regular stripe pattern over most of the frame. Gratings at any angle down to the 8 px floor, bar lists, rings, spokes, dot lattices and gentle perspective gratings are still refused. Random scatters, starfields, rain and noise fields now pass. The area thresholds and the contrast rule are unchanged.
