---
'@idle-screens/saver-metaquarium': patch
---

`floorCover` parsing no longer backtracks quadratically on a long run of spaces. A 50 000-character value froze a viewer for about 8.5 s (CodeQL js/polynomial-redos), the same pattern as `townProps`. The other mix parsers (flora, geode, pyramid) use a single anchored `\s*` and stay linear.
