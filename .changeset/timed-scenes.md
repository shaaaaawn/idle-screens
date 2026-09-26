---
'@idle-screens/schema': minor
---

Timed scenes: one spec for ambient loops and keyframed pieces. Every field is opt-in, and a spec without them renders exactly as before. The existing baselines are unchanged, and 598 stored scenes rendered identical frames before and after.

- `timeline` on a SaverSpec holds authored keys on the scene's own clock: `{loop?, duration?, keys: [{t, path, value, ease?, dur?}]}`. A key glides a steering path over `dur`. Under `loop` the lap is one closed cycle. Distinct key times on one path must be at least 200 ms apart. `resolveTimelineAt(spec, t)` returns the plain spec at `t`, and perception resolves it at its sample time.
- The steering rule needs no mode flag. A live steer on a path no key touches is sticky, as today. A steer on an animated path holds until that path's next key, then glides back to the timeline.
- Layer `opacity` and `transform {x, y, scale, scaleX, rotate}` are paint, outside the structural signature. They glide under `setParam`, a key or a morph instead of re-seeding the layer.
- `position.dx` / `dy` offset a placement in `min(w, h)` units, so a compound form registers on every aspect.
- `wrapMorph: true` on a looping sequence honours a last-segment morph at the wrap when the lap is one morph chain.
- `text: 'dip'` on a morph fades the outgoing words out, then the incoming words in, so the two never overlap.

Native clients ignore every new field. tvOS shows a timeline's base spec, identity transforms, opacity 1 and a cut or dissolve at the wrap.
