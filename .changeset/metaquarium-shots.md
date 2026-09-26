---
'@idle-screens/saver-metaquarium': minor
---

Named shots. A new `shot` param cuts between framings:
- `orbit` (the classic camera, exactly, and the default)
- `hero` (three-quarter establishing)
- `front` (level, long lens)
- `low` (among the plants, looking up)
- `top` (steep, the floor as a map)
- `surface` (looking up at the water's underside)
- `macro` (close on the biggest landmark near the front)

Azimuth and autoRotate still turn a shot, and distance scales it. Shots stay inside the water, never above the surface or under the floor. The follow camera still takes precedence. `inspect()` now reports `render: { programs, calls, triangles }` and the current `shot`.
