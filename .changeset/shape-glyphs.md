---
'@idle-screens/schema': minor
---

Shape glyphs — the path-based sprite family nine of the fifteen style
profiles asked for (idle-mono registry #46):

- **`polygon`** — `{ radius, color, sides? | points?, soft? }`. A regular
  n-gon (3..12 sides, default 6, point up) of the seeded circumradius, or any
  facet from 3..24 unit-coordinate `points` scaled by the radius. `soft`
  feathers the fill from the centre. Rotates with `spin`; `points` are paint,
  so two polygons with the same point count `morph`.
- **`stroke`** — `{ length, points, color, width?, curve?, taper?, orient? }`.
  A freehand mark: a Catmull-Rom spline (or polyline) through 2..24
  unit-coordinate points, scaled so the unit box spans the seeded `length`,
  stroked with round joins; `taper` thins it to almost nothing at both ends
  (a brush stroke, not a line); `orient` turns it along the heading like
  `streak`.
- **`rect.feather`** (0..1) — a soft-edged rectangle: that fraction of the
  half-size fades out toward the border, drawn as nested fills whose
  composited alpha ramps linearly (exact under source-over, summed under
  additive blends).

Both new kinds take `colors[]` / `colorWeights` like every shaped sprite,
and every geometric fact lives in one module (`shapes.ts`) shared by the
renderer and the perception model: polygons splat as their disc weighted by
fill ratio, strokes stamp along their sampled path, feathered rects weigh
their soft band at half. New shipped example `facets`. Existing entity
streams are byte-identical (no new draws for existing kinds).
