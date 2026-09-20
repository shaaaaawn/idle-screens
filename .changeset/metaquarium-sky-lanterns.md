---
'@idle-screens/saver-metaquarium': minor
---

`skyLanterns` — the sky motif. Voxel jellyfish lanterns drift in the water overhead, pulsing as they rise and sink, with a few hanging far out as fogged silhouettes. One draw call, moved entirely in the vertex shader; they borrow the scene's crystal colours and join the light field. Glow cards now lift toward the lens along the view ray, so a bloom sits on its source at the edge of frame too. Bubbles are properly round (the wobble no longer clips on the sprite's square) with fresnel rims sized in pixels.

`horizon` — the far distance. Three hazed rings of silhouettes past the fog line: rock spires, castle-sized crystals in the scene's colours and (from 0.4) one grand geode with its door lit. Unlit, one draw call; drawn as light added to the water colour, so it reads on a black ocean and a bright one alike.

Flora moves again, at no frame cost: the sway is an S-curve that climbs the stalk (kelp snakes, grass flutters), gusts cross the garden and bow each plant as they pass, a band of light runs up every plant and flares its lamp on arrival, and the lamps shed rising spores (one extra Points draw).
