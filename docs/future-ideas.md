# Future Ideas — schema, core & MCP improvements

> **Status:** Updated 2026-07-23. Research backlog, not a commitment.
> Each idea lists the **problem**, a **proposal**, **where it lives in code**,
> and **open questions**.
>
> **Origin:** surfaced by a non-vision model (Claude) making art on the platform
> using only the MCP tools — it could author and publish scenes but never see
> what it created. The piece _Weights_ (attention as a linked graph of nodes)
> exposed two gaps: entity counts are absolute while geometry scales (sparse on
> 4K), and there is no text-based feedback channel for what the render looks
> like. Every authoring failure was computable but silent.

---

## Implementation status

| #   | Idea                          | Status       | Notes                                                       |
| --- | ----------------------------- | ------------ | ----------------------------------------------------------- |
| C1  | Looping control tracks        | **Done**     | `control-track.ts` — `{ loop: true, duration }` wraps `t`  |
| D1  | Token recovery / admin reset  | **Done**     | `/admin/rotate/:id` and `/admin/delete/:id` in idle-server  |
| E1  | Authoring advisories          | **Done**     | `adviseSpec()` in `packages/schema/src/advise.ts`           |
| B1  | Density-aware counts          | **Done**     | `buildEntities` auto-scales count by `min(w,h)/1080` for viewport-unit specs |
| F1  | `describeScene` scene dump    | **Done**     | `describeScene()` in `packages/schema/src/describe.ts` — multi-t snapshots |
| F3  | `critiqueScene` heuristics    | **Done**     | `adviseSpec` now covers link-starvation, uniform-motion, off-center |
| A1  | _Weights_ channel tuning      | **Actionable** | No code change — re-publish with adjusted spec            |
| B2  | Richer links (falloff + mode) | Open         | Fidelity upgrade for graph pieces                           |
| B3  | Weighted color palettes       | Open         | Low priority polish                                         |
| C2  | Render-stat confirmation      | Open         | Catch empty/invisible without eyes — **validated again in round 3; also unlocks live A/B diff** |
| F2  | ASCII luminance map           | Open         | Perceivable image for text models                           |
| G1  | Calibrate additive-glow in perceive | **Shipped (2.4.0)** — first-pass constant | Halo modeled; `GLOW_SPREAD=2.4` still needs playground calibration |
| G2  | Geometry-aware dominance      | **Shipped (2.4.0)** | Line-salience boost for rings/streaks/links in `dominanceRanking` |
| G3  | `spin` as `[min, max]` range  | **Shipped (2.4.0)** | Full chain; scalar streams byte-identical (determinism suite) |
| G4  | Higher-res / sizable perception grid | **Shipped (2.4.0)** | `renderDensityMap` + `perceiveScene().text` (text listing)   |
| G5  | Spec version stamping / migration | Open     | Schema 2.3.0 viewport-unit default broke previously-valid live channels |

---

## Open ideas (not yet implemented)

### B2 — Richer `links`

**Problem.** Links connect to `k` nearest neighbors within `maxDist`. Two gaps:
(a) edges are uniform brightness regardless of distance, (b) nearest-neighbor
produces a local mesh, not the long-range connections of a real attention graph.

**Proposal.**
- `links.falloff?: 'linear' | boolean` — alpha × `(1 - dist/maxDist)`.
- `links.mode?: 'nearest' | 'random' | 'mixed'` — `random` = seeded random
  partners (long-range), `mixed` = some near + some far.

**Where.** `src/types.ts` (`links`), the link-drawing code in the compiled saver
runtime, `src/simulate.ts`.

**Constraints.** `maxLinksK = 8`; random edges must be seeded per-layer.

### B3 — Weighted color palettes

**Problem.** `circle.colors` picks uniformly. "Sparse bright" requires duplicating
cool entries — fragile.

**Proposal.** Accept `colors: string[]` (current, uniform) or
`colors: { pick: string[]; weights?: number[] }`.

**Where.** `src/types.ts` (`SpriteSpec` circle), `src/simulate.ts`.

### C2 — Render-stat confirmation

**Problem.** `publishScene` confirms mount success/error, but nothing about
whether the result _looks right_: sparse fields, invisible links, vacancy all
return success and silence.

**Proposal.** Viewer reports cheap stats on mount — `{entities, linksDrawn,
coverage?}` — stored on channel state, surfaced in `publishScene` response and
`getState`.

**Where.** Core viewer mount path, `idle-server/src/screen-channel.ts`,
`idle-server/src/worker.ts`, MCP `getState`.

### F2 — ASCII luminance map

**Problem.** Even with F1's numbers, spatial layout isn't perceivable as text.

**Proposal.** Downsample a render to ~48×24 text grid where each cell is a density
character (` ·:+*#@`) encoding luminance. A text model can read "bright mass
low-center, empty top-right" without vision.

**Where.** Needs a headless render path (or compute from entity positions +
radii without actually rendering).

### G-series — round 3 feedback (2026-07-23, second non-vision authoring session)

> Origin: a second non-vision agent authored and shipped four savers (Midnight
> Zone, Infinity Net, Aurora, af Klint) using only the MCP + a live-canvas
> pixel-read via chrome-devtools. Its written feedback was triaged; items that
> duplicate C2/F2 were folded in above. These are the genuinely new ones.

### G1 — Calibrate additive-glow in the analytical model

**Problem.** `perceiveScene` composes `lighter`/`screen` additively
(`perceive.ts` `compose()`), but the live renderer's glow (shadowBlur halos,
overlapping soft discs) makes real coverage far higher — one glow-heavy scene
measured 1.6% coverage analytically vs ~40% live, a 25× gap. For a non-vision
agent the primary feedback channel under-reports what the audience sees by an
order of magnitude, so every design decision about glow density is made blind.

