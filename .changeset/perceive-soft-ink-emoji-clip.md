---
"@idle-screens/schema": patch
---

Dominance and scene colour now weigh a `soft` circle by the ink of its gradient. The canvas fades it to nothing at its radius, so that is about 38 % of its disc. Before, it counted as a solid disc, so a dim additive haze could outrank the scene's subject. In the shipped examples, `lobby-talk`'s data bars now lead its haze, and `orrery`'s corona falls from 0.77 to 0.56 of the scene. An `emoji` is also clipped to the frame by its glyph box turned with the sprite, as the luminance maps already turn it, so a turned emoji near an edge counts only the part that shows.
