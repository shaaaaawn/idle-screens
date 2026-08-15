# preset-recipe-v1 — the runner playbook

Given only a saver's `manifest.paramSpace`, author a wardrobe of **5 named
presets** per saver that are valid, diverse, and actually use the space. This
file is the runner contract: any harness (pi, Claude Code, Cursor, a bare
script) that follows it produces a scoreable, comparable run.

## The task, per fixture (one saver)

1. Read the saver's `paramSpace` from its manifest. Steerable savers live in
   `@idle-screens/savers-classic` (warp, dvd, pipes, mystify, fade-out,
   messages, flurry, globe) and the specialty packages (`saver-black-hole`,
   `saver-tide`, `saver-limelight`, `saver-slipstream`, `saver-catwalk`,
   `saver-metaquarium`). The scorer's `--list` mode prints the exact set.
2. Author 5 presets: `{ "name": "...", "params": { <key>: <value>, ... } }`.
   Names are moods a human would pick from a shelf ("midnight", "first-snow"),
   not enumerations ("preset-1"). Params must respect each key's type and
   bounds; keys you omit keep their defaults, and that is a legitimate choice.
3. You get NO visual feedback. That is the point of the eval: the paramSpace
   documentation (types, bounds, defaults, comments) is the whole interface,
   exactly as it is for an agent meeting a saver over MCP.

## Scoring (mechanical — run it yourself before finishing)

```bash
node apps/playground/src/evals/preset-recipe/score.mjs --list          # fixture set
node apps/playground/src/evals/preset-recipe/score.mjs <presets.json>  # score one file
```

Per saver, in [0,1] each:
- **validity** — fraction of presets whose every param exists in the space,
  matches its type, and sits inside bounds/enums. Weight 2.
- **diversity** — mean pairwise distance between presets (numbers normalized
  to their range, colors in RGB, bools/enums 0-or-1). Five near-identical
  presets score ~0. Weight 2.
- **coverage** — fraction of the space's params exercised (set away from
  default by at least one preset). Weight 1.

`total = (2·validity + 2·diversity + coverage) / 5` · **pass** requires
validity = 1 and diversity ≥ 0.25. Deliberately NOT scored: aesthetics.
A mechanical rubric can't judge taste, and pretending otherwise would launder
a random number into a leaderboard. Taste enters at promotion time, when a
human or a perception-equipped agent picks which passing presets ship to the
saver's shelf (`savePreset` on its channel — the showcase path).

## Run directory contract

`datasets/evals/preset-recipe-v1/run-<UTC>T<hhmm>-<model-slug>-<scope>/`
- `presets/<saver>.json` — the authored wardrobe per fixture
- `scores/<saver>.json` — the scorer's verdict per fixture
- `summary.json` — REQUIRED, the cross-eval contract:
  `{ runId, evalId, model, axes: { saver: "<id>|all" }, trials,
     fixturesRun, fixturesTotal, scores: [per-fixture totals], median }`

`fixturesTotal` is the scorer's `--list` count, whatever scope you ran —
a partial run must be readable as partial.
