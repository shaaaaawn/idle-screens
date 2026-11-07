---
"@idle-screens/schema": patch
---

Three fixes from a review of the agent contract.

- `steerablePaths` no longer advertises `density`. It is a declared hint that changes no pixel, and `resolveSpecPath` refused it, so a setParam on an advertised path came back 400. A test over the shipped examples and fixtures now checks that every advertised path resolves.
- `validateSequence` warns `unknown-property` on keys it does not know in the envelope, a segment, a transition (by type) and a wipe's `origin`, the same as a scene does. A typo there used to pass silently. A scene field written one level too high (`motionIntensity` on the envelope, `ghosting` on a segment) is told to move into the segment's `scene`. These are warnings, so stored sequences keep loading. The allowlists are exported as `SEQUENCE_FIELDS` and pinned to `saver-spec.schema.json`.
- FORMAT.md no longer says perception ignores sprite rotation. `spin`, `rotate`, `rock` and `transform.rotate` turn outline-traced polygons, bars, strokes and streaks in the luminance maps. A `rect`, text and emoji are still measured as unrotated boxes, and the doc now says so.
