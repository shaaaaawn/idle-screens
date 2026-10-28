---
"@idle-screens/schema": patch
---

Timeline flash gate: a jump that lands on another key of the same path counts as two changes. A `dur: 0` key (or a `step`-eased key's landing) that falls on another key's boundary on one path snaps the value and glides on from it, so the frame changes twice at that time. The gate counted distinct times, so a full-frame sawtooth keyed at the 200 ms floor (a step and a glide at the same `t`, every 200 ms; 5 flashes a second) never reached the density that triggers a check and passed. `timelineFlashReport` now weighs those times twice when it looks for dense seconds, per grid cell as well, and refuses the sawtooth at 5 a second. Times shared across different paths still share one check, a chain of glides that meet end to start is not double-counted, and one jump-then-glide per lap (a loop seam reset) still passes. Over 740 stored and example scenes with timelines, no verdict changed.
