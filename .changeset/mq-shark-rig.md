---
'@idle-screens/saver-metaquarium': minor
---

The shark hunts now, and the bundled voxel breeds got much lighter.

- **A rigged shark.** `breeds/rig/shark.py` rigs the delivered model in Blender without changing a visible voxel, cut by position (its fins sit off the lattice): the head, a lower jaw ringed with metal teeth, eyes that roll back, the pectorals, and a three-link tail so the swim is a true wave down the body. Clips swim and bite, driven by `src/shark.ts`: the tail beats slow and heavy with the distance swum (it patrols by default), and on some cycles it strikes — snout up, jaw wide, eyes rolled back, the lunge, the snap, a thrash.
- **One body, not three pieces.** The spine is soft: body vertices blend between neighbouring spine bones over a few voxels, so the bite and the thrash bend the shark instead of splitting it at the joints. The jaw rests nearly closed, and the thrash is spread down the whole body.
- **Metal teeth that don't flicker** (the `METAL-` role, as the glowfish's). Lit metal is satin now (metalness 0.75, roughness 0.38, a little light of its own): a mirror-flat voxel face reflected one direction of the room and flipped white ↔ black as the jaw moved. Where two materials share a face of a cell, the intake keeps the smaller one, and eye, metal and kept parts get a polygon offset, so teeth and eyes never z-fight the body.
- **Buried faces culled.** The intake drops every face that a whole cube sits right in front of. Some sources kept every face of every cube: the shark goes from 5,726 triangles to 3,476 (215 KB to 213 KB, soft spine included), the crab from 4,540 to 1,482, the dori from 1,692 to 452, the blowfish from 2,280 to 1,274, the hackerfish from 612 to 204. Every breed's visible surface is unchanged (compared cell by cell and in the breed lab).
- **`followAngle`** now swings the camera round the fish's own heading, so a side or face camera stays square to a long fish too.
