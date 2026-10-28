---
'@idle-screens/schema': patch
---

Two papercuts:

- `pulse.amp: 0` is valid and means no pulse (X706). A generator can now write one layer shape for its lit and unlit variants. Negative amps and amps over 0.5 are still refused, and the message now names the real range ("must be a number from 0 (no pulse) to 0.5"). The published JSON Schema allows 0 too, and a pulse of amp 0 no longer sets a period in `scenePeriod`.
- `scenePeriod` and the `loop-seam` advisory count a spin at its drawing's rotational symmetry (X709). A spinning circle or ring sets no period at all. A regular `sides` n-gon repeats every 360°/n. A `points` or path drawing repeats every 360°/n when each of its paints maps onto itself under that turn: for example, 18 identical spokes at `spin: 16` repeat every 1250 ms instead of 22.5 s, and the part is labelled `spin (18-fold)`. Gradients, part-drawn strokes, stretched `span`s and soft fills off their `origin` are still treated as asymmetric.
