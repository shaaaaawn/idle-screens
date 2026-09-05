---
'@idle-screens/schema': minor
---

The sequence clicker. `advance: 'input'` now does what FORMAT.md always said:
a timed segment holds at the end of its `duration` until a `sequence.segment`
steer releases it, and the held scene keeps animating rather than freezing.
`auto` and `either` advance on the timer as before.

The `sequence.segment` steer is now sticky. `applyTrack` used to switch the
active segment and lose it on the next animation frame, because `renderFrame`
re-derived the segment from the wall clock alone. The steer now displaces the
sequence's clock so the target segment starts at its own `localT` 0 and then
runs on the timer — the next frame resolves to the same segment. A steer to
segment `n` releases every `advance: 'input'` hold before `n` and leaves the
rest armed, so steering backwards re-arms the holds in between; in `loop`
mode an unreleased hold blocks the wrap and a fresh lap re-arms every hold.

`resolveSegment` gains an optional `{ releasedBelow }` argument and reports
`held: true` on a waiting segment; `segmentStart(seq, index)` is exported.
Sequences without `advance: 'input'` resolve exactly as before.
