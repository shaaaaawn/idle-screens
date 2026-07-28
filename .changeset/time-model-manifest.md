---
'@idle-screens/core': minor
'@idle-screens/savers-classic': patch
'@idle-screens/saver-black-hole': patch
'@idle-screens/saver-tide': patch
'@idle-screens/saver-limelight': patch
'@idle-screens/saver-slipstream': patch
'@idle-screens/saver-catwalk': patch
---

`SaverManifest.timeModel` (`'closed-form' | 'simulated'`) — a semantic claim
about how the saver relates to time, so tooling can prefer it over hardcoded
per-saver capability lists. Catalog savers declare theirs; the playground
properties panel surfaces the claim.
