---
'@idle-screens/schema': patch
---

Field `quantize` / `octaves` glides step through whole levels (X477): a timeline key, steer or morph gliding `background.quantize` 0 → 6 no longer fails validation mid-glide — in-between values round, and a `quantize` under 1.5 resolves to 0 (smooth), as the painter already drew it. New `layout-text-overlap` advisory (X214) when cells of one `list`/`table` text layer overlap because the `gap` pitch is narrower than the labels; it names the gap that clears them. FORMAT.md: the 800-entity total in the `layers[]` table, the `wander.meander` cap (0.463), `pulse.amp` is added to alpha, `spin`'s start angle comes from the shared seeded stream, text layers have no `colors`, `gap` is a pitch, polygons fill nonzero (holes need reversed winding), keyed `points` stay in the unit box scaled by the seeded radius, ring width is centred on the radius, and `font` uses installed faces only.
