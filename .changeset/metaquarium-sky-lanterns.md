---
'@idle-screens/saver-metaquarium': minor
---

`skyLanterns` — the sky motif. Voxel jellyfish lanterns drift in the water overhead, pulsing as they rise and sink, with a few hanging far out as fogged silhouettes. One draw call, moved entirely in the vertex shader; they borrow the scene's crystal colours and join the light field. Glow cards now lift toward the lens along the view ray, so a bloom sits on its source at the edge of frame too. Bubbles are properly round (the wobble no longer clips on the sprite's square) with fresnel rims sized in pixels.
