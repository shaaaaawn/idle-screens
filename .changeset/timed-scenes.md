---
'@idle-screens/schema': minor
---

Timed scenes: one spec for ambient loops and keyframed pieces. Every field is opt-in, and a spec without them renders exactly as before. The existing baselines are unchanged. More than 1,200 stored scenes, on disk and in prod, rendered identical frames before and after. The only exceptions are the first frames after a cut over a `bed`, which the fix below corrects.

- `timeline` on a SaverSpec holds authored keys on the scene's own clock: `{loop?, duration?, keys: [{t, path, value, ease?, dur?}]}`. A key glides a steering path over `dur`. Under `loop` the lap is one closed cycle. Distinct key times on one path must be at least 200 ms apart. `resolveTimelineAt(spec, t)` returns the plain spec at `t`, and perception resolves it at its sample time.
- The steering rule needs no mode flag. A live steer on a path no key touches is sticky, as today. A steer on an animated path holds until that path's next key, then glides back to the timeline.
- Layer `opacity` and `transform {x, y, scale, scaleX, rotate}` are paint, outside the structural signature. They glide under `setParam`, a key or a morph instead of re-seeding the layer.
- `position.dx` / `dy` offset a placement in `min(w, h)` units, so a compound form registers on every aspect.
- `wrapMorph: true` on a looping sequence honours a last-segment morph at the wrap when the lap is one morph chain.
- `text: 'dip'` on a morph fades the outgoing words out, then the incoming words in, so the two never overlap.

Fixes found in QA:
- A cut over a sequence `bed` no longer flashes a black frame. This bug predates the branch: a segment mounting on the shared surface resized it, which wiped the bed. Only the first frame after a cut changes, and only in sequences with a bed.
- Under `units: 'px'`, `transform` x/y and `position.dx`/`dy` are bounded in px, not ±2.
- Keys are validated together, not just one at a time. The validator resolves the composed scene at every key's start, end and glide points, so two keys that are each valid can't combine past a flash-safety floor. A live steer is validated the same way, now and at every key still ahead. The new `validateSpecPaths(spec, paths)` export keeps these checks cheap: it validates only the parts of a spec those paths live in.
- Steers stay correct across sequence morphs, hot swaps and re-sent tracks. A steer the timeline has taken back stays taken back.

Native clients ignore every new field. tvOS shows a timeline's base spec, identity transforms, opacity 1 and a cut or dissolve at the wrap.
