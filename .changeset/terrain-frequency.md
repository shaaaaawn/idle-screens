---
'@idle-screens/saver-metaquarium': patch
---

Terrain you can see, wedges that stack. `dunes` had 571-unit swells — less than one in frame at any camera, so it rendered as a smooth tilt (a QA A/B showed identical rooms with only ridges showing relief); wavelengths now put 2-3 swells in the visible footprint, and `basin` gains a near-floor ripple. Stacked wedges get wing droop too (centred on the mean rank so the vertical extent never grows), with a tighter multi-layer pitch so three Vs plus droop fit the water column. Light-shaft alpha retuned 0.34→0.13 and cones narrowed — with the shafts finally in frame, the pass-1 alpha turned ice into white pyramids.
