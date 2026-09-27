---
'@idle-screens/saver-metaquarium': patch
---

The shoal's tetras no longer shimmer. Each slice of a shoal fish built its lateral line as a box 2 % wider than the body, laid over it: the stripe's side faces sat ~0.001 units off the body's and its slice ends were coincident with them, inside the depth buffer's resolution at viewing distance, so stripe and body fought pixel by pixel — a flickering comb of blue teeth along every neon (and a torn silver line on rummy-nose and ember). The back, lateral line and belly are now three bands stacked flush with no overlap; the look is otherwise identical (same colours, same bands, same vertex count, no shader change). A geometry test now fails on any pair of same-facing faces that are coincident or within 0.01 units with overlapping extent.
