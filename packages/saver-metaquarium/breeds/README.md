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
  rig/<breed>-model.mjs  a breed drawn in-house (the starfish): writes its source/<breed>.glb voxel by voxel
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
   | `VIVID-<n>` | a candy-bright step `n`% of the way from the fish's coat A to coat B (the ends held apart in hue, saturated, glowing a little of its own colour): bands named `VIVID-0` … `VIVID-100` head to tail wear one gradient (the babyfish) |
   | `PAINT-#rrggbb` | that colour on every fish (the babyfish's sunny-yellow stripe) |
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
| starfish | `rig/starfish.py`: the disc and its face, blinking eyes, five arms in three links (hinged underneath, so a curl closes its seams). Standing, a little person: front arms legs, side arms arms, the back arm its head | `src/starfish.ts` crawls it on the seabed the crab's way, walks some bouts upright, and dances (`starfishDance`) | crawl idle wave stand curl · rise standing walk · march jacks reach kick twist circles disco spin · partners: mambo sway lead_twirl twirl dip_lead dip_follow lift_lead lift_fly |
| babyfish | `rig/babyfish.py`: head, body, two tail links and a forked fin as a soft spine (it bends as one piece), a dorsal fin, two eyes | `src/babyfish.ts` (the tank swims it; it schools; a baby copies the moments of the baby ahead of it) · `src/burps.ts` (hiccup bubbles) | swim zoom wiggle flip peek hiccup tailchase yawn · eyes: blink wiggle_eyes peek_eyes hiccup_eyes yawn_eyes |
| dori | `rig/dori.py`: a rigid body on two pectorals that beat like wings, a dorsal that rises, a peduncle and tail for bursts, and eyes and pupils as bones of their own — the delivered model's instanced marking joined, a white face laid under each pupil so it can slide | `src/tang.ts`: the fin stroke by pace (on time and distance, so it beats while hovering), the tail when the tank makes it dart, a moment a cycle; and every frame it aims its eyes — saccades, a double take at the viewer, both eyes converging before it snaps at plankton. It never blinks (fish have no eyelids) | fly hover back burst · pick flare headstand flop · eyes: none (driven) |
| blowfish | `rig/blowfish.py`: everything on a `puff` bone, whose clip is a DIAL (its time is how puffed it is: rounder, spines standing up from half tucked); `body` above it for every other clip; mouth, fins, five spine groups; eyes and pupils as bones of their own, a white face under each pupil | `src/puffer.ts`: the puff (a breath always; a show of gulps, a hold, a burp-out or a balloon zip; a half-puffed pout) and an act a cycle; every frame its eyes — saccades, googly moments, the viewer held with wide pupils, and flirting: a wink, batted lashes, bedroom eyes, a side-eye, an eyebrow flash; eyes shut for a kiss. True puffers can close their eyes | swim hover · puff (the dial) gulp zip · spin flip kiss shimmy bounce spit yawn shy wave chomp · eyes: none (driven) |
| octopus | `rig/octopus.py` (the model ours: `rig/octopus-model.mjs`): a crown, a head and a breathing mantle, a siphon, eight four-link arms hinged underneath and blended at their joints by distance along the arm (`mergeBends: false` keeps those faces unmerged in the intake), eyes, pupils and brows as bones of their own, glowing rings split one per bone | `src/octopus.ts`: a floor creature — crawls (sometimes sidelong), jets mantle-first and parachutes down (sometimes inking: `src/ink.ts`), walks backwards on two arms; stops to look, wave, beckon, reach, peek, pounce or nap. Each bar of a pupil counter-rolled up to 80° toward level with the world every frame (an octopus's statocysts do it); lids, round-or-slit pupils, brows, eyes up on stalks; skin moods (pale, flush, camouflage, dream colours, passing clouds) | idle crawl jet drift tiptoe · wave beckon reach peek ink pounce sleep · eyes: none (driven) |

**A breed drawn in-house.** The starfish is the first we drew ourselves, in
our designer's style: whole 2-unit cubes, flat colours, the coat roles, a
`GLOW-` accent, white eyes with black pupils and a black smile.
`rig/starfish-model.mjs` writes `source/starfish.glb` the way their models
arrive (one mesh per material, every face of every cube, each face its own
vertices), so the rig and the intake treat it exactly like theirs and the
rig still never edits it; `breeds.test.ts` holds the committed source to the
generator. Change the voxel map there, rerun it, then the rig and the intake.

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
- **Eyes in their own clips** (the babyfish's blink, its happy squint, its
  peek): a clip that moves only the eyes plays at full weight over whatever
  the body is doing, because the intake drops the channels every other clip
  leaves at rest. Point every bone the same way along the body: a bone
  pointing back exports its rest rotation as q and its keys as -q, the same
  turn, and the intake would keep that channel in every clip.
- **One glow material on several moving parts** (the starfish's five tips):
  name it in `breeds.json` `splitByBone` and the intake writes one primitive
  per bone. Each is then a small light on its own part (lit in the neon look,
  its bloom on the tip it rides), all one colour (`applyNpcMaterials` draws a
  shared glow material once).
- **A posture is a clip, not a blend.** Lying down and standing up are the
  starfish's `rise` played forward or back; a cross-fade of a flat pose into
  a standing one would hang it halfway. Whatever weight the moving clip
  leaves goes to the rest clip of the posture it is in: three.js gives an
  unclaimed remainder to the bind pose.
- **Dance moves cut on the bar.** Each is a whole number of bars, a loop
  starting and ending on one shared pose (the aerobics on the standing pose
  the rise ends on, the partner clips on their dance frame); `breeds.test.ts`
  checks every join, so a routine can switch moves with no blend.
- **A floor creature's glow** pools round it like a lamp: its driver sets
  the rig's `bloom` (the starfish's is low lying down, higher standing), which
  scales its bloom cards, light and floor pool, never the parts themselves.

The tank side is a module per rigged breed (`src/crab.ts`, `src/angler.ts`, `src/starfish.ts`):
it picks which clip plays and when, and sets every action's time and weight
each frame, so the tank stays a pure function of t. `breeds.test.ts` holds
each rig's skin, clips and joint assignment.

## Budgets

A minted fish is about 2.7k triangles and 4–5 draws. Aim for the same;
6,000 is the test's ceiling. Each material is a draw per fish, and a
`GLOW-` part costs its halo shells on top. Bytes matter less than triangles:
the chunks are lazy and compress about 5× on the wire.
