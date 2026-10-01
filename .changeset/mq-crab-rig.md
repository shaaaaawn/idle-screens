---
'@idle-screens/saver-metaquarium': minor
---

The crab lives on the seabed now. It used to swim the floor band like a fish, rigid, nose first; it now walks on its own legs.

- **A real rig.** `breeds/rig/crab.py` rigs the delivered model in Blender without changing a voxel of it: 23 rigid parts (body, eye stalks, claw arms and jaws, two-segment legs) and six clips — walk, idle, pinch, forage, wave, cheer. The intake carries the skeleton and clips through greedy meshing, part by part (1,482 triangles once buried faces are culled, down from 5,960).
- **It walks like a crab.** Sideways, in an alternating tetrapod gait placed by two-bone IK, with the gait's phase set from distance so the feet never slide. It walks in bouts and stops: to pick at the floor and feed, snap its claws, wave a claw like a fiddler crab, cheer with both claws up, or just look around. For a wave or a cheer it turns to face the camera. Between bouts it sometimes turns all the way round, stepping as it goes.
- **On the ground, over the rocks.** It stands on the terrain, on the boulders' real top surface (`ground.ts` rasterises their stone, so it neither hovers on a fish's padded dome nor sinks in), and on a low mound over a crystal colony, tilting with the slope. Crabs give each other room. A crab keeps its own pace: the global `swimSpeed` no longer hurries or slows it.

Everything is a closed form in t, like the rest of the tank. Scenes without a crab are unchanged.

The crab's mouth (and the dori's eyes) no longer flicker. The breed intake drops a body face that lies under an eye decal, but it keyed faces by an unsnapped plane, and the delivered models put the body a hair (0.0002) off the decal's plane, so the two stayed and z-fought. Planes snap to the lattice now; a breed test holds every voxel breed to no body face under a decal.