**Proposal.** Model the halo: when a layer has `blend: 'lighter'` and soft
sprites, splat each entity with an enlarged effective radius (e.g. radius ×
glow factor) and a radial falloff, instead of hard-edged area. Even a crude
calibration constant tuned against a handful of live measurements would
shrink the gap dramatically. Failing that, annotate the preview output:
`"coverage is a lower bound; additive scenes render 3–10× denser live"`.

**Where.** `packages/schema/src/perceive.ts` (`compose`, sprite splatting).

**Open questions.** How to get ground-truth calibration data — a one-off
manual measurement against the playground is probably enough.

### G2 — Geometry-aware dominance for thin structures

**Problem.** Dominance weight is `area × contrast × blendBoost × motionBoost`
(`perceive.ts` ~453). Thin-but-bright structures — orbit rings with trails,
streaks, link lines — get near-zero area and thus near-zero dominance, even
when they're the most visually striking element on screen. This misleads
agents into over-boosting elements that are already prominent. The most
avant-garde compositions (geometric, diagrammatic, line-based) are exactly
the ones the metric misreads.

**Proposal.** Add a structure factor: elements whose ink is line-like
(streaks, rings, links, orbit trails) get weighted by perimeter/length ×
stroke width with a visibility floor, not raw filled area. A bright arc is
more visible than a dim disc of equal area.

**Where.** `packages/schema/src/perceive.ts` (`dominance` factors).

### G3 — `spin` as a `[min, max]` range

**Problem.** Every other per-entity parameter (`speed`, `alpha`, `radius`,
`size`, pulse amp/period) is a seeded `[min, max]` range; `spin` is a scalar
(`types.ts` `spin?: number`). Agents instinctively write `spin: [6, 14]` and
get a validation error. Consistency paper-cut, cheap fix.

**Proposal.** Accept `number | [number, number]`. Per the RNG-compat
invariant, consume the extra RNG draw **only when the array form is present**
so existing specs keep identical entity streams.

**Where.** `types.ts`, `validate.ts`, `simulate.ts` (`buildEntities`),
`saver-spec.schema.json`, FORMAT.md (+ mirror in idle-server
`SCHEMA_REFERENCE`).

### G4 — Higher-resolution / sizable perception grid

**Problem.** The 40×12 braille map answers "is there a blob upper-left?" but
cannot resolve concentric rings, grids vs scatter, or text glyphs. Agents
that found a live-canvas pixel read (80×22+ density chars) reported it was
their real "sight."

**Proposal.** Let `previewScene`/`perceiveScene` take an optional grid size
(up to ~160×48) and offer a density-char map (` .:-=+*#%@`) alongside
braille. Also list text sprites explicitly (string, position, size) since no
grid resolution renders glyphs. Pure analytical change — no renderer needed.

**Where.** `packages/schema/src/perceive.ts`, MCP `previewScene` tool schema
in idle-server.

### G5 — Spec version stamping / migration for stored specs

**Problem.** (From the ops side, not the authoring agent's feedback.) Schema
2.3.0 changed the meaning of unadorned dimensional values (`units` now
defaults to `"viewport"`, with a ~3.70 viewport-units/sec speed cap). Every
previously-published channel spec with px-scale values silently became
invalid — live channels failed to resolve in production, and the smoke-test
fixture broke the deploy gate. There is no compat story for stored specs when
validation tightens or a default changes meaning.

**Proposal.** Stamp specs with the schema package version at publish time
(server-side, alongside the stored spec). On read, if the stored stamp
predates a semantic change, apply a migration (e.g. pre-2.3 specs get
`units: "px"` injected) or validate against grandfathered rules. Rule of
thumb going forward: a new field may default, but a default must never
*reinterpret* existing values — add the field as opt-in first.

**Where.** `idle-server/src/screen-channel.ts` (stored state),
`worker.ts` publish path; schema changelog discipline in this repo.

### Deferred / noted, not adopted

- **`previewLive` headless render.** The highest-fidelity ask, but Cloudflare
  Workers have no canvas; a real headless render means Puppeteer/node-canvas
  infrastructure. C2 (live render stats from the viewer) + G1 (calibrated
  analytical model) buy most of the value for ~5% of the cost. Revisit only
  if those two land and the gap still hurts.
- **`compareLive(channelA, channelB)`.** Falls out of C2 for free — once
  render stats live on channel state, a diff is client-side arithmetic.
  Folded into C2's notes rather than tracked separately.
- **`listChannels` search/filter.** idle-server QoL, not schema. Small.
- **`pulse.wave` angular phase along orbits.** Niche; revisit if concentric-
  ring scenes become a recurring genre.
- **Parent-dir `.mcp.json` discovery.** Agent-harness concern, not this repo.
  Practical workaround: drop an `.mcp.json` in `idle-mono/` pointing at the
  idlescreens.com MCP endpoint.

### E1 addendum — adviseSpec gaps

`adviseSpec` covers: invisible-layer, sparse-scene, dense-scene, text-heavy,
link-starvation, uniform-motion, off-center, and trail-on-static. **Remaining:**
- Contrast vs background luminance (partially covered by invisible-layer for
  circles, not for text or links)
- Extreme alpha range warning

---

## Suggested build order (remaining work)

1. **C2 render-stat confirmation** — viewer reports stats to channel state
   (validated by two independent agent sessions; also unlocks live A/B diff)
2. **G1 additive-glow calibration** — closes the biggest perception gap
   (25× coverage under-report) for cheap
3. **G2 geometry-aware dominance** + **G4 higher-res grid** — perception
   fidelity for thin/geometric compositions
4. **B2 richer links** — falloff + random mode for graph visualizations
5. **G3 spin range**, B3, F2 — polish
