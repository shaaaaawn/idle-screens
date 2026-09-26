---
'@idle-screens/schema': patch
---

Validator and steering papercuts found by cold-start agents:

- Size-range errors are unit-aware. `radius`, `length`, rect `width`, layer `size` and orbit `radius` now say "must be a [min,max] range of positive fractions of min(width, height)" under the default viewport units, and "positive px" only when the spec declares `units: "px"`.
- A [min,max] range on a scalar-only field (ring/streak/stroke `width`, bar `length`/`thickness`/`max`, text `maxWidth`, textBlock `maxWidth`/`fontSize`, links `maxDist`/`width`, gradient `band.height`) now reports "must be a single number > 0, not a [min,max] range" instead of the misleading "must be > 0".
- `steerablePaths` no longer advertises properties the validator flags as unknown or misplaced (e.g. `background.angle` on a gradient, `blend` inside a sprite), since the renderer ignores them. The new `ignoredPropertyPaths(spec)` export returns those paths without mutating the spec.
