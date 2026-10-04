---
'@idle-screens/saver-metaquarium': minor
---

The babyfish — the babies of the metaquarium — are rigged, animated and dressed to be adorable.

- **A rig.** `breeds/rig/babyfish.py` rigs the delivered model in Blender without changing a visible voxel: head, body, two tail links and a forked fin as a soft spine (the joints blend, so it bends as one piece instead of cracking into blocks), a dorsal fin that flutters, and two eyes.
- **A baby's swim.** A quick, fluttery stroke phased by the distance swum — the tail a wave down three links, the head countering it, a bob and a squash-and-stretch twice a stroke.
- **Moments of its own** (`src/babyfish.ts`), one a cycle: a zoom (wind up, burst of flutters, stretched long), a happy wiggle with its eyes squeezed into arcs, a barrel roll, a curious peek (head tilted one way and the other, two blinks). It blinks every few seconds in between. Each eye clip moves only the eyes, so it plays over whatever the body is doing.
- **Pastel coats.** New material roles: `PASTEL-<n>` puts a band `n`% of the way between a fish's two coats, softened toward white, so the babyfish's bands run head to tail as one soft gradient; `PAINT-#rrggbb` is a fixed colour on every fish — the babyfish's stripe and mouth are butter yellow.
