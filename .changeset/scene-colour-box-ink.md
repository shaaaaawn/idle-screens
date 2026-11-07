---
"@idle-screens/schema": patch
---

Scene colour (`perceiveScene().colour`, `diffScenes().colour`) now weighs a `rect` and a `bar` by the ink of its own box, the same area dominance counts. Before, each was weighted as a square as wide as the rect or as long as the bar's full length. A thin rule, a short bar, or a near-invisible feathered band could then set the scene's colour. In the shipped examples, `lobby-talk`'s five small bars were weighted about 24× their ink and hid its haze, and `typed-cue` read as the colour of its faint scan band rather than its text. Dominance is unchanged.
