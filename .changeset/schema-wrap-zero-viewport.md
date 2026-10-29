---
'@idle-screens/schema': patch
---

Fix a soft circle on `drift`, `rise` or `wander` throwing `createRadialGradient … non-finite` on every frame when its canvas is 0 wide or high (mounted hidden, collapsed or before layout). The wrap range was 0 there and `% 0` made the position NaN; it now pins to the range's edge until the first resize rebuilds the layer.
