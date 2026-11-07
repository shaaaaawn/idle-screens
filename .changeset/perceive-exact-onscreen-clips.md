---
"@idle-screens/schema": patch
---

Dominance and scene colour now clip every shape to the frame as it is painted, turned as it is turned. Before, most kinds were clipped as a square about the sprite. Each kind is now clipped this way:

- a circle as its disc (a `soft` one weighted by its gradient);
- a ring as its stroked annulus;
- a small polygon as its outline;
- a path drawing as its turned frame box, not that box's bounding box;
- a streak as its segment from tail to head, weighted by its fade;
- a stroke by the length of its path, taper-weighted.

So a disc half its radius in from the edge keeps 80 % of its area, where the old square kept 75 %. A streak whose tail hangs off the edge loses that dim tail, and a long stroke counts the part of its line that shows. In the shipped examples, `signal-board`'s 1.4-long sweep stroke rises from 0.20 to 0.32 of the scene. No example changes its top layer.
