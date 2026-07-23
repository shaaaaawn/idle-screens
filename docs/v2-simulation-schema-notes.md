# Schema v2 notes — the simulation schema family

Written 2026-07-21, capturing a design discussion ahead of a deeper v2 spec.
Companion to `roadmap-scene-expressiveness.md` (whose "Beyond this schema"
section lists the candidate families). Not a spec — a set of positions to
debate when v2 work starts.

## The core distinction

Schema v1 (sprite fields) and schema v2 differ by **mathematical contract**,
not feature count:

- **v1: every pixel is a closed-form function of `(seed, t)`.** A spec
  describes *where things are* at any time. Consequences: free random seeking
  (`renderFrame(t)` jumps anywhere instantly), no accumulated state, trails
  sample the past for free, flash safety provable at the schema level,
  steering = changing equation coefficients.
- **v2: state that evolves.** A spec describes *rules and initial conditions*;
  the compiler runs a simulation loop where frame N depends on frame N−1.
  Consequences: emergence (patterns nobody authored), but sequential time,
  empirical flash-safety, and perturbation-style steering.

Keep the boundary hard. A "v1.5" that sneaks state into the sprite schema
loses free seeking for the whole spec and silently degrades every downstream
guarantee (determinism e2e, trails, steering glides). v1 stays pure; v2 is
honestly, explicitly stateful.

## Candidate families (from the roadmap ceiling analysis)

Cellular automata, reaction-diffusion (Gray-Scott), fluid, boids/flocking,
pipes/accumulative growth, n-body, collision physics, growing fractals.
Common shape: tiny parameter space (a handful of knobs), complex
computational core — exactly what a declarative schema is for.

**Recommended first compiler: cellular automata.** Smallest possible stateful
core (a rule table + a grid + a seed pattern) that still buys emergence, and
it is bit-exact by construction (integer states). Fluid last — it is the one
family where the CPU baseline genuinely strains.

## Determinism strategy

v1's theorem ("same seed + t ⇒ same pixels, seekable") is replaced by:
**seeded initial state + fixed timestep + deterministic update rule ⇒
identical replay.**

- Simulation must run on a **fixed logical timestep** decoupled from rAF
  (accumulate wall time, step in fixed dt increments). Never step by variable
  frame delta — that destroys reproducibility.
- Seeking becomes "simulate from 0" — O(t). Mitigation: periodic **state
  snapshots** (like video keyframes) so `renderFrame(t)` = load nearest
  checkpoint + step forward. Bounds seek cost; keeps the e2e story.
- Tests change shape: from "seek to t, compare pixels" to "step N fixed
  ticks, compare pixels" (or seek-via-checkpoint once snapshots exist).

## Backend choice: the schema is silent

A v2 spec must not name a rendering API. The spec says *what* (rule, rates,
palette, seed); the compiler picks *how*, gated by `@idle-screens/capabilities`
— the same relationship the imperative pairs already have
(`fluid.ts`/`fluid-gpu.ts`, `reaction-diffusion.ts`/`reaction-diffusion-gpu.ts`
in `packages/savers-classic`). Those pairs are the proof the seam works;
v2 moves the choice inside one compiler.

| Tier | Backend | Determinism claim |
| --- | --- | --- |
| v2 baseline | canvas2d, CPU sim on a coarse grid, upscaled | **bit-exact everywhere** (CI-testable cross-machine) |
| v2 enhanced | WebGPU compute when capabilities allow | same rules, per-device exactness only |

Why CPU-first matters more than performance: **CPU integer/typed-array math
is bit-exact across devices; GPU float math is not** (vendor-specific FMA and
rounding). Chaotic systems amplify last-bit differences into visible
divergence in seconds, so the cross-machine determinism proof can only ever
hold on the CPU path. JS float semantics are specified, so even Float64 CPU
sims reproduce exactly.

The coarse-grid baseline is not a fallback aesthetic — chunky cells read as
intentional (xscreensaver ran at this fidelity for decades), and a
240×135-ish grid keeps CA/Gray-Scott trivially 60fps in canvas2d via
`putImageData`.

## Flash safety: empirical, not structural

v1 is flash-safe by construction (no strobe primitive exists). v2 cannot
inherit that — an update rule *can* oscillate the whole field (large-scale
Game of Life blinkers are a strobe). v2 needs:

- structural guards where possible (e.g. max global luminance delta per
  frame, palette constraints), and
- a mandatory gate: sample compiled output through `@idle-screens/validator`
  before publish, as part of validate → compile, not as an optional check.

## Steering semantics change

Changing a v1 param cleanly redefines the future. Changing a v2 param
perturbs a running system — which is a *feature* (poke the fluid, drop a
glider, shift the feed rate and watch the pattern migrate), but control
tracks become **scheduled interventions** rather than interpolated
coefficients. `applyTrack` needs a v2-specific interpretation; glide/lerp
semantics don't transfer.

## What carries over unchanged

The outer architecture is model-agnostic and is the reason v2 is cheap-ish
to add: `validate → compile → mount`, seeded RNG only, the
`SaverPlugin`/`SaverInstance`/`renderFrame` contract, JSON-schema for agent
authoring, examples-as-regression-baselines, MCP steering surface,
capabilities gating. `schemaVersion` is the discriminant that routes to the
right compiler. v1's "implementation invariants" in the roadmap doc are
v1's constitution; v2 writes its own (fixed timestep, bounded grid,
luminance-delta cap, snapshot cadence) under the same government.

## Open questions for the deeper discussion

1. Which family ships first? (Position above: CA, then Gray-Scott; fluid
   last.)
2. Snapshot cadence and format — in-memory only, or serializable so a
   channel can hand a mid-flight state to a second display?
3. Does v2 share `SaverSpec`'s outer envelope (id/label/seed/background) with
   a `sim` block, or is it a sibling top-level type? (Leaning: sibling type,
   shared envelope interface.)
4. Grid resolution policy — fixed per spec (deterministic identity) vs
   capability-scaled (better look, weaker cross-device claims). Leaning:
   fixed sim grid, scaled *presentation*.
5. How does reduced-motion apply to a simulation (pause vs slow-step vs
   static snapshot)?
