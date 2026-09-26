---
'@idle-screens/saver-metaquarium': minor
---

The shoal gets its own clock and swims in open water.

- **Own speed:** `shoalSpeed` (0.3–2, default 0.8) sets how fast the school travels, independent of `swimSpeed`. It glides when steered. The school's life (tail beats, breathing, excursions) runs on real time, so a slow scene no longer has a near-frozen school.
- **Above the plants:** the school keeps above a precomputed canopy of ground, rocks, crystal domes and every plant's tip plus its sway. Each fish stays at least 1.2 body lengths clear, and the school rises ahead of a tall kelp bed. It gets a taller height band of its own (the surface less two lengths, at most 110).
- **In front of the camera:** with a still camera the school follows a crossing lane across the front of the shot. With an orbiting camera it follows the figure of eight.
- `inspect().shoal.inView` reports the share of the school inside the frame.
- **Look change:** scenes that already use `shoal` will see the school higher, in front, and at its own pace.
