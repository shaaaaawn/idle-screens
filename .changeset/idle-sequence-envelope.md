---
'@idle-screens/schema': minor
---

Add `idle-sequence` envelope format — multi-segment timelines over SaverSpecs

New top-level format for composing multiple SaverSpecs into a sequenced
timeline. Each segment carries an unmodified SaverSpec, a duration, and an
advance mode (`auto`, `input`, or `either`). Global time `T` maps to
`(segmentIndex, localT)` via prefix sums; the final segment may omit duration
to hold indefinitely. `loop: true` wraps the timeline.

`compileSequence()` returns an ordinary `SaverPlugin` — the viewer needs zero
changes. The instance lazily mounts child SpecInstances and delegates
`renderFrame(T, seed)` to the resolved child. Segment switching via
`applyTrack` uses the `sequence.segment` path, so existing `setParam`
machinery becomes the clicker with no new server verbs.

Transitions are `cut`-only in v1 (`fade` rejected at validation). Flash safety
is preserved: the minimum segment duration (1000 ms) prevents strobing cuts.
The `advance` field is validated but not wired to runtime behavior — timer and
input drivers are planned for a follow-up.
