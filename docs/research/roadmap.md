# Roadmap: The Agent-Authorable Ambient Surface

> **Status (July 2026):** working roadmap, grounded in an empirical authoring test
> (the `lanterns` spec, `packages/schema/src/examples.ts`). Companion docs:
> [mcp-state-architecture.md](./mcp-state-architecture.md) (transport/state design),
> [presence-and-channels.md](./presence-and-channels.md) (agent-presence hook +
> channels site designs),
> [../specs/control-track.md](../specs/control-track.md) (steering format).
>
> **Update (July 2026, session 2):** the M1 schema items shipped — `alpha`,
> `blend: 'lighter'`, spawn `region`, `pulse` (bounded), and `soft` glow circles —
> and lanterns v2 exercises all of them. The flash validator measured the pulsing
> composition at 2 flashes/sec worst-tile against the 3/sec WCAG gate: the caps
> held under measurement, not just by claim. See §1.1 for what the second
> authoring round taught, and §6 for the re-sequenced "what to do first."

---

## 0. Thesis

Everyone's ambient-AI story is GPU-bound: run a model per frame, stream pixels.
Ours is the inverse: **inference once, render forever**. Intelligence spends
tokens at *authoring* time; the artifact — a ~2KB JSON scene — runs at 60fps
on any canvas2d surface, deterministic down to the pixel, forever, for free.

Screens are the cheapest, most abundant, most under-addressed surface in
computing. Every idle monitor, TV stick, kiosk, and conference room display is
render capacity nobody is addressing. This project's bet: make that surface
**agent-authorable** (schema), **agent-steerable** (control track), and
**safe by construction** (validator) — and the screen becomes the medium
where agent imagination meets human attention.

---

## 1. Core findings from the authoring test

In July 2026 an agent (Claude) authored its best-effort saver as pure JSON
(`LANTERNS_SPEC` — a Yi Peng lantern sky, five parallax layers, 148 entities,
cost tier `low`). It passed validation, all 120 unit tests, and the 47-test
e2e suite on the first run. What the exercise exposed:

### F1. The runtime contract is not self-describing
Authoring *well* required reading `compile.ts` and `simulate.ts` — that's how
the useful facts surfaced (uniform spawn, wrap semantics, bob sine period,
layers painting over the background band → free water reflections). An agent
connecting over a wire cannot read our source. The schema needs a
**machine-readable semantics document** — spawn rules, paint order, motion
math — served alongside the JSON Schema itself (as an MCP resource, see M3).
A format is only agent-authorable if the agent can learn it from the wire.

### F2. The expressive ceiling is one feature deep in three directions
- **Opacity + blend modes.** *(SHIPPED — July 2026.)* Sprites were flat fills.
  `alpha: [min,max]` per layer, `blend: 'lighter'` (additive), `soft: true`
  glow circles, and a bounded `pulse` now exist. Pulse was the first primitive
  that *could* flash — it forced the validator to gate actively rather than
  being safe-by-omission, and the gate held (2/sec measured vs 3/sec limit).
- **Spawn regions.** *(SHIPPED — July 2026.)* `region: { x?, y? }` fractional
  windows unlock grounded compositions — stars above the horizon, shimmer at
  the water line.
- **Rotation/spin.** Falling leaves, tumbling debris, orbiting motes remain
  inexpressible. Deliberately deferred: no shipped composition demanded it,
  and adding primitives no composition demands is the scope creep the format's
  discipline exists to resist. First saver concept that needs it, it ships.

### F3. Integration friction contradicts the pitch
Adding one JSON spec touched six files (examples, panel, main, e2e, contract,
credits). The engine's plugin list is frozen at construction. Runtime
`addPlugin()`/`removePlugin()` is a hard prerequisite for a `createSaver`
tool. The demo must be: agent emits JSON → screen changes → **zero files
touched**.

