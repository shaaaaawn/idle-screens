---
"@idle-screens/schema": patch
---

Advisories stop flagging established idioms, and a few messages and docs get more exact. Nothing the validator accepts or refuses changes, and no pixel changes.

- `role: "atmosphere"` text is left out of `text-overlap`, `layout-text-overlap` and the validator's `list-length-mismatch` warning (X807).
- `low-contrast-layer` and `text-legibility` judge a mark on a path drawing against the drawing: static, unblended path parts, area-weighted (X783).
- `uniform-motion` compares an orbit's on-screen speed, angular speed × radius (X739).
- `dense-scene` and `full-coherence` read the declared `count`, so a small preview and a 4K screen agree (X771).
- `text-overlap` checks a pair over the piece: at the sample instant and every key boundary of a timeline that keys the text, a box counts only while it shows (opacity in force, effective scale > 2 %, a begun reveal, on screen), and only pairs visible together are reported. A sequence segment is never sampled past its end. `text-heavy` counts text as static only when no key touches it (X759, X776).
- New informational advisory `life-runs-once`: a layer's `life` under a looping timeline plays once from mount and never replays (X808).
- `morph-structural-mismatch` (validator and advisory) and `wrap-morph-inactive` name the fields that differ, e.g. `layers[2].layout.type: grid → list` (X810). New exports `structuralDifferences` and `describeStructuralDifferences`; `structuralSignature` is byte-identical.
- FORMAT.md: how ghosting composites (a translucent sprite builds to a/(1−g(1−a))), `life` runs on scene time from mount, and the field raster's real resolution (X805, X808, X760).
