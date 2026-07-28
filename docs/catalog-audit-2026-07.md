# Catalog Audit — July 2026

*A saver-by-saver review of the whole catalog: consistency, consolidation,
visual quality, observability (params / renderFrame / demo tracks / worker),
attribution, and where each piece should go next. The companion doc is
[passthrough-stagecraft.md](passthrough-stagecraft.md) (the artistic grammar);
this one is the curator's ledger.*

## The state of the catalog, in one table

| id | backend | params | renderFrame | worker | attr | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| black-hole | canvas2d | 10 | ✓ | – (PT) | n/a | flagship, healthy |
| tide | canvas2d | 14 | ✓ | – (PT) | n/a | healthy |
| limelight | canvas2d | 18 | ✓ | – (PT) | n/a | healthy |
| slipstream | canvas2d | 12 | ✓ | – (PT) | n/a | healthy |
| catwalk | canvas2d | 10 | ✓ | – (PT) | n/a | healthy, still growing |
| messages | canvas2d | 7 | ✓ | ✓ | ✓ | just modernized — the template |
| toasters | css | 0 | ✗ | ✗ | ✓ | protected artifact (see below) |
| fish | css | 0 | ✗ | ✗ | ✓ | protected artifact |
| dvd | css | 0 | ✗ | ✗ | ✗ | **consolidate with logo (P1)** |
| logo | css | 0 | ✗ | ✗ | ✓ | **consolidate with dvd (P1)** |
| warp | canvas2d | 0 | ✗ | ✓ | n/a | **modernize (P2)** |
| globe | canvas2d | 0 | ✗ | ✓ | ✓ | **modernize (P3)** |
| fade-out | css | 0 | ✗ | ✗ | ✓ | **rebuild on canvas (P4)** |
| flurry | canvas2d | 0 | ✗ | ✓ | n/a | **modernize (P5)** |
| rainstorm | canvas2d | 0 | ✗ | ✓ | ✓ | modernize (P6, with hard-rain) |
| hard-rain | canvas2d | 0 | ✗ | ✓ | ✓ | fold into rainstorm as `intensity` (P6) |
| spotlight | canvas2d | 0 | ✗ | ✓ | ✓ | params + upgrade to victim-aware PT (P7) |
| bouncing-ball | css | 0 | ✗ | ✗ | ✓ | canvas port + squash/stretch params (P8) |
| bsod | css | 0 | ✗ | ✗ | ✗ | keep DOM (it *is* a screenshot); add screens params (P9) |
| pipes | canvas2d | 2 | ✓ | ✓ | n/a | DONE (July 2026): compiled-plan rewrite — renderFrame, tempo/density params, demo track. The audit's "renderFrame hard (accumulative)" was wrong; the catwalk's compile-the-history pattern applies to any seeded accumulation. |
| mystify | canvas2d | 0 | ✗ | ✓ | ✓ | params (polygon count, trail, palette) (P11) |
| fluid | canvas2d/gpu | 0 | ✗ | ✓(cpu) | n/a | params (emitters, palette); renderFrame impossible — document (P12) |
| reaction-diffusion | canvas2d/gpu | 0 | ✗ | ✓(cpu) | n/a | same as fluid (P12) |
| schema examples ×14 | canvas2d | spec | ✓ | ✓ | n/a | healthy; Control Center just rebuilt |

## Cross-cutting findings

1. **The catalog is two generations deep and it shows.** The deep passthrough
   savers and schema savers are steerable, deterministic, observable. Eleven
   classics are 0-param black boxes the timeline can only "live-preview." The
   messages consolidation defined the modernization template: canvas repaint,
   closed-form `t`, typed params, demo track, worker-ready, attribution.
   Modernization ≠ redesign: **periods and shapes of the originals are
   preserved closed-form** (messages kept the 10s crawl / steps(3) / 8s+17.3s
   pair exactly).
2. **Consolidation debt.** dvd + logo are the same saver (a bouncing mark)
   with different sprites — exactly the messages/messages2 situation.
   rainstorm + hard-rain are one saver with an intensity knob.
3. **Protected artifacts.** toasters and fish embed original Berkeley Systems
   artwork; their CSS implementations are faithful museum pieces. Do NOT
   modernize their rendering — the sprites and their 4-frame flaps are the
   point. They keep attribution and stay as-is (a `protected: museum` note
   belongs in their file headers).
4. **Attribution gaps** (post-batch): dvd (none — and the real DVD logo is a
   trademark; the saver must keep drawing a generic mark), bsod (visual
   reference to a Microsoft screen; needs a "parody/homage, no MS assets"
   note). Everything After Dark now carries `manifest.attribution`.
5. **Observability asymmetry.** Only savers with `renderFrame` get scrubbing,
   perception determinism, and honest thumbnails. The accumulative/simulated
   three (pipes, fluid, RD) can't have it — that's fine, but the manifest
   should SAY so (a `timeModel: 'closed-form' | 'accumulative' | 'simulated'`
   field is the eventual fix; not urgent).
6. **Pixel-perfection nits observed in gallery sweeps:** warp stars pop in at
   full alpha at the spawn radius (needs fade-in ramp); globe's wireframe
   aliases hard at DPR 1; dvd's CSS mark is a plain rect (reads cheap next to
   the canvas savers); fade-out's step transitions bang instead of easing.

## The top five (executed this cycle — see artist-workshop-2026-07.md)

- **P1 — Consolidate dvd + logo** into one modern `logo` canvas saver:
  `mark` enum (generic-dvd / idle-screens wordmark / diamond / ring),
  corner-hit color shift, squash on wall hits, params, demo track. Owns all
  registry/test/count changes. dvd id retired.
- **P2 — Warp**: params (density, speed, hue, streak, twinkle), spawn fade-in,
  closed-form star field (stars as pure functions of t — hash per star index),
  renderFrame, demo track.
- **P3 — Globe**: params (density, spin, hue, glow, bounce), closed-form
  bounce+rotation, DPR-aware line weights, renderFrame, demo track.
- **P4 — Fade-out**: canvas rebuild; dissolve grid closed-form from seeded
  per-cell thresholds; params (cellSize, pattern: dissolve/scan/blinds,
  speed, ink); renderFrame; demo track.
- **P5 — Flurry**: params (arms, speed, palette drift, glow, trailLength),
  closed-form arm motion, renderFrame, demo track.

Shared-file protocol for the batch: only P1 touches `index.ts` /
`savers.test.ts` / e2e ids. P2–P5 are strictly in-place single-file rewrites +
their own test files; demo tracks are EXPORTED but registered centrally by the
curator afterward (timeline-profiles.ts is a merge hotspot).

## The bench (next cycles)

P6 rainstorm+hard-rain merge · P7 spotlight params & victim glances ·
P8 bouncing-ball canvas port · P9 bsod screens params · P10-12 params for the
accumulative three + `timeModel` manifest field · schema `links.width`
validator warning (>0.05 is almost always a px-vs-normalized mistake) ·
gallery cards showing an ATTR chip when `manifest.attribution` exists.
