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
| `evals-panel.ts` | playground UI (timeline + Compare + By artist + Gallery) |
| `run-timeline.ts` | run timeline rail + new-run provenance modal |
| `run-store.ts` | disk index + browser localStorage merge |
| `provenance.ts` | StyleDNA hash, RunProvenance builder, deltas |
| `connection-editor.ts` | shared OpenRouter key editor (run modal + `#settings`) |
| `run-defaults.ts` | operator/model defaults, prefilled into the run modal |
| `agent-loop.ts` | agent-loop engine: model authors a spec via tools (submit/perceive/score/finish) |
| `agent-artifact.ts` | training-set record shape (prompt, trajectory, versions, rejections, initial/final/best) |
| `agent-run.ts` | batch runner (targets x trials), browser store, training/SFT/repair JSONL export |
| `artifact-sink.ts` | POSTs a finished run to the dev-server disk sink (see below) |
| `eval-registry.ts` | the canonical eval list — ids, visibility, channel eligibility |
| `public-identity.ts` | research identity vs public identity; owns every spec `label` |
| `agent-panel.ts` | Agent run modal + `runAgentEvalInteractive` (OpenRouter progress UI) |
| `agent-bridge.ts` | folds agent artifacts into timeline runs (authored specs as evidence) |

### New run modes

| Mode | Network | Evidence on timeline |
| --- | --- | --- |
| **Agent** (default) | OpenRouter chat completions | Model-authored SaverSpecs + local scores |
| **Re-score** | none | Scores against today's static catalog only |
| `write-baseline.test.ts` | headless runner → `runs/<runId>/` + `index.json` |
| `runs/` | append-only run artifacts for the next cycle |

## Counts

- 15 artists (distinct movements)
- 5 shared benchmarks × 15 = 75
- 5 signatures × 15 = 75
- **150 screens total**

## Run

```bash
# Playground UI — Compare mode is default: one benchmark × all artists
pnpm --filter @idle-screens/playground dev
# open http://localhost:5173/#evals

# Headless baseline (writes runs/ + runs/latest/)
pnpm --filter @idle-screens/playground eval:styles
```


## Persisting agent runs

Agent runs cost real API calls and can't be reproduced — the model behind an id
drifts. `saveAgentRun` keeps only the last 5 in localStorage and evicts silently
on quota, so runs you care about need somewhere durable:

```bash
make dev-evals              # from the mono root
# or: IDLE_EVAL_SINK_DIR=/abs/path pnpm --filter @idle-screens/playground dev
```

With `IDLE_EVAL_SINK_DIR` set, each finished run writes `run.json`,
`training.jsonl`, `sft.jsonl` and `repair.jsonl` to
`<dir>/<evalId>/<runId>/`. Unset (the default, and always in a build) the sink
is off and nothing is written. `operator` is stripped before writing.

`training.jsonl` is the lossless one: every version with its full `ScreenScore`,
every rejected submission with the validator's errors, and a provenance envelope
so a single line is readable on its own. `sft.jsonl` completes from **best**,
not last — a model can refine into a worse final and stop there.

## Naming

`profile.artist` is a research label and stays exact. Everything a viewer sees —
spec labels, channel ids, captions — goes through `public-identity.ts` and uses
`publicName` / `channelId`. See [ACCREDITATION.md](./ACCREDITATION.md) and
`idle-mono/docs/eval-publishing-spec.md` §5.

## Skill + loop

- Skill: `idle-screens/.claude/skills/artistic-style-schema-eval/`
- Loop: `idle-mono/loops/artistic-style-eval/`

## Next-cycle contract

Each run writes `summary.json`, `results.jsonl`, `gaps.md`. The next agent
should start from `runs/latest/gaps.md` — weak artists, collapsed benchmarks,
and top schema gaps — not from a blank research pass.
