---
'@idle-screens/saver-metaquarium': minor
---

One caustic system. The surface net, the follow-spot's web, the light shafts, the water's surface and the crystals now all read the same caustic function, on the same clock and cell size.

- **Follow-spot pools** draw the shared net in place of their own sine web. A spot inside caustic-lit water shows one pattern, not two. The web keeps moving even when `caustics` is 0.
- **Shafts** brighten where the net focuses at the surface above them, with slow bands running down them.
- **The water's surface**, seen from below, carries the net, and its far edge fades into the water instead of drawing a line to the horizon.
- **Crystal shards** take a glass share of the net.
- **Light sources are no longer lit:** fish glow parts, eyes, lantern cores, the horizon, glowing veins and flora lamps opt out.
- **Layer count** is now a uniform the tier sets, not a shader macro, and the shared functions are include-guarded. Patches stack in any order.
- **Visible change:** with `caustics` 0 everything is as before, except the follow-spot's web, which now uses the shared net's look.
