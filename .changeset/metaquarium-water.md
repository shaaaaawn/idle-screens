---
'@idle-screens/saver-metaquarium': minor
---

`water` — water instead of fog. Each colour channel fades toward the water colour over its own span: red first (40 % of the fog span), green next (70 %), blue last on today's exact curve, so a red fish goes blue-green before it goes into the murk and everything still meets the background at `fogFar`. 0 (default) is today's fog to the bit. Installed per material, lazily (the first time water is on), wrapping any existing shader patch and extending its program key; the crystal, halo and glow-card shaders share the same function (additive layers take only the loss, never the in-scatter).

`dither` (default `on`) — three's output dither on every material: ±½ of an 8-bit step, the cure for banding in dark fogged gradients on TV panels. `off` for byte-exact comparisons.
