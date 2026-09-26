---
'@idle-screens/saver-metaquarium': minor
---

Water clarity and tint, and the environment palettes finally apply.

- **`waterClarity`** (0..1, default 0.5) only acts when `water` is on, and 0.5 is exactly the water as before. At 0 the water is murky: red and green go fast and the reach closes to ×0.7. At 1 it is clear: colour loss relaxes and the reach stretches to ×1.5.
- **`waterTint`** (`#rrggbb`, empty = off) is the sunlit water.
  - Distant things fade into it looking up toward the light, half of it on the level, and none of it looking down into the deep.
  - The background becomes a dome shaded with the same function, so the far fade and the background agree.
  - The crystals and the horizon take the same in-scatter.
  - With `water` on and no tint set, reef, kelp, ice and lagoon bring their own.
- **Palette fix (visible change):** the environment palettes (fog, floor, mote colours for abyss, reef, kelp, ice, vent, lagoon and universe) never applied, because every param arrives pre-filled. They now apply wherever a scene leaves that colour at its default and no track steers it. Scenes on those environments that don't set their own colours will change colour on this release.
