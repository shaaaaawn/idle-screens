---
'@idle-screens/saver-metaquarium': minor
---

`cameraFollow` + `followDistance` — ride with one fish. The camera sits `followDistance` behind the chosen cast slot along the way it has been swimming (the chord to where it was two lengths back on its own closed-form path, so a wiggle or a kick does not swing the shot), lifted a little, looking just past it; kept above the floor and any scenery and under the water ceiling. Under about one body length it becomes the fish's own eye and the fish is hidden. Everything is sampled closed-form at `t`, so the shot is the same however a frame is reached. The orbit params are ignored while following; `-1` (default) is the orbit camera, byte-for-byte as before. `inspect().camera.follow` reports the camera's position.
