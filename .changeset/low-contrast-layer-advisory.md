---
'@idle-screens/schema': minor
---

New `low-contrast-layer` advisory: catches a layer painted too close to its own
background to be seen. `invisible-layer` only measures radius × alpha, so a
full-size, fully-opaque layer in a background-matched colour previously passed
every check in `adviseSpec` — nothing in the perception surface read colour
against the plate behind it.

The measure is a **colour distance, not a luminance one**, and that distinction
is load-bearing: equal-luminance/contrasting-hue is a real technique, not a
mistake. A pointillist field of golden `#e8c060` dots over a pale grey-blue
ground differs by only 0.013 in luma and is perfectly visible — a luma-based
test flags exactly the screens it should leave alone. Additive layers
(`lighter`/`screen`) are judged instead by the light they add, since a
background-matched colour still brightens the plate under those blends.

Alpha and radius are deliberately excluded so that deliberately faint
atmospheric layers — a pattern the format guidance recommends — are not
flagged; that axis belongs to `invisible-layer`.

Also extracts the shared luma/colour helpers into `luma.ts`, since `perceive`
already imports `advise` and the dependency can only run one way.
