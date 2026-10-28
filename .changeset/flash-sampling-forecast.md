---
'@idle-screens/schema': minor
---

New export `flashSamplingForecast(spec)`: the timeline flash gate's sampling plan with no frame resolved. It takes the same walk as `timelineFlashReport` (the dense windows weighted for coincident jumps, the per-cell pre-check with keyed transforms bounded by their swept footprint, the chunked walk and its 512-frame budget), so it says for the cost of the arithmetic whether the check will run out of budget. `exhausted: true` means `timelineFlashReport` is certain to fail: `incomplete` at the same `at` and `boundariesPerSecond`, unless it finds a flash in the frames it does resolve first. It also returns `samples` (frames the check resolves if it finds no flash), `needed` (frames the whole walk would take with no budget), `budget`, and `report`, the report the check returns when it finds no flash. Both functions now share one internal walk, so the forecast cannot drift from the check. `timelineFlashReport`'s results are unchanged.
