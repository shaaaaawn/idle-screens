---
"@idle-screens/schema": patch
---

Three more perception weights now match what the renderer paints:

- **Soft polygons weigh their gradient's ink.** The canvas fills a `soft` polygon through the same radial gradient as a soft circle, over its circumradius; a soft path drawing uses its unit circle. Both used to count as solid. A soft square now lays about 52 % of its area, and a soft unit-square drawing about 30 %. They are also clipped to the frame by that gradient, so an edge-crossing one keeps its brighter middle.
- **A label counts every glyph.** The perception text box measured at most 48 glyphs, so a longer string's box stopped short of what the canvas paints. It now spans the whole string, in the luminance maps as well as dominance and colour.
- **A path drawing is clipped by its own outlines.** Each part's fill is clipped to the frame by its fill rule, and each stroke segment by its length. Before, the clip used the drawing's frame box, so a small drawing whose frame box crossed an edge lost ink it never had.

In the shipped examples, `dev-dashboard`'s 61- and 82-glyph footer and legend labels gain weight, and `facets`' soft hexes weigh about half. Every other example is unchanged.
