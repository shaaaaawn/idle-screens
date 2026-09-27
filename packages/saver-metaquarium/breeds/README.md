# Breed intake

How a new creature becomes a metaquarium breed. It's the same steps every time,
whether a person or an agent runs them; the skill
`.claude/skills/metaquarium-breed-intake` drives exactly this.

**Result:** the breed ships **inside the package**. It lives in a lazy chunk
of its own (`src/breeds/<breed>.ts`), so a scene pays for it only when it
casts it. It has no IPFS pin, no host-served asset and no Draco decoder, so it
swims on every host: the wall, the Mac app and the playground.

```
breeds/
  source/<breed>.glb   the model as delivered, untouched (Draco, instancing, whatever it came with)
  breeds.json          the intake manifest: roles, kind, size, motion, notes
  intake.mjs           the pipeline (pnpm --filter @idle-screens/saver-metaquarium breeds [names…])
  <breed>.glb          the optimised result: what the lab reviews and the tests pin
  REPORT.md            the numbers the last intake produced
src/breeds/            generated: <breed>.ts (base64) + index.ts (the lazy loader map)
```

## The steps

1. **Drop the source in `breeds/source/<breed>.glb`** and add an entry to
   `breeds.json`. Add the breed to `NPC_CATALOG` in `src/ipfs.ts`, with the
   next free id above 600 and `ipfs3d: 'mq-breed:<breed>'`. Add its default
   swim style to `AUTO_STYLE_BY_BREED` in `src/swim.ts`.
2. **Audit it.** Run the intake once with no roles and read its line. It
   prints triangles before and after, draw calls (one per material), and
   **⚠ unroled** materials. Then open the playground **breed lab**
   (`/breeds.html?set=both&only=<breed>`). It shows three views in the
   authored materials and a false-colour legend of material → role →
   triangles, so you can see which part each material is.
3. **Name the roles** in `breeds.json` `roles` (source name → role). The tank
   reads names, not colours (`src/materials.ts`):

   | role | what the tank does |
   |---|---|
   | `PrimaryColor…` / `SecondaryColor…` | the seeded two-tone coat. Alternate them to keep authored bands (babyfish) |
   | `EYES-White` / `EYES-Black` | unlit sclera and pupil; `eyeLife` rigs them from their voxel grid |
   | `GLOW-<colour>` | unlit in its own colour, plus the halo shells and bloom card |
   | `KEEP-<part>` | the authored colour, kept (a screen, teeth) |
   | anything else | **a random coat**: almost never what you want |

   Also set `metal`/`roughness` if the source shipped glTF's default of
   metallic 1. Pure metal renders black in the tank's rooms (the jellyfish
   did).
4. **Choose `kind`.**
   - `voxel`: every face is on an axis-aligned voxel grid (check the lab: a
     cubic silhouette). The intake greedy-meshes it, merging coplanar faces
     of one material into rectangles.
     - It never merges along the swim axis (the longer horizontal extent),
       because the body wave bends per vertex and a face merged along the
       body would stay rigid and crack.
     - It never touches eye primitives.
     - It drops body faces lying under an eye face, because the source's
       coplanar decals z-fight.
     - The voxel pitch is measured, not assumed; the shark's source node
       carried a 1.3 scale.
   - `smooth`: anything else. Meshopt simplification to `triBudget` at
     `error`. A textured model keeps its UVs.
5. **Run the intake** and **review in the lab** (`?set=both`). The optimised
   row must be indistinguishable from the source. Every material must show a
   role, and the size must match the source.
6. **See it swim.**
   - The playground takes a `fishMix` with the breed name:
     `?saver=metaquarium&mq.fishMix=<breed>:2`.
   - For the real host path, swap the built `dist/` into an idle-server
     worktree and publish to a local channel. That proves a bundled breed
     needs nothing the host doesn't have.
7. **Record `size` and `motion`.**
   - `size` is the breed's nominal length against a minted fish (1): a shark
     is big, a babyfish small.
   - `motion` is how it should move: `wiggle` is the tank's body wave;
     `pulse` (a jellyfish's bell) and `scuttle` (a crab's legs) are
     per-breed procedural motions still to build. Rigging in Blender is the
     heavier alternative, worth it only for hand-authored motion (a scuttle
     with real leg joints).
8. **Tests** (`src/breeds.test.ts`) run on their own. They check that the
   chunk equals the reviewed GLB, that there's no Draco, that every material
   has a role, and that the breed stays under 6,000 triangles. Then commit
   `source/`, the optimised GLB, `src/breeds/`, `breeds.json` and
   `REPORT.md`, plus a changeset.

## Budgets

A minted fish is about 2.7k triangles and 4–5 draws. Aim for the same;
6,000 is the test's ceiling. Each material is a draw per fish, and a
`GLOW-` part costs its halo shells on top. Bytes matter less than triangles:
the chunks are lazy and compress about 5× on the wire.
