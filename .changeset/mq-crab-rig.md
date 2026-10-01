---
'@idle-screens/saver-metaquarium': minor
---

The crab lives on the seabed now. It used to swim the floor band like a fish, rigid, nose first; it now walks on its own legs.

- **A real rig.** `breeds/rig/crab.py` rigs the delivered model in Blender without changing a voxel of it: 23 rigid parts (body, eye stalks, claw arms and jaws, two-segment legs) and six clips — walk, idle, pinch, forage, wave, cheer. The intake carries the skeleton and clips through greedy meshing, part by part (4,520 triangles, down from 5,960).
- **It walks like a crab.** Sideways, in an alternating tetrapod gait placed by two-bone IK, with the gait's phase set from distance so the feet never slide. It walks in bouts and stops: to pick at the floor and feed, snap its claws, wave a claw like a fiddler crab, cheer with both claws up, or just look around. For a wave or a cheer it turns to face the camera. Between bouts it sometimes turns all the way round, stepping as it goes.
- **On the ground, over the rocks.** It stands on the terrain, on the boulders' real top surface (`ground.ts` rasterises their stone, so it neither hovers on a fish's padded dome nor sinks in), and on a low mound over a crystal colony, tilting with the slope. Crabs give each other room.

Everything is a closed form in t, like the rest of the tank. Scenes without a crab are unchanged.
