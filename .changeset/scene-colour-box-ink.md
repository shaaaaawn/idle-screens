---
"@idle-screens/schema": patch
---

Scene colour (`perceiveScene().colour`, `diffScenes().colour`) now weighs every sprite by the ink it lays down. That is the area dominance counts, without dominance's extra weight on thin lines. A layer's `transform.scale` now scales a sprite's weight by its square, as it does in dominance. Before, every sprite but a circle was weighted as a square of its size:

- a thin rule, ring, streak or stroke counted as a box as long as itself;
- a bar counted at its full length;
- a small triangle counted as its circumradius square;
- a label counted as one glyph, however long;
- a scaled layer counted at its unscaled size.

So one thin line could set a scene's colour. In the shipped examples:

- `signal-board` read green from its one 0.0016-wide sweep stroke. It now reads amber, like its bars, labels and caption.
- `lobby-talk`'s five small bars were weighted about 24× their ink.
- `typed-cue` read as its faint scan band. It now reads as its text.

Dominance is unchanged.
