---
'@idle-screens/saver-slipstream': patch
---

Keep the streamline crossfade from taxing the steady state, and advect dust /
dashes along a continuous phase integral so the page lean follows live wind
rather than a stale flow-bucket snapshot. Amortize streamline integration across
the bucket window so bucket rebuilds stay smooth under `renderFrame(t, seed)`.
