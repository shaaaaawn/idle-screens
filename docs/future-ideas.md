# Future Ideas — schema, core & MCP improvements

> **Status:** Updated 2026-07-18. Research backlog, not a commitment.
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
| C2  | Render-stat confirmation      | Open         | Catch empty/invisible without eyes                          |
| F2  | ASCII luminance map           | Open         | Perceivable image for text models                           |

---

## Open ideas (not yet implemented)

### B1 — Density-aware entity counts _(highest remaining payoff)_

**Problem.** `LayerSpec.count` is absolute. When `units: 'viewport'`,
sizes/positions scale to the display but count does not — so a field that reads
as rich at 1080p looks empty at 4K and cluttered on a phone.

**Proposal.** A `density?: number` field = entities per `referenceViewport²` area.
Effective count = `clamp(round(density * area / refArea), 1, maxPerLayer)`.

**Where.** `src/types.ts` (`LayerSpec`), `src/simulate.ts` (`buildEntities`),
`src/validate.ts`.

**Tradeoffs.**
- Determinism becomes per `(spec, seed, viewport)` — still deterministic, no
  longer resolution-invariant. Document; keep e2e proof pinned to a reference res.
- Cap overflow when scaling: prefer proportional downscale + advisory.
- `links` layers bounded by `maxLinkLayerCount = 200`; density must respect this.

**Open questions.** Linear vs quadratic scaling? Opt-in (`density` field) vs
opt-out (auto-scale when `units:'viewport'`)?

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

### F1 — `describeScene`: deterministic scene dump _(build next)_

**Problem.** A non-vision author (an LLM steering via MCP) has no text signal
about what the rendered frame looks like. The only feedback is "did it compile?"

**Proposal.** An MCP tool that calls `buildEntities(spec, seed)` and returns per
layer: entity count, centroid, bounding box, coverage %, mean luminance, contrast
vs background, and **links actually drawn** (computed by simulating the k-nearest
logic). Plus warnings derived from the numbers.

```jsonc
// describeScene({ channelId, t? }) →
{
  "t": 0,
  "viewport": { "w": 1920, "h": 1080 },
  "layers": [
    {
      "key": "graph",
      "count": 90,
      "centroid": [0.51, 0.49],
      "coverage": 0.18,
      "meanLuminance": 0.06,
      "contrastVsBg": 1.4,
      "linksDrawn": 4,
      "linksExpected": 270
    }
  ],
  "warnings": [
    "graph: linksDrawn << linksExpected — raise count or widen links.maxDist",
    "graph: contrastVsBg 1.4 < 3:1 — likely invisible"
  ]
}
```

**Why this is high-leverage:** `buildEntities` already exists and is deterministic.
This is ground truth, not a caption — no render or vision model needed. Would have
prevented every authoring failure in the _Weights_ session.

**Where.** New export in `packages/schema` (reuses `buildEntities` + link
simulation), new MCP tool in `idle-server/src/worker.ts`.

### F2 — ASCII luminance map

**Problem.** Even with F1's numbers, spatial layout isn't perceivable as text.

**Proposal.** Downsample a render to ~48×24 text grid where each cell is a density
character (` ·:+*#@`) encoding luminance. A text model can read "bright mass
low-center, empty top-right" without vision.

**Where.** Needs a headless render path (or compute from entity positions +
radii without actually rendering).

### E1 addendum — adviseSpec gaps

`adviseSpec` is implemented with: invisible-layer, sparse-scene, dense-scene, and
text-heavy checks. **Still missing** (per the original doc):
- Link starvation: a `links` layer where expected neighbor count < `k`
- Contrast vs background luminance (partially covered by invisible-layer for
  circles, not for text or links)
- Extreme alpha range warning

These could be added to the existing `adviseSpec` as follow-on work.

---

## Suggested build order (remaining work)

1. **F1 `describeScene`** — highest leverage, cheapest (reuses `buildEntities`)
2. **adviseSpec gaps** (link starvation, contrast) — incremental, feeds into F1
3. **C2 render-stat confirmation** — folds F1's signals into publish flow
4. **B1 density-aware counts** — root cause fix for 4K sparseness
5. **B2 richer links** — fidelity upgrade
6. B3, F2, F3 — polish
