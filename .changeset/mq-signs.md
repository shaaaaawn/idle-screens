---
"@idle-screens/saver-metaquarium": patch
---

Underwater signage. A new `signs` param puts up to eight voxel signs in the world: a painted `plank` on a post, an `arrow` aimed at another place, a life-`ring` with a name plaque, a lit brass `porthole` (a word or a fish), glowing `neon` lettering with a halo and light on the floor, and an `led` dot-matrix board in the hackerfish's pixels that scrolls a long line. `kind[@place][>target][/#color][*size][:text]`: each stands beside its place (the castle's gate and plaza, the paths' hub, the fountain, a home's door, or the open tank's marks), facing the front, and fish swim round it. Lettering is a new 5×7 pixel font. The validator reports a sign whose place is not in the scene, the guide documents the grammar, the anatomy lists each sign, and the playground's world panel has presets.

An LED board's words are live data: when a `signs` change touches nothing but LED text, the boards swap their text in place (a new texture, the line entering from the right edge) instead of rebuilding the world. `parseSignMix` and the sign constants are exported from `./manifest`.

Each kind has its own form and wears its age: a crooked hand-cut `plank` with chipped paint between end posts, a fingerpost `arrow` that points at its place in 3D, a barnacled dock piling with a rope coil for the `ring`, a `porthole` in a torn wreck plate half in the sand, a `neon` shop sign hung from a bracket on chains whose letters hum and now and then hiccup (flash-safe), and an `led` board with a face on each side. Lettering reads from behind too. Three recipes now carry signs: `geode-harbor`, `castle` and `reef-characters`.

Neon and LED signs run on unstable power: `signFlicker` (0–1, default 0.4) adds a hum, stutters, a dead row or tube, a slipped row and the odd reboot that wakes row by row — each sign its own supply, the halo sagging with it, flash-safe by construction (one event per 4 s slot; tested against the validator's WCAG rule). Commas inside a sign's unquoted words stay in its words.
