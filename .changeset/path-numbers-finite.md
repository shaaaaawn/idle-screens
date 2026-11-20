---
'@idle-screens/schema': patch
---

The validator refuses a path whose numbers are not finite or exceed ±1000000 (`every number in a path must be finite and within ±1000000`). An arc radius past ~9e12, or a `1e400` token anywhere in an arc or curve, made `flattenPath` clamp or silently drop the curve, so the path passed; the iPhone and Apple TV apps' flattener converted the same segment count to an integer and crashed on every screen that loaded the scene. The apps are fixed too, but only new builds get that fix: refusing the numbers here protects the builds already installed. Nothing that draws needs such a number (a drawing lives in the -1..1 box; an arc that flat is a straight line), and `flattenPath`'s own output is unchanged.
