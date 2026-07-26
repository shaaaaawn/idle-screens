---
'@idle-screens/saver-catwalk': minor
---

New package: `@idle-screens/saver-catwalk` — a cat lives on your page.

A silhouette cat parkours across the live page's own blocks. Every perch reacts
like a real object: it dips and rings under the landing (a damped cosine from
the landing timestamp — physics with no integrated state), sags while the cat
sits, recoils when it springs off — and the cat rides the dip, because its y IS
the perch's y. It sits, grooms, stretches, and falls asleep on the blocks it
likes, Zzz drifting up; a pool of lamplight follows it through the night veil so
the block it occupies is the one you can read; its eyes glow and blink in the
dark.

Determinism: the whole performance is compiled at collect time into a seeded
ITINERARY — which perch, when, what it does there — with the final jump
returning home so the loop is seamless. Cat position, pose, and every block's
spring response are closed-form in `t`; `renderFrame(t, seed)` reproduces any
frame, page transforms included, and a same-size `resize()` re-derives the
identical itinerary from forked RNG streams.

11 typed params (`pace`, `jumpArc`, `bounce`, `veil`, `lightRadius`, `eyeGlow`,
`tint`, …) plus a dusk-falls `demoTrack`.
