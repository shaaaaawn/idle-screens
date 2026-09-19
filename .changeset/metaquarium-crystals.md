---
'@idle-screens/saver-metaquarium': minor
---

Crystals — the first scenery prop, generated from the seed and instanced
(`propMix: "crystal#hero:1@lotus/hotpink, crystal:5@druse"`). Habits `lotus`
(the original cluster's measured 1/6/9/16 rosette), `spire`, `druse`,
`scatter`; palettes follow the room, a named colour, `rainbow`, or `glass`.
Nothing is fetched: a scene of clusters is ~5–10k triangles in seven draw
calls, where one original crystal GLB was 39.6k.

A closed-form light field lights without lights: crystals shade from their
own facets, glow through a halo shell and one card per cluster, throw
pulsing colour pools on the floor, and (opt-in, `crystalTint`) tint fish that
swim past. Fish ride over clusters instead of through them. New params:
`propMix`, `envProps` (off by default — a room only brings its own crystals
when asked), `crystalScale`, `crystalGlow`, `crystalPulse`, `crystalTint`.
`inspect()` reports every cluster. An empty `propMix` builds nothing and
compiles the stock floor program, so published scenes are unchanged.
