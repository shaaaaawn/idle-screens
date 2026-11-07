---
"@idle-screens/schema": patch
---

Dominance and scene colour count the part of a `rect` that is on screen by its own box, turned as it is painted. Before, the box was a square as wide as the rect and never turned. A thin full-width rule near the top edge counted at about 60 % (the dev-dashboard example's header and footer rules), and a plank stood on end along the bottom edge counted as if it were lying flat. A `bar` also turns with its layer's or group's `transform.rotate` here now, and a turned rect or bar is clipped by its exact turned box, not its bounding box.
