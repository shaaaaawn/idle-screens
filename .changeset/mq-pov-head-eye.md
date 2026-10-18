---
"@idle-screens/saver-metaquarium": patch
---

Riding inside a floor walker (`cameraFollow` on Dot, a crab, an octopus, a snail or a starfish, with `followDistance` under a body length), the camera now sees from the walker's own eye. It used to sit at its feet + 1.5, held at floor + 7, and look level at its feet 60 units on: on Dot that is ankle height, so curbs, sign posts, basins and the other floor folk filled the frame and any rise ahead read as a wall. The eye height is measured once from the model at load (Dot's screen face, the others' eyes, else near the top of its bounds) and scales with the walker's size; it looks along the heading at eye height, pitched (at most ~15°) with the seabed's rise ahead, so a path up or down a hill stays in frame. Swimmers' first-person eye and every chase camera are unchanged.
