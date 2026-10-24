---
'@idle-screens/schema': patch
---

Validating a long timeline is 2–5× cheaper, and `steerablePaths` no longer validates the timeline at all. The validator's per-key and composed-state checks used to deep-copy the whole spec at every key and sample time. They now share every subtree a key doesn't touch (an internal `applyDeltasShared`). Path-geometry verdicts are cached per d string. `ignoredPropertyPaths` (inside `steerablePaths`) skips the applied-key checks, which never produce the unknown-property warnings it reads.

Measured on 13 production scenes of 64–132 KB with 48–248 keys: `validateSpec` 50–327 ms → 11–187 ms, and `steerablePaths` 29–294 ms → 1–6 ms. The server ran this work several times per `/state` read, and heavy scenes on idlescreens.com were failing with Cloudflare 1101 (Worker threw an exception); cutting it is the main lever on that.
