---
"@idle-screens/saver-metaquarium": minor
---

Minted fish no longer come from IPFS. Every token of a minted breed is the same model and differs only in its paint, measured over all 512. So the package now bundles four models, one per breed, plus a paint table: each token's materials, and which part of the model wears which. A fish is rebuilt exactly as its original GLB was, verified triangle for triangle against the originals, with the same names, colours, glow, eyes and metal.

- **Angelfish, seahorses and sea turtles** need no network at all. Each breed's model is one lazy chunk shared by every token (88–125 KB), and they draw about half the triangles the originals did.
- **Betafish** keep their own texture atlas. A 256² WebP of about 15 KB rides in the package, and a 512² copy from `assets.idlescreens.com` swaps in when that host answers. The originals were 2048² JPEGs: up to 1.1 MB to download and about 22 MB of GPU memory per fish.

Scenes and presets that name a minted fish by its IPFS URL take the new path unchanged. If the bundled path fails, the tank falls back to the original model.
