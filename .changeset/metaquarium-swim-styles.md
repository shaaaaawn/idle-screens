---
'@idle-screens/saver-metaquarium': minor
---

Swim styles: a curated `swimStyle` enum (`loop` — the pre-style behaviour, so the default changes nothing — plus `school`, `drift`, `hover`, `patrol`, `bottom`, `surface`), with two uniqueness dials rather than per-fish authoring: `swimVariance` (0 a uniform shoal, 1 every fish visibly its own animal) and `bodyWiggle`, a distance-driven body yaw for the many models that carry no animation clip and were previously gliding rigidly. `school` is the closed-form carrier formation measured in the boids spike — 0.85 polarisation against reference boids' 0.87, with collisions down from the independent-loop 23–25% to single digits — and, like everything here, it is a pure function of `(index, t)`.
