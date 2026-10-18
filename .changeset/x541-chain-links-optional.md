---
'@idle-screens/schema': patch
---

`links` in `mode: "chain"` no longer requires `k` or `maxDist` (X541). A chain wires entities in order and reads neither, as FORMAT.md already said, but the validator and the JSON Schema demanded both for every mode. A chain may now omit both; `maxDist` is required only alongside `falloff: true`, where it is the fade distance, and either field is still range-checked when given. `nearest` and `random` are unchanged. Every reader (render, perception, advisories, `describeScene`) goes through the new `linkMaxDistPx` helper, which reads an absent `maxDist` as no cutoff and never feeds NaN into a falloff. `describeScene` now counts a chain's expected links as the chain itself instead of k-nearest. Type note: `LayerSpec.links.k` and `.maxDist` are now optional, so a consumer that reads them directly must handle `undefined`.
