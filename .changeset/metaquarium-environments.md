---
'@idle-screens/saver-metaquarium': minor
---

Environments — the tank as a room. An `environment` param names a place (`void` is exactly the pre-environment scene, so the default changes nothing) and builds it from three tier-budgeted layers: a rippling water ceiling that makes the scene read as *under* something, procedural terrain (`dunes`/`ridges`/`basin`, generated from the mount seed — no assets, no network), and volumetric light shafts that can come from below. Overrides: `floorKind`, `waterY`, `rayStrength` (-1 = follow the environment). Everything is closed-form in `t`, so `renderFrame(t, seed)` stays frame-addressable; the room rebuilds only when its inputs change, and a weak device drops the shafts before the ceiling.
