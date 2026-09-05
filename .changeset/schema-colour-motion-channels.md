---
'@idle-screens/schema': minor
---

Perception gains the two channels edits are usually about. They come from the MCP comprehension eval of 2026-07-28 (P2 F3/F4/F6, P3 F5/F6). They were written on 2026-09-05 (`ae85cc2`), but the commit never reached `develop` until now.

- **`motionStats` (additive):**
  - `meanSpeed`/`maxSpeed` stay px/s.
  - New `meanSpeedVp`/`maxSpeedVp` give the same speeds in viewport units/s, which don't change with preview size.
  - `moving` is judged in viewport units, so it gives the same answer at every size. It used to be a 0.5 px/s floor.
  - Each layer also reports `heading` (screen degrees) and `headingSpread` (0 = conveyor, 1 = scattered).
- **New `sceneColour()` / `perceiveScene().colour`:**
  - Hue, saturation, warmth and hex for the alpha × area weighted sprite mass and for the background plate.
  - Resolved at `t` through the timeline, and weighted by paint opacity.
  - Sequence frames report the segment's sprites over the bed's plate.
- **`diffScenes`:**
  - New `colour` channel: `hueShift`, `saturationDelta`, and `warmthDelta`, the cooler/warmer axis that `meanLuminance` gets backwards.
  - New `motion` channel: overall and per-layer speed deltas with headings, in viewport units.
  - Advisories run at the diff's own viewport.
