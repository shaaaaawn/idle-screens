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

### E1 addendum — adviseSpec gaps

`adviseSpec` covers: invisible-layer, sparse-scene, dense-scene, text-heavy,
link-starvation, uniform-motion, off-center, and trail-on-static. **Remaining:**
- Contrast vs background luminance (partially covered by invisible-layer for
  circles, not for text or links)
- Extreme alpha range warning

---

## Suggested build order (remaining work)

1. **C2 render-stat confirmation** — viewer reports stats to channel state
2. **B2 richer links** — falloff + random mode for graph visualizations
3. B3, F2 — polish
