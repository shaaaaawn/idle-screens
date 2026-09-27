---
name: metaquarium-breed-intake
description: |
  Bring a new creature model (GLB) into the metaquarium as a bundled breed:
  audit it, name its material roles, optimise it (greedy-mesh voxel models,
  decimate smooth ones, strip Draco, bake instancing), review it in the
  playground breed lab, bundle it as a lazy chunk and prove it swims on a
  host. Use when adding, re-optimising or debugging a metaquarium breed or
  NPC model (shark, crab, jellyfish…), when a fish renders as a random
  patchwork or black, or when a model is too heavy for the tank.
---

# Metaquarium breed intake

The process is `packages/saver-metaquarium/breeds/README.md`. **Read it first;
this skill is the running order and the judgement calls, not a second copy.**

## Running order

1. **Worktree.** Use a fresh branch from `develop` in the scratchpad.
   Run `pnpm install`, then build `./packages/**` **inside** it: typecheck
   needs the sibling packages' `dist`.
2. **Source in**: `breeds/source/<breed>.glb`. Add a `breeds.json` entry,
   an `NPC_CATALOG` row (next id above 600, `ipfs3d: 'mq-breed:<breed>'`)
   and an `AUTO_STYLE_BY_BREED` row.
3. **Audit.** Run `pnpm --filter @idle-screens/saver-metaquarium breeds <breed>`.
   Read the line: triangles in → out, draws, and **⚠ unroled**.
4. **Look.** Start the worktree's playground on a free port (never :5177) and
   screenshot `/breeds.html?set=both&only=<breed>`. The page sets
   `body[data-ready]` when drawn. The false-colour legend says which
   material is which part.
5. **Roles.** Write `breeds.json` `roles` from what you SAW:
   - the coat is `PrimaryColor`/`SecondaryColor` (alternate them for bands);
   - eyes are `EYES-White`/`EYES-Black`;
   - light is `GLOW-<colour>`;
   - an authored colour that IS the look is `KEEP-<part>`.
   
   Set `metal: 0` on a model that shipped metallic 1. Re-run and re-look
   until there are no ⚠ and the optimised row matches the source.
6. **Kind.** `voxel` if the lab shows a cubic silhouette and the intake's
   triangle cut is large. `smooth` (with a `triBudget`) if faces are off-axis
   or the model is UV-textured.
7. **Prove it on a host.**
   - Build the package and swap its `dist/` into an idle-server worktree's
     `node_modules`.
   - Run `npm run build:site`, then serve on `:8788`.
   - Publish a scene casting the breed to a LOCAL channel, and film it.
   - A bundled breed must swim with no decoder and no asset route.
8. **Record** `size` (nominal length against a minted fish) and `motion`
   (`wiggle` / `pulse` / `scuttle`) in `breeds.json`, with a `notes` line
   saying what the audit found.
9. **Gate.** Run the metaquarium vitest (the `breeds.test.ts` drift guard
   included), then preflight through a fake mono pointed at the worktree.
   Open a PR to `develop` with the `REPORT.md` table and a lab screenshot.

## Judgement calls that cost time to learn

- **A model is its whole scene graph, not its first mesh.** Bake instancing
  (`EXT_mesh_gpu_instancing`) and node transforms before touching geometry.
  Give every node its own mesh copy BEFORE baking any of them; a shared mesh
  baked per node accumulates every instance's offset (dori came out 602
  units tall).
- **Measure the voxel pitch; never assume 2.** A scaled source node moves
  it, and the greedy mesher silently merges nothing.
- **Draco-decoded positions are noisy** (2.9985 for 3). Anything keyed on
  a coordinate must snap to the grid first.
- **Never merge faces along the swim axis.** The body wave bends per vertex.
  Across it, merge freely: every vertex keeps its grid position along the
  body, so no crack opens.
- **Leave eyes as authored.** `eyeLife` reads their voxel cells. If the body
  sits coplanar under an eye decal, the body loses (the crab's mouth).
- **Don't quantize** (`KHR_mesh_quantization`). It moves positions into a
  normalised space that the wave, the nose detection and the eye grid all
  read raw.
- **Bones are rarely the answer here.** The tank animates fish procedurally.
  Reach for Blender (the user runs its MCP on request) only for motion the
  wave can't fake: legs, tentacles with joints.
