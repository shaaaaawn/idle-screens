---
'@idle-screens/schema': patch
---

Grid layers are exempt from viewport count scaling. Scaling a grid's count
doesn't thin it like a scatter field — it truncates the lattice row-major, so
on sub-reference viewports an 18-column single-row grid rendered only 12 cells
and stopped at two-thirds width while the analytic perception path showed it
full-width. Grids now always build their authored count in both directions
(no truncated rows on small viewports, no phantom cells on large ones).