### F4. Steerability is an island
Only black-hole has a `paramSpace`. But every numeric field in a `SaverSpec`
(speeds, sway, counts, colors, gradient stops) is a typed knob the compiler
already understands. **Deriving the paramSpace from the spec automatically**
makes every authored saver steerable for free — the control track gets 21
instruments instead of 1.

### F5. Constraint bred craft, not frustration
The format has 3 sprite kinds and 3 motions, and the authoring experience was
*better* for it — depth had to come from composition (four correlated parallax
cues: size ↑ speed ↑ sway ↑ warmth ↑) rather than brute force. The constraint
is the aesthetic identity. Publish it proudly (see §4, demoscene lesson).

## 1.1 Findings from the second round (schema v2, July 2026)

The author-then-extend loop ran once: the same agent that wrote lanterns v1
extended the engine to serve the composition, then rewrote the piece. New
findings:

- **F6. Format growth needs a compat invariant.** Optional layer fields must
  only consume EXTRA seeded-rng draws when present in a spec, or every new
  feature silently re-rolls every existing scene's entity stream. This is now
  a tested rule (`simulate.test.ts` "stream compat") and documented in the
  authoring skill. Any format that promises deterministic artifacts needs an
  equivalent rule from day one.
- **F7. The safety gate works best when a primitive threatens it.** `pulse`
  is the first primitive with real flash surface. Designing its caps
  (amp ≤ 0.5, period ≥ 500ms = 2 Hz vs the 3 Hz WCAG line, per-entity seeded
  phases so a layer can't strobe in unison) and then *measuring* the result
  through the validator (2/sec worst tile, passing) upgraded "flash-safe by
  construction" from an absence claim to an engineering practice.
- **F8. QA finding: pause/resume reset the scene clock.** `t` restarted at 0
  on every resume — invisible in normal screensaver use, jarring under
  interactive control. Fixed by carrying elapsed time across pause. Steering
  (control track, MCP) would have hit this immediately; interactive control
  surfaces new bug classes in code that looked correct for passive use.
- **F9. Human co-editing is part of the loop.** The human edited the authored
  spec directly (removing elements to taste) — the artifact being plain JSON
  meant the edit needed no tools and no agent. The doc comment went stale
  against the edit, which is a small version of a real problem: prose
  descriptions of scenes drift; the spec itself is the only truth.

---

## 2. Milestones

### M1 — Honest surface (schema v2 + engine seams)
- ~~Schema v2: `alpha`, `blend: 'lighter'`, spawn `region`~~ **DONE** (July
  2026), plus `pulse` and `soft` glow circles. Deferred: `spin`, per-entity
  color jitter (no composition has demanded them yet — see F2).
- ~~Validator coverage for the new primitives~~ **DONE** — pulse caps enforced
  in `validateSpec`, flash gate measured passing with pulse active.
- `engine.addPlugin()` / `removePlugin()` runtime registration (F3). **Open.**
- Extend `window.__idleScreens` with `applyTrack`, `setParam`,
  `getParamSpace`, `getParams`, `setSeed` (the steering seam from the MCP
  architecture doc, §4). **Open.**

### M2 — Derived steering
- Auto-derive `paramSpace` from any `SaverSpec` (F4).
- Name and ship the artifact: a **scene** = `{ spec, seed, track }` — one JSON
  bundle that is the complete, reproducible, remixable art object. This is
  the file people share, fork, and version.

### M3 — `@idle-screens/mcp`
- Tools: `createSaver(spec)` (validate → compile → register → mount),
  `setSaver`, `setParam`, `applyTrack`, `getState`, `listSavers`.
- Resources: `screen://state` (live, subscribable), `screen://schema` (the
  self-describing authoring contract from F1 — JSON Schema + runtime
  semantics + a worked example).
- stdio transport, topology A (browser-as-source-of-truth) first.
- Demo: Claude Code connected to the playground — "make it feel like rain is
  coming" → screen changes.

### M4 — The deployed loop
- Bridge script + SSE + topology B (server-as-source-of-truth) per the MCP
  architecture doc.
- shawn-site ships it.
- Playground prompt box: mood text → Claude API → spec → live render. The
  shareable "type a mood, get a screensaver" moment.

### M5 — The gallery
- Community repo of scenes; CI runs every submission through the flash
  validator — a *safety gate as a merge check*, which no shader gallery has.
- GitHub Pages renders the gallery. Determinism means it's a git repo of 2KB
  files, not a bucket of videos. Provenance (prompt → spec → renders) is free.

### M6 — Field primitives (the shader lesson, applied safely)
Sprite layers can't express per-pixel fields: fog, plasma, caustics, flow.
The shader world owns that territory — but via arbitrary code, which breaks
safety-by-construction (§3). The answer is **a curated field vocabulary**:
named, vetted, parameterized primitives (`noiseFog`, `gradientFlow`,
`metaballs`) implemented once in the compiler (canvas2d fallback + WebGPU
upgrade, the fluid/reaction-diffusion dual-path pattern), exposed in the
schema as data. Shaders as vetted primitives, never as user code.

---

## 3. How this differs from a shader spec

The closest prior art is the shader ecosystem — Shadertoy, GLSL Sandbox, ISF.
The differences are not cosmetic; they're the entire reason this format can
be agent-authored and safety-guaranteed while shaders can't.

| | Fragment shader (GLSL) | SaverSpec |
|---|---|---|
| **What it is** | A per-pixel *program* | A scene *description* (data) |
| **Expressive floor/ceiling** | Unbounded — anything computable per pixel | Bounded — the compiler's vocabulary |
| **Flash safety** | Unprovable in general (`fract(iTime*15.)` strobes the field; analysis is halting-problem-shaped) | **Provable by construction** — no strobe primitive exists; confirmed by sampling |
| **Agent authorship** | LLMs write plausible GLSL; failure modes are black screens, NaNs, driver quirks; no mechanical feedback loop | JSON against a schema → validation errors with paths; structured-output decoding can *force* validity |
| **Determinism** | Per-pixel in principle; in practice float behavior varies across GPUs/drivers — the same shader renders differently on different machines | Seeded RNG + analytic positions → cross-machine pixel determinism (proven in e2e) |
| **Parameters** | Raw uniforms: untyped floats, no declared ranges — nothing to derive a safe steering surface from | Typed fields with validator-enforced caps → paramSpace derivable automatically |
| **Failure mode** | Runtime (black screen, GPU hang, seizure risk) | Author time (validation error) |

The one-line version: **a shader tells the machine how to compute every
pixel; a SaverSpec tells the compiler what exists — and the compiler is the
only one allowed to touch pixels.** Moving the Turing-completeness out of the
artifact and into the (audited, versioned) compiler is what makes the format
safe to hand to a generative model.

## 4. What to steal from the shader world

The shader ecosystem is 15 years ahead on community and tooling. Its lessons,
in priority order:

1. **ISF proved the metadata envelope is what makes art *operable*.** The
   Interactive Shader Format wraps GLSL in JSON declaring typed `INPUTS`
   (type, min, max, default, label) — and that single move is what made
   shaders steerable in VJ tools like VDMX. Our paramSpace is the same idea;
   M2's auto-derivation goes one step further than ISF (which requires
   hand-declared inputs). Validation that steering surfaces belong in the
   format, not the app.

