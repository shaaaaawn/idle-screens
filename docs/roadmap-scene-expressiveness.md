# Roadmap: expanding scene possibilities

Written 2026-07-19, after an end-to-end agent authoring session (Abyssal Bloom)
plus the schema/core audit. Supersedes the "open items" list in
`future-ideas.md` for scene-format work; the scene-format.md doc remains the
long-horizon thought experiment.

**Context from the authoring session.** The format's ceiling today is "drifting
dots with links": even a well-tuned scene reads as a constellation variant.
The two failure modes a fresh agent hits are (1) no feel for scale/brightness
until a screenshot, and (2) everything moves in straight lines or circles.
Stability fixes (value coercion, shape guard, post-steer validation, applyTrack
append, publish advisories) landed in idle-server on 2026-07-19.

**Implementation invariants for every format change** (proven by the audit —
keep them true):

- Ride the full chain: `types.ts` → `validate.ts` → `simulate.ts` →
  `compile.ts` → `saver-spec.schema.json` → an example spec → `advise.ts`
  heuristic if applicable.
- RNG stream compatibility: new optional features consume RNG draws **only
  when present** — existing specs must produce identical entity streams
  (`determinism-baseline.test.ts` guards this).
- Positions stay **analytic** (`positionAt(entity, t)` pure): no simulation
  state, so `renderFrame(t, seed)` and trails stay cheap and deterministic.
- Flash safety by construction: any new time-varying visual gets the same
  period floor discipline as pulse/cycle (`LIMITS.minPulsePeriod`).

---

## Wave 1 — Color & light (small additions, big payoff)

**1. Weighted palettes** (future-ideas B3). `colors: string[]` stays;
add optional `colorWeights: number[]`. "Mostly cool tones, occasional ember"
becomes expressible without duplicating entries. Touches colorIndex draw in
`buildEntities` (weighted pick, one draw as today).

**2. Link falloff + partner modes** (future-ideas B2).
`links: { …, falloff?: boolean, mode?: 'nearest' | 'random' | 'mixed' }`.
Falloff fades link alpha with distance/maxDist — kills the harsh pop-in at the
distance cutoff. `random`/`mixed` break the crystalline look of pure k-nearest
graphs.

**3. Background drift.** `background.drift?: { period: number }` — the gradient
stops breathe slowly (hue/position oscillation with a long period floor,
e.g. ≥ 30 s). The static background is the main reason scenes feel inert over
minutes. Expressible today via tracks, but first-classing it makes every scene
alive by default with one line.

**4. New sprite kinds: `ring` and `streak`.** Ring = unfilled circle (bubbles,
portals, sonar); streak = a line segment oriented to the entity's heading
(shooting stars, rain that reads as rain). Both are a few lines of canvas in
`compile.ts` and unlock whole scene families.

## Wave 2 — Motion (organic movement)

**5. Trails.** `trail?: { length: number; fade?: number }` (length in ms).
Because motion is analytic, a trail is just `positionAt(t - k·dt)` sampled
N times with decaying alpha — **no state, no perf cliff, fully deterministic**.
This is the single biggest visual upgrade per line of code: comets, fireflies
with afterglow, warp streaks.

**6. `wander` motion type** (the honest flow-field). True curl-noise flow needs
integration (path depends on history) — breaks the analytic invariant. The
analytic equivalent: per-entity harmonic drift,
`x(t) = x0 + vx·t + Σ aᵢ·sin(bᵢ·t + φᵢ)` with 2–3 seeded octaves per axis.
Looks organic (no straight lines), stays pure. Spec:
`{ type: 'wander', speed: [min,max], meander: number }` where meander scales
the harmonic amplitudes.

**7. Depth as a first-class knob.** `depth?: number` (0 = far, 1 = near) per
layer, scaling size, speed, and alpha coherently. Agents currently fake
parallax by hand-tuning three layers; one number makes it reliable and gives
`adviseSpec` a new check ("all layers at the same depth — flat scene").

## Wave 3 — Composition & rendering

**8. More blend modes.** Add `screen` and `multiply` to `blend`. `screen` is a
gentler additive for pale backgrounds; `multiply` enables shadow/silhouette
layers. No flash-safety impact (still no strobe primitive).

