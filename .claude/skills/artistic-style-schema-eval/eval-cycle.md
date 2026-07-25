# Eval cycle — runs, scoring, gaps

## Run ID

`run-YYYYMMDD-HHMM-<shortnote>` e.g. `run-20260725-1200-baseline-v0`

Each run is append-only. Never edit a past summary to make a new run look
better — write a new run and diff.

## Scoring composite

Per screen:

```
valid          = validateSpec.ok ? 1 : 0
advisory_pen   = min(1, highSeverityCount * 0.15)
perception_ok  = coverage∈band ∧ luminanceVar≥floor ∧ entities>0
style_fit      = 0..1 (palette + motion + density heuristics)
intent_fit     = 0..1 (benchmark-specific checks; 1 for free signatures)

score = valid * (0.35*perception_ok + 0.35*style_fit + 0.30*intent_fit)
        * (1 - advisory_pen)
```

Suite score = median of screen scores. Artist score = median within artist.
Benchmark comparability score = variance of scores across artists on the
*same* benchmark id (high variance can mean DNA is working; near-zero may
mean applicator collapse).

## Perception bands (defaults)

| Metric | Fail below | Soft target |
| --- | --- | --- |
| coverage | 0.002 | 0.01–0.45 |
| luminance variance | ~0 (flat black) | > 0.0005 |
| layer count (layered-depth) | 3 | 4+ |

Tune in `score.ts`; record band changes in the run summary `config` block.

## Gap graduation

`schemaGaps` and repeated `intent_fit` failures graduate to:

1. `loops/spec-feature-pipeline` backlog (schema feature), or
2. Prompting notes in StyleDNA `research` (authoring skill issue), or
3. Rejected-as-impossible (document why; stop retrying)

## Next-cycle inputs

A good run artifact lets the next agent start without re-researching:

1. Which artists are below suite median?
2. Which benchmark id is collapsing (all artists look the same)?
3. Top schemaGaps by frequency
4. Screens that fail validate (bugs) vs fail style-fit (DNA/applicator)

## Durable Object note

StyleDNA fields under `palette`, `markMaking`, `motionDialect`,
`composition`, plus `durableKeys`, are the candidate shape for a future
idle-server Durable Object (`StyleDO`): channel steers keys; screens
recompile from DNA × intent. Keep profiles serializable JSON.
