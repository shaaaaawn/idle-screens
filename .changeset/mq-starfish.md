---
'@idle-screens/saver-metaquarium': minor
---

A new bundled creature: the starfish (`fishMix: 'starfish:3'`, id 609), the first breed drawn in-house in our designer's voxel style.

- **The model.** `breeds/rig/starfish-model.mjs` draws it voxel by voxel: a five-armed star with a chunky disc, white eyes with black pupils and a black smile on top, dotted arms, and glowing tips (`GLOW-Tips`). Its coat is seeded per fish like every bundled breed.
- **The rig.** `breeds/rig/starfish.py` rigs it in Blender: the disc and its face, two blinking eyes, five arms of three rigid links each, hinged on the underside so a curl closes its seams. Clips: crawl (a ripple running round the arms), idle, wave (a side arm, so the face stays in view), stand (up on two arms, face to you, a five-pointed star) and curl (every arm up round the disc).
- **In the tank** (`src/starfish.ts`) it crawls the seabed face first and climbs the rocks, the crab's way: a closed form in t, its own pace, room for its neighbours (crabs included). When it stops it looks about, curls up, or turns to the camera to wave or stand.
- **Glow that suits a floor creature.** The intake can split one glow material into a primitive per bone (`splitByBone`), so each tip is its own small light on its own arm and stays lit in the neon look; a glow material shared by several meshes is coloured once. A rig can set how much glow it throws (`bloom`): the starfish keeps its tips' bloom low lying down, so it doesn't light the floor like a lamp, and lets it rise as it stands.
