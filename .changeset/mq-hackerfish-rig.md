---
'@idle-screens/saver-metaquarium': minor
---

The hackerfish is half fish, half computer now: its face is a screen.

- **A rigged hackerfish.** `breeds/rig/hackerfish.py` rigs the delivered model in Blender without changing a voxel: the monitor-head box, its screen (on a bone of its own, so it can rattle in its bezel), two paddle fins and a tail. Clips swim, type and glitch, driven by `src/hacker.ts`.
- **A face that is a display.** A new `SCREEN-` role (`src/screen.ts`): the glass and the face pixels become one 10×10 phosphor display on the screen's front, the designer's own face its neutral expression, doubled. It changes expression every few seconds with a scan-down refresh — happy, wink, cool, love, surprised, sleepy — and the neutral face blinks. Once a cycle it hacks: a focused face, then code rain while its fins type. Some hacks end in a crash: the screen tears, shows x_x, boots with a spinner, and comes back happy. Each fish has its own phosphor (green, amber, cyan, the designer's pink, cold white), and the screen throws its light. Never more than three changes a second.
- **`followAngle`.** Swings the chase camera round the followed fish (0 behind, 180 in front looking back at its face) — a hackerfish's screen, a crab's smile.