2. **Shadertoy proved tiny-text artifacts + view-source-by-default = a
   remix culture.** Every shader is forkable source, runnable in one click.
   The scene format inherits this naturally (JSON is even more readable than
   GLSL). Steal the gallery mechanics; skip its mistakes — no versioning, no
   safety gate (flash warnings retrofitted after real incidents), artifacts
   that rot as drivers change. A scenes git repo with validator CI fixes all
   three.

3. **The demoscene proved constraint is an aesthetic, not an apology.**
   64k intros are revered *because* of the budget. F5 confirmed it firsthand:
   the 3-sprite/3-motion budget forced composition. Lean in — "spec golf"
   (most beautiful scene under N bytes) is a community format waiting to
   exist, and `LIMITS` in `types.ts` is already its rulebook.

4. **Shadertoy's uniform conventions became a lingua franca.** `iTime`,
   `iResolution`, `iMouse` made shaders portable across sites and tools
   because everyone agreed on the tiny context contract. `SaverContext`
   (t, seed, width/height, dpr, reducedMotion) is our equivalent — keep it
   small, stable, and documented as the portability guarantee.

5. **VJ tooling proved live control wants physical knobs.** ISF + MIDI/OSC
   mappings are standard in shader VJ software. The control track is the same
   signal with timestamps; an OSC-to-MCP bridge (see the transport survey in
   the MCP doc) plugs idle-screens into existing VJ hardware for free.

