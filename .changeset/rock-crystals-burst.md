---
'@idle-screens/saver-metaquarium': minor
---

Rocks look like the crystals burst out of them. **This changes the default look of every scene with `rockDensity` > 0**, because `rockVeins` defaults to 0.7.

What was there before:
- glowing lava rivulets running the length of each boulder, which from a low camera read as a spider's legs draped over the stone;
- a few flat three-triangle "shards" at each crown, a different species from the real crystals beside them.

What replaces them:
- **A breach in each crown.** The stone is pushed down into a pit with a lifted rim, and angular chips of the same stone lie on the rim.
- **Fractures:** a few short, dark splits, with colour only right at the breach.
- **A real crystal colony.** Each rock grows a druse crust or a stand of spires from its pit: `growCluster` shards in the same geometry variants, material, pulse, fog and halo as `propMix`, rooted inside the stone and leaned with the crown.
- **Host rocks:** a rock under a `propMix` cluster is broken open under that cluster and grows no colony of its own.
- **The arch** is crowned the same way.

The colonies are built as a second instanced crystal field driven by the same per-frame call:
- no new shader programs;
- about 7 extra draw calls;
- no floor light: they join no pools, so night floors keep their colour.

Fish clear each colony with its own clearance dome, except the arch's, which stands over the opening they swim through. More `rockVeins` means more rocks split, deeper breaches and bigger colonies. 0 is still plain stone.
