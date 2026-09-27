---
'@idle-screens/saver-metaquarium': minor
---

The eight unminted creatures now swim anywhere the package runs, the wall included: shark, crab, jellyfish, dori, glowfish, babyfish, hackerfish and blowfish. Before this they only loaded in the playground, which served their models from its own folder.

**What they are now.** Each breed is bundled in its own lazy chunk (`src/breeds/<breed>.ts`), so a scene pays only for the breeds it casts. There is no IPFS pin, no host asset route and no Draco decoder to serve. `fishMix` takes them by name or id 601–608 in the default catalog; they are species, so a count is copies.

**What a new breed goes through.** They come in through a standard intake, documented in `breeds/README.md` and run by the `metaquarium-breed-intake` skill:

- **Audit** each model and review it in the new playground breed lab (`/breeds.html`).
- **Decode Draco, bake GPU instancing and node transforms, and join primitives by material.**
- **Greedy-mesh voxel models.**
  - Merging happens across the swim axis only, so the body wave can't crack a face.
  - Eye primitives are left untouched.
  - Body faces lying under an eye decal are dropped.
- **Decimate smooth ones.**
- **Rename every material to the role the tank reads.**

Results:

| breed | triangles before | after |
|---|---|---|
| shark | 28.8k | 5.7k |
| crab | 24.5k | 6.0k |
| jellyfish | 13.5k | 2.5k |
| blowfish | 9.4k | 2.3k |
| hackerfish | 7.6k | 1.3k |
| glowfish | 5.9k | 1.2k |
| dori | 3.9k | 1.7k |
| babyfish | 1.0k | 336 |

Materials the tank couldn't read before now have roles:
- **dori and hackerfish:** their materials were all `Material.00x`, which the tank painted a random patchwork.
- **anglerfish (glowfish):** its red eyes would have been repainted as black pupils; they now glow.
- **jellyfish:** it shipped fully metallic (black in dark rooms) and without normals; both are fixed.

**Also new: the `KEEP-<part>` material role.** A part named this way keeps its authored colour; the hackerfish's screen and the shark's teeth use it. Any other unrecognised name still gets a random coat.
