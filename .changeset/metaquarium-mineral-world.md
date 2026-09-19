---
'@idle-screens/saver-metaquarium': minor
---

The mineral world: opt-in scenery layers that turn a tank into a place, all
generated from the seed (nothing fetched), all batched, all motion a pure
function of the tank clock. Every layer defaults to 0, so existing scenes are
unchanged.

- `geodeHomes` (0–3) — real geodes: a displaced boulder broken along a jagged
  plane, an agate rind, a throat of inward crystal teeth, and a voxel house
  recessed inside (round door, lit window, lamp, steps, a chimney that vents
  bubbles). Three habits — cottage, hall, tower. Each home is a warm emitter in
  the light field.
- `interior: geode` — sets the whole scene INSIDE a geode home: a dome lined
  with thousands of small crystals over agate strata, a plank floor and rug, and
  the inhabitants' voxel furniture (bed, tea table, bookshelf, stove and kettle,
  reading corner, round door and window, chandelier). Its lights are emitters in
  the light field and wear bloom cards; the fish swim the room.
- `rockDensity` (0–1) + `rockVeins` (0–1, default 0.7) — boulders, a ridge and an
  arch, fractured by fissures cut from the stone's own facets, with forks, a
  white-hot core and crystals pushing out of the crack.
- `floraDensity` (0–1) — three voxel species (kelp, reed clumps, lantern bulbs)
  that lean toward and take the colour of their nearest crystal, with a gust
  that travels across the field.
- `bubbleVents` (0–1) — puffs from chimneys, fissure crowns and crystal bases;
  bubbles quicken, swell and wander as they rise.
- `marineSnow` (0–1) — slow snow lit by the crystals it falls through.

The world's one rule: minerals are faceted, the living and the made are voxel.
