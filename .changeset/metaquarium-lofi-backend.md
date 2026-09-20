---
"@idle-screens/saver-metaquarium": minor
---

Lofi backend: the Apple TV's 2D aquarium, in the browser.

`createMetaquarium({ backend: 'lofi' })` mounts a Canvas2D tank instead of
three.js: every fish's `_transparent_icon.png` swimming a layered After Dark
aquarium — water gradient, light shafts, dunes, swaying kelp, rising bubbles.
It is a port of `AquariumField.swift`, down to the Mulberry32 stream, so one
seed lays out the same tank on a browser and a TV. That makes it a QA surface
for the tvOS renderer as well as a nostalgia mode.

- Reads the scene's `environment` (the TV's room palettes) and `fishMix`
  (parsed with the engine's own DSL, so any of the 512 minted icons, not the
  TV's bundled 15). Breed motion carries over: turtles' top-down icons turn to
  face travel, seahorses sway upright.
- Never loads three.js — its own lazy chunk.
- Icons go through the gateway ladder and decode from a Blob, so the canvas is
  never tainted and thumbnails keep working.
- Reads only `environment` and `fishMix` and always swims 8 fish (13 on
  high-tier devices), as the TV does; other params are no-ops in lofi.
- Opt-in and host-side. Not a scene param: a published channel means the same
  thing whichever backend a screen chose. The playground exposes it as
  `?lofi=1`.
