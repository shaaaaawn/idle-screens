# Visual Control Track (draft spec)

> **Status (July 2026):** the core data model and evaluation logic from this
> brainstorm are **implemented** in `@idle-screens/core` (`types.ts`,
> `control-track.ts`) and proven end-to-end on the black hole saver. See
> "v0 implementation notes" inline for what shipped vs what's deferred.
> The authoritative behavior spec is
> [`behavior-contract.md`](./behavior-contract.md) items C1-C13.

Working name: **Control Track** (a.k.a. the "visual automation lane").

---

## 0. One-paragraph pitch

An agent (or a human, or a recording) should never stream frames to a live
renderer. It should stream a **program** (a seeded, declarative saver) plus a
**control track**: a sparse, timestamped, interpolatable stream of parameter
changes. The renderer applies the track and produces frames LOCALLY at 60fps.
Because it is seeded and deterministic, the same program + seed + track produces
identical frames everywhere and forever, which makes it QA-able, replayable, and
shareable. This is the missing layer between agent-UI protocols (which stream
semantic events at ~1 Hz) and the render loop (60 Hz pixels).

Think: **OSC / MIDI / audio-automation lanes, but for generative visuals, and
emittable by an agent.**

---

## 1. Why this and not the existing protocols

Agent-UI protocols (AG-UI, ACP, MCP, Vercel Data Stream, AI Engineer Agent
Protocol) stream discrete semantic events. None define a real-time parameter
automation format. The gap:

- They carry "what the agent decided" (tool calls, state patches, messages).
- They do NOT carry "how a continuous visual should evolve over the next 3
  seconds" as a compact, interpolatable signal.

A control track fills that gap and, importantly, can RIDE ON the existing
protocols (see section 6) rather than replace them.

---

## 2. The three parts of the model

1. **Program** = a declarative saver + its `paramSpace` (the typed, ranged knobs).
   This is the "instrument." Authored once; agent-editable via schema patches.
2. **Seed** = a single integer that anchors ALL randomness in the program. Same
   seed = same noise, same particle placement, same everything.
3. **Control track** = a time-ordered list of `ParamDelta`s that steer the knobs.
   This is the "performance."

`render(program, seed, track, t)` is a PURE function of those inputs. That purity
is the whole point.

---

## 3. Data model

### v0 implementation (what shipped)

The types below are the **canonical** definitions from `packages/core/src/types.ts`:

```ts
type ParamType = 'number' | 'color' | 'bool' | 'enum';
type Ease = 'step' | 'linear' | 'smooth';

interface ParamDef {
  type: ParamType;
  default: unknown;
  min?: number; max?: number;
  options?: string[];
  ease?: Ease;
}

interface ParamDelta {
  t: number;
  path: string;
  value: unknown;
  ease?: Ease;
  dur?: number;
}

interface ControlTrack {
  seed: number;
  duration?: number;
  loop?: boolean;
  deltas: ParamDelta[];
}
```

`sampleTrack(space, track, t)` evaluates the track at time `t`, returning a
`Record<string, ParamValue>` with each knob resolved. See `control-track.ts`.

### Deferred from this spec

The following were in the original brainstorm but are not yet implemented:

- **`vec2` / `vec3` param types** -- not needed by any shipped saver's paramSpace.
  Add when a saver needs multi-dimensional knobs.
- **`expo` / `spring` eases** -- the three shipped eases (`step`, `linear`,
  `smooth`) cover all current use cases. `expo` and `spring` are straightforward
  to add to `sampleTrack` when needed.
- **`programVersion`** on `ControlTrack` -- tracks do not yet pin schema version.
  For v0, tracks are tightly coupled to the saver that defines the paramSpace.
- **`provenance`** on `ControlTrack` -- `{ author, prompt, model }` metadata.
  The field exists on `SaverManifest` but not on `ControlTrack`.
- **`cost`** on `ParamDef` -- perf weight for budget reasoning about a track.

### Evaluation

At render time `t`, for each knob: find the surrounding deltas, interpolate with
the segment's ease over `dur`. A knob with no deltas holds its `default`. This is
identical in spirit to an audio DAW automation lane or a keyframe curve.

---

## 4. Determinism rules (the hard part)

For "same inputs = same frames" to hold:

- **All randomness flows from `seed`.** No `Math.random()` / `Date.now()` in
  savers; use a seeded PRNG (e.g. a splitmix/xoshiro) threaded through the program.
  *v0: splitmix32 PRNG in `rng.ts`, threaded via `SaverContext.rng`.*
- **Time is an input, not read from the clock.** The render loop advances a
  logical `t`; wall-clock is only used to DECIDE how much to advance (and for live
  playback). Frame-addressable `renderFrame(t, seed)` must ignore real time.
  *v0: proven on the black hole; the playground determinism demo confirms
  byte-identical two-canvas renders.*
- **Interpolation is pure and specified.** Ease functions are fixed formulas, not
  library-version-dependent. Same `t` yields the same interpolated value on any
  backend.
  *v0: `sampleTrack` is pure; tested in vitest (C1-C13).*
- **Backend parity is best-effort for pixels, exact for state.** The PARAM STATE
  at time `t` is exactly reproducible; the exact pixels may differ across
  WebGPU/WebGL2/Canvas2D. So determinism guarantees the STEERING, and screenshot
  QA pins a specific backend.
- **[FUTURE] Track pins `programVersion`.** If the schema changes, a
  mapping/migration is needed; a track authored against v1 should not silently
  mis-apply on v2.

---

## 5. Live vs recorded

Same format, two modes:

