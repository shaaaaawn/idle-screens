---
"@idle-screens/saver-metaquarium": patch
---

Underwater signage. A new `signs` param puts up to eight voxel signs in the world: a painted `plank` on a post, an `arrow` aimed at another place, a life-`ring` with a name plaque, a lit brass `porthole` (a word or a fish), glowing `neon` lettering with a halo and light on the floor, and an `led` dot-matrix board in the hackerfish's pixels that scrolls a long line. `kind[@place][>target][/#color][*size][:text]`: each stands beside its place (the castle's gate and plaza, the paths' hub, the fountain, a home's door, or the open tank's marks), facing the front, and fish swim round it. Lettering is a new 5×7 pixel font. The validator reports a sign whose place is not in the scene, the guide documents the grammar, the anatomy lists each sign, and the playground's world panel has presets.
