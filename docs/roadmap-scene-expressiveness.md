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