- **Recorded track:** a finite `ControlTrack` with `duration`. Ship it as JSON,
  embed in a URL, share it. Deterministic replay. Great for a community gallery
  ("here is my black-hole performance, seed 42, this track") and for QA fixtures.
  *v0: `demoTrack` in `@idle-screens/saver-black-hole` is a recorded fixture
  used by the Playwright determinism test.*
- **[FUTURE] Live stream:** an open-ended sequence of `ParamDelta`s arriving over a
  transport (agent steering in real time, or a human VJ, or page-context reacting).
  The renderer applies them as they land, interpolating toward each target. The
  agent sends ~1-10 deltas/sec; the renderer still draws 60fps by interpolating.

The recorder just captures the live delta stream into a track. Live and recorded
are the same thing at different times.

---

## 6. **[FUTURE]** How it rides on existing protocols

Prefer NOT inventing a transport. Options, roughly in order of preference:

1. **AG-UI state patches.** Model the saver's live param state as the agent
   "state." A `ParamDelta` is a state patch. AG-UI already streams patches over
   HTTP/SSE. The control track is then just "the recording of the state-patch
   stream." This is the cleanest fit and reuses an adopted standard.
2. **MCP resource + tool.** Expose `activeSaver` params as an MCP resource an agent
   subscribes to; `setParam` / `applyTrack` as tools. Good for request/response
   control and discrete steering; less ideal for dense live ramps.
3. **WebRTC data channel.** Only if you need very low latency live steering (a
   human VJ dragging a slider, or tight agent-in-the-loop). Unreliable-ordered
   mode is fine because deltas are timestamped and idempotent per `path`.
4. **Standalone micro-spec.** Define Control Track as its own JSON format for the
   RECORDED case (files, URLs, gallery), independent of any live transport. This is
   probably worth doing regardless, since a recorded track is an artifact, not a
   stream.

Likely answer: **recorded tracks are a tiny standalone JSON spec; live steering
rides on AG-UI state patches (or MCP).** One format, two carriers.

---

## 7. **[FUTURE]** Where pixels DO stream (out of scope for the track)

The control track never carries pixels. When you must move pixels (heavy
cloud-GPU render, or a generative video model literally producing frames), use
WebRTC / WebCodecs video, and let the control plane carry only a stream HANDLE.
The agent orchestrates; the media pipe carries pixels. See vision doc section 5.

---

## 8. Use cases this unlocks

- **Deterministic QA.** A test says `applyTrack(fixture); renderFrame(1500ms,
  seed=42); screenshot()` and diffs pixel-for-pixel on a pinned backend. No
  animation-timing roulette.
  *v0: this is exactly what the Playwright determinism test does.*
- **[FUTURE] Agent steers from page context.** An on-page agent reads the palette /
  mood / content and emits deltas ("warm up the disk, slow the roam, pull toward
  the hero"). Frames stay local; only intent crosses the wire.
- **[FUTURE] Shareable performances.** A "control track + seed" is a 2 KB shareable
  artifact that reproduces a beautiful moment on anyone's machine.
- **[FUTURE] Human + agent co-creation.** A human drags sliders, an agent suggests a
  delta, both write to the same param state (CRDT if multi-writer). The track is
  the merged recording.
- **[FUTURE] Provenance.** Generated savers + their tracks carry prompt/seed/model,
  so the gallery is auditable and remixable.

---

## 9. Prior art to mine

- **OSC / MIDI:** sparse timestamped control messages for live audio/visual rigs.
- **Audio DAW automation lanes:** keyframed, interpolated parameter curves.
- **Game replay systems:** record INPUTS + seed, replay deterministically (never
  record frames). This is the closest mental model.
- **Shader uniforms / TSL:** the shader is the program, uniforms are the steering.
- **Lottie / Rive:** declarative, parameterizable animation with a runtime; Rive
  even has a state machine + inputs (a "steering" surface).
- **Hydra / VJ livecoding:** live parameter mutation of a running visual.

The novel combination: seed-anchored determinism + agent-emittable + rides on
AG-UI/MCP + safety-gated (WCAG flash + perf budget applied to the RESULTING
motion, so an agent-authored track cannot produce a seizure risk).

---

## 10. Open questions

- ~~Standalone recorded-track JSON spec vs. pure AG-UI-state-patch representation:
  do both, or force one?~~ Both: recorded tracks are JSON, live rides on AG-UI/MCP.
- Interpolation determinism across backends and across library versions (freeze
  the ease formulas in the spec, versioned).
- Multi-writer live editing (human + agent): last-writer-wins per `path`, or a
  CRDT? Probably LWW-per-path to start.
- How the safety gate evaluates a TRACK ahead of time (simulate the param curve,
  estimate luminance flashes) vs. only at render time.
- Nested / structured params (dot-paths) vs. flat only.
- Whether `programVersion` migration is worth building or "tracks pin exact
  version, no migration" is fine.

---

## 11. Prototype (done)

~~In THIS repo, before extraction: give the black hole a real `paramSpace`
(hole size, disk brightness, hue, roam speed, lens strength), make its RNG
seedable, and add `applyTrack(track)` + `renderFrame(t, seed)`. Then a Playwright
test that applies a 3-delta track and screenshots frame 1500ms deterministically.~~

Done. The black hole has a 10-knob `paramSpace`, `applyTrack()`, and
`renderFrame(t, seed)`. The Playwright determinism test in
`apps/playground/e2e/determinism.spec.ts` applies a `demoTrack`, renders at a
fixed time, and confirms pixel-identical output across two independent canvases.
