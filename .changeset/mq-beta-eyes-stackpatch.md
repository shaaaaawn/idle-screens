---
"@idle-screens/saver-metaquarium": patch
---

A betta under `nearFade` no longer fails to draw. Its eye rig chained the material's shader hook by hand, untagged, so `nearFade` (and any other tagged patch) saw itself missing and wrapped a second time: `vMqNearDepth` declared twice, and the betta's metal, glow, eye and halo parts failed to compile once its model arrived. The rig now stacks through `stackPatch` like every other patch, and a test keeps hand-made hook chains out of the package.
