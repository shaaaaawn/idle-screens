---
'@idle-screens/saver-metaquarium': minor
---

The shoal: a new `shoal` param (0..1, default 0) adds an ambient school of small voxel fish beside the cast, and `shoalKind` picks `neon`, `rummynose` or `ember`. Seats are relaxed at seed time into an even, row-free school. Each fish follows the route at its own distance along it, so the school bends through a turn instead of pivoting. They beat in burst-and-coast with a body wave, and now and then one drops back, rises or slips out to the side and returns, at most three at a time. Headings follow the route, steered by each fish's own motion. A stateless separation pass keeps fish at least 0.8 body lengths apart. It is closed-form in t and one instanced draw, with up to 2.5× the tier's fish cap. `inspect()` reports the count, the fish out, the nearest pair and polarisation.
