# @idle-screens/saver-limelight

Passthrough theatre-light screensaver for idle-screens: a roaming key light that lifts the live page's blocks into set pieces and makes them cast shadows on each other. Seeded, paramSpace, control-track, frame-addressable.

The page stops being a surface an effect is applied to and becomes a **set**.
Each block gets a height, stands off the page with parallax, and casts a real
silhouette shadow onto the stage — and a block standing behind another block is
dimmed by it. That block-on-block occlusion is the point: the content interacts
with itself, not just with the saver.

`lightX`/`lightY` are the steered position of the key light and the roam is an
offset around them, so a control track that pins `roamX: 0, roamY: 0` hands an
agent absolute control of where the light points.

Occlusion resolves on a clock bucket derived from `t` (never a frame counter),
so `renderFrame(t, seed)` reproduces a frame exactly — canvas *and* page.

See the [idle-screens repository](https://github.com/shaaaaawn/idle-screens) for full documentation.
