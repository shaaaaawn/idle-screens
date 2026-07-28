---
'@idle-screens/savers-classic': minor
---

The first artist-workshop batch: five classics brought up to the full modern
kit (typed params, closed-form `renderFrame(t, seed)`, exported demo tracks,
worker-ready where canvas-only), with their original motion signatures
preserved exactly.

- **Bouncing Logo (`dvd`)** — `dvd` + `logo` consolidated into one canvas
  saver (`logo` id retired). Marks: generic dvd wordmark / idle-screens /
  diamond / ring — drawn, never trademarked assets. Wall-hit hue steps and
  corner celebrations are ANALYTIC (hit counts from floor(t/period)), zero
  accumulated state, zero RNG. Now worker-ready.
- **Warp** — closed-form starfield (per-star identity from `rng.fork(i)`,
  progress pure in t). The classic spawn pop-in is gone: a smoothstep alpha
  envelope, continuous through the recycle wrap. Params: density, speed,
  tint, streak, twinkle (shimmer ≥800ms, flash-safe).
- **Globe** — kept 0.9 rad/s spin, 90 px/s bounce, 21/11 lattice as defaults.
  Aliasing fixed: dot scatter → polyline strokes at 0.85/dpr with
  back-hemisphere depth fade and an additive limb glow. Params: density,
  spin, bounce, wire, glow, depthFade.
- **Fade Out** — rebuilt from CSS onto canvas: seeded per-cell thresholds
  (row/col-salted forks — resize never re-rolls surviving cells) dissolve and
  reform the field; dissolve/scan/blinds patterns; every cell eases over
  ~200ms of phase, spread across the cycle by construction (flash-safe by
  math, not luck). The 40s Fade Away leg is preserved.
- **Flurry** — trail converted from accumulated pixel fades (unseekable) to
  analytic look-back sampling of the same closed-form arm path. Params:
  arms, speed, glow, trail, palette (aurora/ember/mono/spectrum), size.

Pause/resume keeps its place. The closed-form loops these savers moved to
derive logical time from the rAF clock, and `start()` re-anchors that origin —
correct at mount, but it made the first frame after every `setPaused(false)`
render logical time zero, so pausing and resuming (or toggling reduced motion)
snapped Warp, DVD and Flurry back to their opening frame and restarted any
applied control track. The frozen time is now carried across the re-anchor.

Classic catalogue: 19 → 18 savers (logo folded into dvd).
