---
'@idle-screens/saver-metaquarium': minor
---

Caustics: a new `caustics` param (0..1, default 0) throws the surface's dancing net of light over the floor, rocks, plants and fish, and `causticScale` sizes the cells. The net is procedural, two layers of animated Voronoi F2−F1 edges, and averages about 1, so it moves light around rather than brightening the scene. It projects down a slightly slanted sun and softens and dims with depth below the water surface, which follows the ceiling. It is strongest on faces that look up and absent underneath, with the face normal taken from screen derivatives, so it works on every material. It modulates the lit colour, the floor's light pools included. The low tier uses one layer. Rates divide a 20-minute window, so long uptime stays exact. At 0 the stock programs compile.