**9. Soft generalization → glow.** `soft: boolean` becomes
`glow?: number` (0–1 falloff sharpness, `soft: true` ≡ glow 0.5, back-compat
kept). One knob controls the "bloom" look agents reach for most.

**10. Layer parenting (scene-graph lite).** `orbit.center` may reference
another layer's key with `count: 1` — moons around a wandering planet,
electrons around a drifting nucleus. Strictly one level deep to keep
`positionAt` analytic (parent position is itself analytic).

## Wave 4 — Feedback & liveness (agent + human experience)

**11. Render-stat confirmation** (future-ideas C2). Viewer reports
entities/linksDrawn/coverage/fps to the DO after mount; exposed in `getState`
and the publish confirmation. Closes the "did it actually draw what I meant"
loop without vision.

**12. ASCII luminance map** (future-ideas F2). 48×24 text grid from
`describeScene` sampling — a non-vision agent can "see" composition balance.
Expose via `previewScene` response and a `screen://` resource.

**13. Size ladder + recipes in `screen://schema`.** One paragraph each:
what radius 0.005/0.02/0.08/0.2 looks like at 1080p, and 3–4 named recipes
(parallax depth, glow stacking, graph web, focal pin). The authoring session
showed scale intuition is the #1 blind spot.

**14. Swap server duplicates for schema imports.** `steerablePaths` +
`resolveSpecPath` in idle-server duplicate the schema package. After the next
`@idle-screens/schema` release (which now exports `steerablePaths`), delete the
copies.

---

## Suggested order

| Priority | Items | Why first |
| --- | --- | --- |
| P1 | trails (5), background drift (3), link falloff (2), weighted palettes (1) | Biggest perceived-quality jump; all small, all additive |
| P2 | wander motion (6), ring/streak sprites (4), depth (7), size ladder docs (13) | New scene families + fixes the agent blind spot |
| P3 | blend modes (8), glow (9), render-stats (11), ASCII map (12), parenting (10), dedupe (14) | Polish + closing loops |

Each P1 item is an afternoon-sized change riding the standard chain, and each
ships with a new example spec that shows it off (examples double as regression
baselines and as `screen://examples` inspiration for authoring agents).

**Status:** trails (5) and background drift (3) landed 2026-07-19.

**Status update 2026-07-21 — "the v1 ceiling" landed.** In one wave:
weighted palettes (1), link falloff + chain/random modes (2), ring/streak/rect
sprites (4, generalizing the streak idea), wander/harmonic motion with a
`coherence` fake-flocking knob (6/15), blend screen/multiply (8), layer
parenting for orbit (10), path/waypoint motion (16), perspective warp motion
(17), canvas-fade ghosting with deterministic seek replay (18), layer
lifecycle `life.enter/exit` (19), chain links as the Mystify polygon
primitive (20), grid layout with per-axis jitter (21), plus a spatial
`pulse.wave` (traveling waves across a field — not in the original list).
Five showcase examples double as regression baselines: `aurora`,
`warp-tunnel`, `polygons`, `matrix-rain`, `procession`. **Status update 2026-07-22 — agent perception landed** (`src/perceive.ts`):
item 12 shipped better than specced — a braille luminance map (2×4 dots/char,
~8× ASCII resolution) computed ANALYTICALLY from the entity model (no render),
with auto-exposure dithering; plus row/column transect profiles, layer
dominance ranking (where the eye goes), per-layer motion stats, and
`diffScenes` for relative A/B judgement. All exposed via `perceiveScene()`
for the MCP `previewScene` to return. Key insight: because v1 positions are
pure functions of (seed, t), the "picture" needs no renderer — perception is
deterministic, Node-safe, and testable.

Remaining from the
lists above: depth-as-a-knob (7 — superseded by warp for true depth),
glow generalization (9), render-stats (11), size ladder
docs (13), server dedupe (14), fractal sprite (22). v1 is now considered
feature-complete for its family; further primitives belong in a v2
simulation schema (see `docs/v2-simulation-schema-notes.md`).

---

## Format ceiling analysis

