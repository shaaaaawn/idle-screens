---
'@idle-screens/saver-metaquarium': patch
---

Environments are distinct places now. A QA pass measured vent, universe, and kelp rendering byte-identical (0.000 pixel difference) — shared floor kind, one terrain seed, no palette. Every named environment now carries a room palette applied only where the author left fog/floor/mote colors untouched (an authored color always wins), and its own terrain seed. Light shafts are rebuilt to span the tank instead of the light source (vent's shafts sat entirely under the seabed; rayStrength 0→1 measured 0.07/255 — a dial that did nothing), fade peaking in the fish band, and are built even at strength 0 so later steering works. Terrain relief is baked as vertex-color lambert shading (flat→dunes was 2.6/255, hills nobody could see). Single-layer wedges droop their wings so the V reads in 3D.
