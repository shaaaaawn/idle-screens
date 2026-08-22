---
'@idle-screens/schema': patch
'@idle-screens/savers-classic': patch
'@idle-screens/saver-black-hole': patch
'@idle-screens/saver-catwalk': patch
'@idle-screens/saver-tide': patch
'@idle-screens/saver-limelight': patch
'@idle-screens/saver-slipstream': patch
---

core `peerDependency` is now `workspace:^` so publishes emit a caret range instead of an exact pin. Mixed-version installs of sibling savers previously failed `npm ci` with ERESOLVE. (`saver-metaquarium` ships the same change in the gateway-resilience changeset.)
