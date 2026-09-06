---
'@idle-screens/schema': minor
---

Data layout — the dashboard genre stops needing one layer per number
(idle-mono registry #49):

- **`layout: { type: 'list', gap? }`** and **`{ type: 'table', columns, gap? }`**
  place a layer's entities in reading order — one column, or `columns`
  row-major — `gap` apart (viewport units of `min(w,h)`, default 0.06), from
  `position` as the block's top-left anchor (now allowed with any `count`
  under these layouts) or centred in `region`. Text and emoji sprites take
  `strings[i]` / `glyphs[i]` in order instead of a seeded pick, and palette
  `colors[i]` likewise, so N labels are one layer. The layouts burn the two
  scatter draws, so toggling one on or off leaves the rest of the layer's
  stream intact.
- **`bar`** sprite — `{ values, length, thickness, color, max?, direction? }`.
  Entity i draws `length × values[i] / max` toward `direction` (`right`
  default, `left`, `up`, `down`). `values` are paint, read at draw time, so
  `setParam("bars.values", [...])` glides every bar; `max` defaults to the
  largest value. Perception measures each bar at its current value.
- New advisory warning `list-length-mismatch` when a data layout's `count`
  disagrees with the number of strings / glyphs / values it will read.

New shipped example `relay-board`: a six-row status chart in five layers —
labels, bars, readouts, a title and a dust field — where the benchmark
dashboards averaged twenty-five hand-positioned `count: 1` blocks. Existing
entity streams are byte-identical.