Audit of what classic screensaver families the spec can/can't express, and
what format additions would unlock the most new territory while keeping the
core invariants (analytic motion, no simulation state, deterministic frames).

### What the spec covers well today

| Family | Examples | How |
| --- | --- | --- |
| Drifting sprite fields | toasters, fish, DVD logo | drift + flip + wrap |
| Particle fields | rain, snow, fireflies, stars | rise/drift + soft circles + pulse |
| Orbital systems | orrery, electrons, spirograph-adjacent | orbit + trails |
| Constellation / graph | network, nodes, plexus | links + drift |
| Atmospheric scenes | lanterns, sakura, comet shower | layers + blend + trails + drift |
| Text marquees | scrolling messages, dashboards | text sprites + drift/static |

### Achievable — stays analytic, unlocks new families

**15. Harmonic / Lissajous motion.** `{ type: 'harmonic', octaves: N }` where
each entity's position is `x₀ + Σ aᵢ·sin(bᵢ·t + φᵢ)` per axis with seeded
amplitudes/frequencies/phases. This is Flurry's core technique. Purely
analytic, produces organic flowing curves — the visual gap between "straight
lines" and "convincing organic motion" without needing flow-field simulation.
The `wander` type (item 6) is a simplified version; harmonic generalizes it.
Unlocks: Flurry-like streams, aurora, jellyfish tentacles, calligraphy.

**16. Waypoint / path motion.** `{ type: 'path', points: [{x,y,t}...],
curve: 'bezier' | 'catmull-rom' }`. Cubic spline evaluated at t mod duration —
pure function, deterministic. Unlocks: choreographed movement, figure-8
patterns, race tracks, roller coasters, ballet (abstract). Per-entity offset
phase so multiple entities on the same path don't stack.

**17. Perspective depth (z-axis).** `depth` field on a layer or per-entity,
with perspective projection: `screen_x = x / (1 + z·fov)`. Stars at high z
are small and slow; at low z, large and fast — this IS the warp starfield.
Stays analytic (z decreases linearly or via drift in the depth axis). Unlocks:
warp/starfield, fly-throughs, 3D parallax that's physically correct instead
of hand-faked with multiple layers.

**18. Canvas-fade trail (ghosting).** A global or per-layer
`ghosting?: number` (0..1) that paints a semi-transparent background rect
each frame instead of fully clearing. This is Mystify's core trick — every
entity leaves decaying after-images without per-entity trail sampling. Very
cheap, very atmospheric. Different from the entity-level `trail` (which
samples past positions); this is a frame-compositing effect. Unlocks: Mystify
polygons, paint-like smearing, long-exposure photography look.

**19. Spawn timing / lifecycle.** `enter?: number` and `exit?: number` (ms)
on a layer. Before `enter`, entities don't exist; after `exit`, they fade
out and stop. Enables act structure: "stars appear first, then dancers enter
at t=3000, spotlight fades in at t=5000." Pure function of t — no state.
Unlocks: scripted sequences, narrative scenes, title cards, curtain-up
moments.

