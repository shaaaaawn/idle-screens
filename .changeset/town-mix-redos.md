---
'@idle-screens/saver-metaquarium': patch
---

`townProps` parsing no longer backtracks quadratically on a long run of spaces. Two adjacent `\s*` runs made a 50 000-character value freeze a viewer for about 7 s (CodeQL js/polynomial-redos). Whitespace is still allowed around `:` and `/`; a space inside a word or number is rejected, as it effectively was before.
