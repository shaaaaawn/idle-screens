---
name: artistic-style-schema-eval
description: >-
  Deep-research an artist's or movement's visual style, translate it into
  SaverSpec schema primitives as a durable StyleDNA profile, and generate
  benchmark + signature eval screens for iterative training. Use when
  researching artistic style for idle-screens, building style evals, creating
  artist StyleDNA, running playground Evals tab suites, or mapping art history
  into schema capabilities / schema-gap feedback.
---

# Artistic Style → Schema Eval

Research a style deeply, encode it as **StyleDNA** (a durable, steerable
object), then produce eval screens that measure whether the schema can
*carry* that style — and what it still cannot.

Playground surface: `#evals` tab.
Data: `apps/playground/src/evals/`.
Loop: `idle-mono/loops/artistic-style-eval/`.

## When to use

- New artist / movement to encode
- Expanding the style-eval catalog
- Schema changed → re-run suite, compare to previous run
- Training / prompting agents to author in a named style
- Harvesting `schemaGaps` into `spec-feature-pipeline`

## Workflow (one artist or one run cycle)

Copy and track:

```
Style eval progress:
- [ ] 1. Research (no schema yet)
- [ ] 2. Extract StyleDNA
- [ ] 3. Map DNA → schema primitives
- [ ] 4. Generate 5 benchmark + 5 signature screens
- [ ] 5. Score (validate / perceive / style-fit)
- [ ] 6. Write run artifact + feed gaps forward
```

### 1. Research (thinking session — stay off the schema)

Before touching SaverSpec, answer in prose:

1. **Thesis** — what makes this style *itself* in 2–3 sentences?
2. **Palette & light** — hue families, value range, how light behaves
3. **Mark-making** — dots, planes, lines, ornament, gesture?
4. **Space** — flat, atmospheric, layered planes, deep parallax?
5. **Tempo** — stillness vs vibration vs drift
6. **Composition habits** — horizon, grid, focal mass, all-over field?
7. **What would be a *wrong* reading** of this artist (anti-patterns)?

Do not invent biographical fluff. Stay visual and compositional.
See [style-dna-template.md](style-dna-template.md).

### 2. Extract StyleDNA

Fill `ArtistStyleProfile` (`apps/playground/src/evals/types.ts`):

| Field | Role |
| --- | --- |
| `research.*` | Human-readable thesis (eval debug, agent prompts) |
| `palette` / `markMaking` / `motionDialect` / `composition` | Steerable knobs — future Durable Object shape |
| `schemaGaps` | What v1 cannot express → next schema cycle |
| `durableKeys` | Proposed DO param paths (`palette.warmth`, …) |
| `signaturePrompts` | 5 artist-owned intents |

**Rule:** StyleDNA must be usable *without* any screen — it is the style
object. Screens are applications of DNA to intents.

### 3. Map DNA → schema (creative translation)

Translate, don't literalize. Impressionist broken color ≠ “paint emoji”. Prefer:

| Art idea | Schema levers |
| --- | --- |
| Broken / optical color | many soft circles, low alpha, `blend: lighter`/`screen`, tight palette |
| Impasto / gesture | streaks, spin ranges, higher alpha contrast |
| Flat planes / De Stijl | `rect`, grid `layout`, static + slow drift, hard colors |
| Ukiyo-e bands | gradient + `band`, region-constrained layers, calm drift |
| Color field | huge soft circles, low count, long pulse, near-static |
| Infinity / all-over | high count, wrap, orbit/wander, ghosting |
| Op / vibration | pulse.wave, linked chains, near-complementary accents |

Record failures as `schemaGaps` (e.g. “no brushstroke sprite”, “no
perspective grid”, “no true subtractive pigment mixing”).

### 4. Screens: 5 shared benchmarks + 5 signatures

**Benchmarks** (same intents for every artist — cross-style compare):

| id | Intent |
| --- | --- |
| `calm-horizon` | Quiet ambient field with a readable horizon / band |
| `dense-field` | High-count particle or mark field, still ambient |
| `single-focal` | One dominant focal mass, supporting atmosphere |
| `layered-depth` | ≥3 depth layers with parallax / speed separation |
| `pulse-atmosphere` | Soft breathing glow; flash-safe pulse |

Generate via `applyStyle(intent, profile)` so the *intent* is held constant
and only DNA varies.

**Signatures** — five prompts that *only* make sense for this artist.
Hand-author or recipe-build; they must fail a style-fit check if DNA is
swapped with a distant artist.

### 5. Score

Use `scoreSpec(spec, profile, intent)` (`evals/score.ts`):

1. `validateSpec` — hard gate (invalid = fail)
2. `adviseSpec` — high-severity advisories
3. `perceiveScene` — coverage, luminance variance, centroid, dominance
4. Style-fit heuristics — palette overlap, motion dialect match, density band
5. Intent checks — e.g. layered-depth requires ≥3 layers + speed separation

Never grade on vibes alone. Persist numbers for the next run.

### 6. Run artifact (input to next cycle)

Write under `apps/playground/src/evals/runs/<runId>/`:

- `summary.json` — suite medians, per-artist scores, gap histogram
- `results.jsonl` — one line per screen
- `gaps.md` — aggregated schemaGaps + score failures (feed
  `spec-feature-pipeline` / prompting notes)
- `diff-vs-<prevRunId>.md` — when re-running after schema/prompt changes

## Anti-patterns

- Recoloring the same spec and calling it a new artist
- Literal celebrity portraiture / copyrighted compositions
- Ignoring flash floors (`pulse.period ≥ 500`)
- Tuning fixtures so scores look good
- Putting StyleDNA only inside screen JSON (must be a standalone object)

## Playground

1. `pnpm --filter @idle-screens/playground dev` → open `#evals`
2. **Run timeline** (top) — select a past run for provenance / next-cycle inputs
3. **New run…** — capture harness, model, system prompt, note, parent; scores append to the timeline
4. **Compare** — one benchmark × all artists; **By artist** for signatures
5. Headless: `pnpm --filter @idle-screens/playground eval:styles` → `evals/runs/` + `index.json`
6. Never start a cycle blank — read the selected run's `nextCycle.suggestedActions`

## Additional resources

- [style-dna-template.md](style-dna-template.md) — research + DNA worksheet
- [eval-cycle.md](eval-cycle.md) — scoring, run IDs, gap graduation
- `packages/schema/FORMAT.md` — SaverSpec source of truth
