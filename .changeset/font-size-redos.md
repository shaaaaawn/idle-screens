---
'@idle-screens/schema': patch
---

Fix a denial of service in font-size parsing (CodeQL `js/polynomial-redos`).

`compileSaver` matched the size token in a CSS font shorthand with
`(\d*\.?\d+)px`. Two quantifiers can split the same digit run many ways, so a
run that never reaches `px` made the engine retry every split at every start
position. `sprite.font` is authored input, which makes this reachable by
anyone who can publish a spec:

| `font` value        | before   | after  |
| ------------------- | -------- | ------ |
| 1 000 digits        | 600 ms   | <1 ms  |
| 5 000 digits        | 62 s     | <1 ms  |
| 200 000 digits      | (hours)  | 4 ms   |

The digit runs are now bounded, making the work per start position constant.
No behaviour change for real font shorthands — `16px`, `16.5px`, `.5px`,
`bold 26px monospace` and `12px/1.4 system-ui` all parse exactly as before.
