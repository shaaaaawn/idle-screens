---
'@idle-screens/schema': minor
---

Time structure — three additive, closed-form primitives the style evals kept
asking for (idle-mono registry #47):

- `layer.emit: { every, life, jitter?, grow? }` — **sparse events**. Each
  entity is dark except for a `life`-ms window every `every` ms at a
  per-entity offset (`jitter` 0 staggers entities evenly, one event at a
  time; 1, the default, seeds the offsets). Inside a window the entity fades
  in over the first quarter and out over the rest, and `grow: [from, to]`
  scales its size across the window — expansion rather than travel, the "one
  ping" primitive a house style could not author before. Flash safety:
  `every` ≥ 1000 ms, `life` ≥ 500 ms, smooth envelope always.
- `layer.clock: { phase?, rate? }` — **phase-lock**. Replaces the seeded
  per-entity phases of `pulse`, `grow` and `cycle` with one shared phase
  (turns) and a time multiplier, so two layers can breathe in step or at a
  fixed offset. Because a clocked layer moves in unison, its periods must
  satisfy `period / rate ≥ 1000 ms`. A `pulse.wave` keeps its position-derived
  phase on top of the clock's.
- `motion.ease: { type: 'settle' | 'buoyant', tau }` on `drift`, `rise` and
  `wander` — closed-form velocity easing: `settle` decelerates from speed to
  rest (travelling `speed × tau`), `buoyant` accelerates from rest. With
  `emit`, the eased travel restarts on every event.

All three are pure functions of `t`; `perceiveScene`, `adviseSpec` (whose
coverage now weighs an emit layer by its duty cycle) and `motionStats` see
them through the same `alphaAt` / `sizeAt` / `positionAt` the renderer uses.
Entity streams of existing specs are unchanged: `emit` draws once, guarded by
its presence, after every older draw; `clock` and `ease` draw nothing. New
exports `emitWindow` / `emitEnvelope`; new shipped example `pings`.
