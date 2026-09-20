---
'@idle-screens/saver-metaquarium': minor
---

`skyLanterns` — the sky motif. Voxel jellyfish lanterns drift in the water overhead, pulsing as they rise and sink, with a few hanging far out as fogged silhouettes. One draw call, moved entirely in the vertex shader; they borrow the scene's crystal colours and join the light field. Glow cards now lift toward the lens along the view ray, so a bloom sits on its source at the edge of frame too. Bubbles are properly round (the wobble no longer clips on the sprite's square) with fresnel rims sized in pixels.

`horizon` — the far distance. Three hazed rings of silhouettes past the fog line: rock spires, castle-sized crystals in the scene's colours and (from 0.4) one grand geode with its door lit. Unlit, one draw call; drawn as light added to the water colour, so it reads on a black ocean and a bright one alike.

Flora moves again, at no frame cost: the sway is an S-curve that climbs the stalk (kelp snakes, grass flutters), gusts cross the garden and bow each plant as they pass, a band of light runs up every plant and flares its lamp on arrival, and the lamps shed rising spores (one extra Points draw).

`landmark: castle` — the one thing bigger than everything else: voxel curtain walls and six drum towers roofed with glowing crystal spires, a lit gatehouse, banners, a paved road between lamp posts to a round plaza, and a grand geode for a keep. Two draw calls; its spires, gate and lamps join the light field. Bubble highlights now sit at a per-bubble bearing and slide as the bubble wobbles.

`spotRig` + `spotCues` — a rig of up to three follow-spots (`0/#ff8ad0*26, 1/#7fdcff`), each on its own fish in its own colour, and a looping cue sheet (`8s:a, 8s:b, 12s:a+b, 4s:-`) that cross-fades solos, duets and blackouts. Pools add where they cross. New open-stage vignettes `duet` and `trio` ship with matching sheets (`VIGNETTE_CUES`), and a vignette can now send actors to the world's own marks (a castle's `gate`, `plaza`, `courtyard`). `followSpot` alone behaves as before.

`landmark: citadel` — the castle's two-storey version: a wider outer ward, and inside it a raised terrace with its own crenellated ring, four taller spired towers, a stair up from the courtyard, and the keep on top.

Geode homes publish door marks (`home1`…, and `home1in`… inside the throat), so a vignette can send a fish home: out of its own door, to the middle of the village, and back in.

`eyeLife` (default 1) — the eyes are alive: blinks on a personal clock (one in four a double), idle saccades, pupils that lead a turn or a climb, eyes on whoever a vignette has the fish facing, a glance at the camera now and then, wide for a hop, shut for a rest. Vertex offsets on the existing sclera/pupil materials only — no geometry, no draw calls, works on skinned fish; `0` compiles the stock eye program.