**20. Polygon / connected-vertex shapes.** A sprite kind where N vertices
bounce or follow paths independently, connected by lines. This is exactly
Mystify (and Qix, cat's cradle, string art). Could be a `polygon` sprite
kind with `vertices: N` or a special layer mode where `links` connect
entities in order (not k-nearest). Unlocks: Mystify, geometric string art,
morphing shapes.

**21. Grid layout.** `layout: 'grid'` on a layer — entities snap to a grid
rather than scattering randomly. Combined with sprite cycling and column-aware
spawn regions, this unlocks Matrix rain (characters in fixed columns, each
column falling at its own speed). Also useful for tile patterns, mosaics,
LED walls.

### Beyond this schema — future schema types

The current schema (schemaVersion 1) models one family well: **sprite fields**
(layers of independently moving entities over a painted background). That
covers a big chunk of classic screensavers, but not all of them. The patterns
below need fundamentally different rendering models. Rather than stretching
the sprite-field schema to breaking point, these are candidates for future
schema types — each with its own compiler, its own invariants, and its own
`schemaVersion`.

| Pattern | Why it needs its own schema | Existing imperative saver |
| --- | --- | --- |
| **Fluid / smoke / lava lamp** | Navier-Stokes PDE on a velocity+density grid. Every cell depends on neighbors; no sprite decomposition. A fluid schema would specify emitters, viscosity, diffusion, color map — the compiler runs the solver. | `fluid` |
| **Reaction-diffusion** | Gray-Scott coupled diffusion. Two chemical fields with neighbor-dependent update rules, 32+ substeps/frame, pixel-level output. Schema would specify feed/kill rates, seed regions, color mapping. | `reaction-diffusion` |
| **Pipes / accumulative growth** | Frame-to-frame spatial state: "which cells are filled." Each step depends on history. Schema would specify grid size, growth rules, palette, segment shapes. | `pipes` |
| **Cellular automata** | Grid where each cell's next state depends on neighbor state. Game of Life, Rule 110, Langton's ant. Schema would specify rule table, grid size, seed pattern, color map. | — |
| **N-body gravity** | Chaotic: each body's path depends on all other bodies at every timestep. No closed-form solution for N > 2. Schema would specify masses, initial conditions, integrator params. | — |
| **Flocking / boids** | Velocity depends on neighbors (separation, alignment, cohesion). Emergent behavior from local rules. Schema would specify neighbor radius, weights, speed limits. | — |
| **Collision response** | Position depends on other entities' positions. Billiards, Newton's cradle, ragdoll. Schema would specify shapes, masses, restitution, constraints. | — |
| **Growing fractals** | IFS point accumulation, fractal flames with tone mapping, Mandelbrot zoom. Either accumulative, grid-based, or re-computed each frame. Schema would specify transforms, iteration count, color mapping. | — |

The pattern: each of these families has a small parameter space (a few
knobs that control the visual) but a complex computational core. That's
exactly what schemas are for — an agent describes WHAT it wants, the
compiler handles HOW. The question is which families are worth building
compilers for, and the answer will come from what agents and users
actually try to create.

The sprite-field schema is the foundation because it covers the widest
range of aesthetics with the least computation. But the architecture
(validate → compile → mount) works for any rendering model — the schema
type just determines which compiler runs.

### The creative frontier

The most interesting new scenes live at the boundary: patterns that LOOK
like simulation but are actually analytic. Examples:

- **Fake flocking:** harmonic motion with correlated phases across entities in
  a layer produces schooling/swarming appearance without interaction forces.
- **Fake gravity:** orbit motion with grow/pulse gives planets and moons.
  Waypoint paths with parabolic arcs give thrown objects. No actual gravity.
- **Fake fluid:** many soft circles with harmonic motion, additive blend, and
  canvas-fade ghosting produce aurora/plasma. No PDE solver.
- **Fake collision:** bounce motion already reflects off edges. For
  entity-entity collisions there's no analytic solution — but careful
  path/waypoint choreography can fake a billiards sequence.

The format's job is to make these "fakes" easy to author and convincing to
watch. An agent that understands these building blocks can produce scenes
that feel dynamic and physical while being pure functions of time.

### Fractals — what fits, what doesn't

Static fractals (Mandelbrot, Julia, Sierpinski, Koch, L-system trees) are
computed once and drawn as a shape. A `fractal` sprite kind with parameters
(type, depth, angle, branching ratio) could draw a pre-computed fractal
glyph — then the format's motion/pulse/grow/trail animates it normally.
A field of drifting Koch snowflakes, a breathing L-system tree, rotating
Sierpinski triangles with trails. The fractal doesn't grow — but it's a
visually rich sprite.

Growing/evolving fractals (IFS accumulating points, fractal flames with
tone mapping, Mandelbrot zoom re-computing the grid each frame, L-systems
branching generation by generation) are either accumulative, grid-based,
or computationally heavy. These stay imperative.

**22. Fractal sprite kind.** `{ kind: 'fractal', type: 'koch' | 'sierpinski'
| 'tree', depth: number, angle?: number, ratio?: number }`. Pre-computed at
mount, drawn as a path. Depth capped for perf (Koch 6, Sierpinski 7,
tree 10). Combined with spin + grow + pulse, a single fractal sprite is
more visually dense than any other primitive. Low priority but high
novelty-per-effort ratio.
