---
'@idle-screens/saver-metaquarium': minor
---

Fish `GLOW-*` parts are light sources now. `fishGlow` (default 0.6) gives every
glowing fish a soft bloom card that spills over its own body (one instanced
draw for the whole cast — still no composer), a white-hot breathing core, and
colour thrown on the floor beneath low swimmers through the same light field
the crystals use; with `crystalTint` on, glowing fish tint their neighbours
too. A glow part that is the whole silhouette keeps its colour and blooms
fainter, and unsaturated glows never bloom as grey fog. `fishMetal` (default
on) renders metallic plates with a generated chrome matcap — reflection with
no environment map and no lights — instead of a flat unlit atlas. `fishGlow: 0`
and `fishMetal: off` are the previous look exactly.

`fishLighting` (default `lit`): fish take light. A key and a fill shade every
voxel face by where it points; a generated studio environment (prefiltered once,
nothing fetched) gives PBR metal something to reflect; and a fixed pool of point
lights (4 / 3 / 0 by tier) rides the glow parts nearest the camera, lifted
toward the lens so a glowing fin colours the body beside it. Bloom is now one
card per glowing part, in that part's colour. `fishLighting: flat` is the
original unlit tank.
