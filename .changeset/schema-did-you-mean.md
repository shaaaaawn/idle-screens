---
"@idle-screens/schema": minor
---

Validator messages now say what was probably meant. Each hint is appended to the existing message; the original wording, codes and paths are unchanged.

- An unknown field that another type owns names that type: `sway` on a drift motion "belongs to motion type 'rise'", `sides` on a circle "belongs to sprite kind 'polygon'", `stops` on a solid background "belongs to background type 'gradient'". A sprite or motion field written on the layer (`color`, `speed`) is told which of the two it "belongs inside", and a layer field written inside a sprite (`opacity` or `position` on a circle) that it "belongs on the layer".
- Any other unknown field gets the nearest known name at that level (`raduis` → "did you mean 'radius'?"), in scenes and sequences alike. So do the reveal/caret field errors and every `must be 'a' | 'b'` enum error (`blend: 'lightr'`, `sync: 'epoc'`).
- A timeline key on a path that does not resolve suggests the steerable path it was likely meant to be (`layers.0.speed` → `layers.0.motion.speed`).
- The curated hints (`delay` → `life.enter`, `id` → `key`, the F142 shape hints) still come first, and only one hint is ever added.
- A suggestion is made only when one candidate is clearly closest: one edit for names of 3–5 characters and two for longer ones, with a transposed pair counting as one and case ignored. A tie suggests nothing.
- New exports `nearest(name, candidates)`, `nearestPath(path, candidates)` and `suggestSpecPath(spec, path, paths?)` (index or layer-key paths, checked against `steerablePaths` or the `paths` passed), so idle-server's setParam/setTrack errors can use the same rule.
