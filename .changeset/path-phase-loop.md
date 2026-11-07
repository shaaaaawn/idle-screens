---
"@idle-screens/schema": minor
---

`path` motion can now be choreographed exactly: a fixed `phase` and a `loop` mode that stops it (registry row 69). Both fields are opt-in, and a spec that declares neither builds and renders exactly as before.

- **`motion.phase`** (0 ≤ phase < 1) replaces the seeded starting phase. It is the fraction of the lap at t = 0, the same quantity the seed used to pick: a closed lap passes point *k* of *n* at `k / n`, and an open lap, which goes there and back, reaches its last point at 0.5. With `count` > 1, entity *i* starts at `(phase + i / count) mod 1`, which gives an evenly spaced procession. A fixed-phase layer's count is exact and is never density-scaled, the same exemption a grid gets. Without it, a count-1 dancer would gain a twin on a 4K wall. The seeded draw is still consumed, so at the reference viewport declaring `phase` moves no other seeded value. At other viewports it can change how many entities the layer builds, as changing `count` would.
- **`motion.loop`**: `"loop"` (the default) keeps today's behaviour; `"once"` runs to the end of its lap (back at the first point) and rests there; `"hold"` runs to the last point and rests there (arrive and stay; a closed path does not run its closing segment). An entity that starts past its stopping point reaches it on the next lap.
  - Until it stops, the motion is exactly the loop's: the same speed and the same knot times. A resting `streak` or oriented `stroke` keeps the heading it arrived with.
  - The pass is a pure function of scene time, so seeks and `renderFrame(t)` agree. Under `emit` it replays from `phase` on every event, and its `trail` starts at the event rather than ribboning back across the replay. `trailEchoes` takes a new optional `since`, and the new export `trailSince` gives it.
  - A layer `clock` does not affect it, and a looping `timeline` does not replay it. The new informational advisory `path-runs-once` says so.
  - `scenePeriod` reports no repeat for a stopping path without `emit`.
- **Steering.** `phase` is advertised by `steerablePaths` and glides. Because `motion` is structural, the scene is re-placed every frame of the glide, but nothing re-seeds. A `timeline` key on it no longer warns `timeline-structural-key`. `loop` is an enum: it resolves and steps, but it is not advertised, the same as `curve`.
- The validator, JSON Schema, FORMAT.md and the tvOS/iOS native renderer all handle both fields.
- New export `pathStop(loop, closed, n, phase)`: the lap progress at which a `once` / `hold` entity rests. A production tool can use it to time a scene's knots, where it used to read the seeded phase back.
