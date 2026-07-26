---
'@idle-screens/core': minor
'@idle-screens/savers-classic': minor
'@idle-screens/schema': minor
---

**savers-classic — Messages consolidated and modernized.** The two hard-coded
CSS keyframe ports ("Out to Lunch" and "Macintosh") are now two `mode`s of ONE
canvas saver. `messages2` is removed (its behaviour lives on as
`mode: 'drift'`). The new saver is closed-form in `t` (the timeline scrubs
it), worker-ready, typeset on a modern system stack instead of 1992 Times New
Roman, and carries 7 typed params (`phrase`, `mode`, `speed`, `textScale`,
`ink`, `glow`, `trail`) plus a demo track. Classic 19 → 18 savers.

**core — `SaverManifest.attribution`.** Savers derived from licensed or
third-party work now declare their lineage in the manifest itself
(`source`, `license`, `url`), so every surface that showcases a saver can
show its license. All ten After Dark-descended savers and Mystify carry it;
the playground shows Source/License rows in Properties and a line in the
fullscreen preview. CREDITS.md remains the full ledger.

**schema — Control Center rebuilt as a real ops wall.** The example is now
VIREO-9, Trans-Lunar Relay Operations: framed zones, three dish arrays with
live signal bars, a cislunar orbital plot with a five-craft fleet on orbit
motion (trails + hairline chain links as the relay web), telemetry with a
hero signal readout, an event log, an alert chip, a relay-load meter and a
pass schedule — booted in stages, composed deliberately against the 36-layer
ceiling. (Entity-stream snapshot regenerated: the spec change is the point.)
