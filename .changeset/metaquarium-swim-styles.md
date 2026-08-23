---
'@idle-screens/saver-metaquarium': minor
---

Swim styles: a curated `swimStyle` enum (`loop` — the pre-style behaviour, so the default changes nothing — plus `school`, `drift`, `hover`, `patrol`, `bottom`, `surface`), with two uniqueness dials rather than per-fish authoring: `swimVariance` (0 a uniform shoal, 1 every fish visibly its own animal) and `bodyWiggle`, a distance-driven body yaw for the many models that carry no animation clip and were previously gliding rigidly. Both default to 0, like every param this saver adds: a scene already on a wall does not move differently because a dependency was bumped.

`school` is a closed-form carrier formation — one arc sample per frame, fish held at rigid offsets from it. Measured over 4 seeds x 600 frames at 8 fish and variance 0.6: independent loops put a neighbour inside one body length in 27.8% of fish-frames (closest approach 1.3 units, polarisation 0.38); the formation reaches 0.0% (closest approach 27.3 units, polarisation 1.00). The spacing half of that is a unit test, so the claim is enforceable rather than remembered. Earlier drafts of this changeset quoted 0.85 polarisation from the boids spike — that number described the prototype, not this port.
