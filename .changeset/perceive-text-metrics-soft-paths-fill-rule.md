---
"@idle-screens/schema": patch
---

Three more places where perception now measures what the renderer paints:

- **One text width model.** The perception text box used a flat 0.62 em per glyph. The advisories used the glyph-metrics table but ignored the font. Both now use the same table, chosen by the label's font, as textBlock line breaking does: proportional faces by character class, and monospace faces by their advance. Thirty narrow "i"s at 40 px now measure 420 px proportional and 720 px monospace, where both used to read 745 px. A monospace label running off the edge is now flagged `text-off-screen`.
- **Soft path drawings in the luminance maps.** The canvas paints a `soft` single-path drawing through a radial gradient over its unit circle, but the luminance grid painted it solid. It now lights a unit square at about 30 % of its solid ink. A path with its own `gradient` still paints only that gradient, as the renderer does.
- **Fill rules in ink areas.** A fill's area now counts what its rule paints, in dominance, scene colour, describe's area and the colour and luma part weights. An even-odd hole is empty, an overlap counts once, and a self-crossing star's centre counts once. Before, a nested square drawn the same way round counted 1.25× its outer square under either rule (now 0.75 even-odd, 1.0 nonzero). Outlines wound 0 or 1 everywhere keep their exact shoelace area, including holes the default `auto` rule winds against their container.

Among the shipped examples, only the six with text move: their labels are re-measured. No advisory, pattern-hazard verdict or top layer changes.
