# Artistic Style Evals

Playground `#evals` tab + headless suite for measuring whether SaverSpec can
carry named artistic styles.

## Layout

| Path | Role |
| --- | --- |
| `types.ts` | StyleDNA + screen/score/run shapes (DO-ready) |
| `artists.ts` | 15 artists × research + schema mapping + signature prompts |
| `benchmarks.ts` | 5 shared intents (held constant across artists) |
| `style-apply.ts` | DNA × intent → SaverSpec |
| `score.ts` | validate / perceive / style-fit / intent-fit |
| `catalog.ts` | memoized 150-screen catalog |
| `evals-panel.ts` | playground UI |
| `run-baseline.ts` | headless runner → `runs/<runId>/` |
| `runs/` | append-only run artifacts for the next cycle |

## Counts

- 15 artists (distinct movements)
- 5 shared benchmarks × 15 = 75
- 5 signatures × 15 = 75
- **150 screens total**

## Run

```bash
# Playground UI
pnpm --filter @idle-screens/playground dev
# open http://localhost:5173/#evals

# Headless baseline (writes runs/ + runs/latest/)
pnpm --filter @idle-screens/playground eval:styles
```


## Skill + loop

- Skill: `idle-screens/.claude/skills/artistic-style-schema-eval/`
- Loop: `idle-mono/loops/artistic-style-eval/`

## Next-cycle contract

Each run writes `summary.json`, `results.jsonl`, `gaps.md`. The next agent
should start from `runs/latest/gaps.md` — weak artists, collapsed benchmarks,
and top schema gaps — not from a blank research pass.
