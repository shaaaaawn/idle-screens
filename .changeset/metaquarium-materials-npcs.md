---
'@idle-screens/saver-metaquarium': minor
---

Material-aware lighting and the unminted breeds. Eyes render unlit pure white/black (the GLBs ship them as 0.8-gray PBR that the hemisphere light dimmed); glow color follows the material — authored emissive first, the color the name spells second, seeded pick last — with selective bloom via additive normal-pushed shells, no composer; metallic atlases (glTF default metallicFactor 1.0 renders black unlit) become unlit basics wearing the same texture; NPC PrimaryColor/SecondaryColor coats are a coherent seeded two-tone. All eight unminted breeds (blowfish, hackerfish, glowfish, babyfish, shark, crab, jellyfish, dori) ship as `NPC_CATALOG` with synthetic ids — resolvable wherever a host serves the bundled GLBs, honestly "not hosted here" elsewhere.
