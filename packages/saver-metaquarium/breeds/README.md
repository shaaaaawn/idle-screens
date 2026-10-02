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
  rig/<breed>.py       a rigged breed's Blender script: source in, rig/<breed>.glb (skeleton + clips) out
  rig/common.py        what every rig script shares: load, lattice, segment, armature, pose, bake, export
  rig/build.py         every rig into one .blend (a scene per breed); rig/export.py ships a hand edit from it
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
   | `SCREEN-<part>` | a display the tank draws (`src/screen.ts`): faces, code rain, a boot spinner, in a phosphor per fish; the hackerfish's glass and face pixels |
   | `METAL-<part>` | polished metal: a reflective plate when lit, chrome when flat (`fishMetal: 'off'` makes it the authored colour, matte) |
   | anything else | **a random coat**: almost never what you want |

   Also set `metal`/`roughness` if the source shipped glTF's default of
   metallic 1. Pure metal renders black in the tank's rooms (the jellyfish
   did).
4. **Choose `kind`.**
   - `voxel`: every face is on an axis-aligned voxel grid (check the lab: a
     cubic silhouette). The intake first culls every face that a whole cube
     sits right in front of (some sources keep every face of every cube: 90%
     of the shark's 28.8k triangles were buried), then greedy-meshes it, merging coplanar faces
     of one material into rectangles.
     - It never merges along the swim axis (the longer horizontal extent),
       because the body wave bends per vertex and a face merged along the
       body would stay rigid and crack.
     - It never touches eye primitives.
     - Where two materials claim one face of one cell (the source's
       coplanar decals: eyes, a mouth, teeth on a jaw), the smaller
       material wins and the other face is dropped, eyes always; they
       would z-fight. At runtime eye, `METAL-` and `KEEP-` parts also get
       a polygon offset, so a decal on a neighbouring face never ties.
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
     `pulse` (a jellyfish's bell) is a per-breed procedural motion still to
     build; `scuttle` is the crab's, rigged in Blender (see **Rigged
     breeds** below).
8. **Tests** (`src/breeds.test.ts`) run on their own. They check that the
   chunk equals the reviewed GLB, that there's no Draco, that every material
   has a role, and that the breed stays under 6,000 triangles. Then commit
   `source/` (and `rig/` for a rigged breed), the optimised GLB,
   `src/breeds/`, `breeds.json` and `REPORT.md`, plus a changeset.

## Rigged breeds

Hand-authored motion (legs with real joints, a claw that opens) is a
skeleton and clips made in Blender:

| breed | rig | driver | clips |
|---|---|---|---|
| crab | `rig/crab.py`: 23 parts, legs placed by two-bone IK | `src/crab.ts` walks it on the seabed | walk idle pinch forage wave cheer |
| glowfish | `rig/glowfish.py`: jaw, flip-top head, tail, blinking eyes, three-link lure | `src/angler.ts` (the tank swims it) | swim lure chomp blink |
| hackerfish | `rig/hackerfish.py`: the box, its screen, paddle fins, tail | `src/hacker.ts`; its face a display, `src/screen.ts` | swim type glitch |
| shark | `rig/shark.py` (cut by position — its fins sit off the lattice): head, jaw ringed with metal teeth, rolling eyes, pectorals, three-link tail | `src/shark.ts` (the tank swims it; it patrols) | swim bite |

A breed's script imports `source/<breed>.glb`, rigs it, bakes its clips and
writes `rig/<breed>.glb`, which `breeds.json` names as the intake's source
(the delivered model stays as `delivered`). The shared machinery is
`rig/common.py`; a script is only anatomy (which bone a voxel belongs to,
where the bones sit) and clips (functions of seconds).

```
blender -b -P breeds/rig/glowfish.py                       # one rig (from packages/saver-metaquarium)
blender -b -P breeds/rig/build.py -- /path/breeds.blend    # every rig, and one .blend to open
pnpm --filter @idle-screens/saver-metaquarium breeds glowfish
```

**Editing by hand.** `build.py` writes a .blend with a scene per breed: its
rig, its clips as `<breed>:<clip>` actions on muted NLA tracks, a camera and
lights. Edit a clip there, then ship it with `rig/export.py` (from the
Scripting tab with that scene open, or `blender file.blend -b -P
breeds/rig/export.py -- <breed>`) and run the intake. The scripts stay the
source of truth: port the edit into `<breed>.py`, or the next `build.py`
overwrites it.

The rules a rig keeps, so the intake and the tank can trust it:

- **The model is never edited.** Vertices, materials and colours are the
  delivered ones; the rig only says which part each face belongs to. The bind
  pose is the delivered model.
- **Rigid parts, or a soft spine.** Every face is weighted 1.0 to exactly one
  bone, chosen by the voxel it skins, except where a spine bends: the shark's
  body vertices blend between neighbouring spine bones across a few voxels
  (`spine_weights` in `rig/shark.py`), so the bite and the swim bend one body
  instead of cracking it into pieces. Jaw, teeth, eyes and fins stay rigid.
  The intake greedy-meshes each rigid part on its own (so a merged rectangle
  never spans two parts that move apart; every axis merges), merges blended
  faces only across the body (never along the axis it bends on), culls a
  blended face against its dominant bone, and keeps `JOINTS_0`/`WEIGHTS_0`.
- **Pivots on voxel boundaries**, so a joint opens the smallest seam.
- **Clips are named actions** (`<breed>:<clip>`, one NLA track each),
  exported sampled; a loop's last key is its first. The intake drops channels
  a clip never moves and resamples the rest. A blink is SCALE keys on the eye
  bones only, so it layers over any other clip.
- **Facts the tank needs ride as extras** on the armature node: the crab's
  `mqStride` is the body's travel per walk cycle, so the tank sets the gait's
  phase from distance and the feet never slide.

- **Glow parts that ride one bone** (a lure) have their bloom card and light
  placed from that bone each frame (`materials.ts` `partBone`); a rig's driver
  can set a light level per glow material (the lure breathes, beckons and goes
  dark at the strike). Flash-safe: no faster than 1.5 Hz, tested.
- **Never put `eye` in a glow role's name**: `isEyes()` would make it a
  black-and-white eye display. The glowfish's glowing eyes are `GLOW-Orbs`.

The tank side is a module per rigged breed (`src/crab.ts`, `src/angler.ts`):
it picks which clip plays and when, and sets every action's time and weight
each frame, so the tank stays a pure function of t. `breeds.test.ts` holds
each rig's skin, clips and joint assignment.

## Budgets

A minted fish is about 2.7k triangles and 4–5 draws. Aim for the same;
6,000 is the test's ceiling. Each material is a draw per fish, and a
`GLOW-` part costs its halo shells on top. Bytes matter less than triangles:
the chunks are lazy and compress about 5× on the wire.