6. **IQ's SDF library proved a named-primitive vocabulary beats raw math.**
   Most raymarched scenes are compositions of ~30 canonical signed-distance
   functions with known parameters. That's the blueprint for M6: grow a
   canonical, audited primitive library; let scenes compose it as data.

---

## 5. Expanded designs (moved to their own note)

The concrete designs for local harness telemetry (what Claude Code exposes and
how to map it to moods), the native shell question (how thin the desktop
wrapper can be), and the channels site (a Shadertoy-for-live-screens where the
server never renders a pixel) are written up in
[presence-and-channels.md](./presence-and-channels.md).

## 6. Sequencing, honestly: two experiments before any milestone

An introspective review of this roadmap flagged an enthusiasm ratchet: the
vision (channels, TV, federation) outran the evidence (one saver, authored by
an agent that had read the source). Two cheap experiments gate everything:

1. **The presence hook** (`@idle-screens/agent-presence`) — the only idea with
   a confirmed user today. A Claude Code hook mapping session telemetry to
   saver moods, run on the author's own desk for a month. **Kill signal:** if
   even the author doesn't keep it running once the novelty fades, fold the
   durable parts (validator, determinism, scene format) into a smaller, truer
   story. **Green signal:** catching yourself glancing at it to see how the
   agent is doing — the screen earning a place in peripheral vision.
2. **The cold-agent authoring test** — a fresh agent session, no source
   access, only the served contract (F1's semantics doc + JSON Schema +
   one worked example). If cold agents produce good scenes, the authoring
   thesis is real; if they produce uniform scatter, the contract needs work
   before any MCP tooling matters.

Build M1's remaining seams and M3's MCP server *in service of* these two
experiments, not ahead of them. Channels (M4-M5) wait for both signals.

## 7. The bigger loop: agent imagination ⇄ human attention

The milestones make the agent articulate (M1–M3) and give it an audience
(M4–M5). The differentiating long game is making it *listen*:

- **Attention as feedback.** The engine already owns the one signal that
  matters: idle detection knows when the human left, returned, and how long a
  scene ran before the wake. Dwell time is aesthetic feedback. Close the loop
  locally (privacy-intact — wake timestamps never leave the machine): the
  agent authors variations, scenes that hold the room survive, taste emerges
  from behavior instead of prompts. Evolution by attention.
- **The screen as the agent's face.** While an agent works, the idle screen
  visualizes its *state as mood*, not logs: exploring = warp, tests failing =
  thickening rain, long build = pipes, success = lanterns rising. An
  `@idle-screens/agent-presence` package — a Claude Code hook emitting
  control-track deltas — is likely the most immediately adoptable artifact in
  this whole plan: every developer already owns both the idle monitor and the
  agent.
- **Time as the canvas.** Day-length control tracks give the screen circadian
  arcs — an agent composes a day the way a composer scores a film.

The economics underneath all of it: the GPU thinks once; the screen dreams
forever.
