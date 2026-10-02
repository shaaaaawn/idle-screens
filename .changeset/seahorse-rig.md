---
'@idle-screens/saver-metaquarium': minor
---

Seahorses move like seahorses. The body wave is wrong for an upright animal, so seahorses were excluded from it and hovered completely rigid; their only clip moves the whole model.

With `swimWave` on, a seahorse now gets its own rig (`seahorse.ts`):

- **The dorsal fin** ripples: a fast wave runs up it, sideways with the rays flexing fore and aft, so it reads from any camera. It beats faster when the animal works.
- **The prehensile tail** coils forward under the body and lets go on a slow, per-fish clock. It coils harder under effort (a maneuver, a turn), bending progressively toward the tip about the tail's root.
- **The head** nods about the neck, and the whole animal rocks gently upright.

It is a vertex patch in the fish's frame, the same shape as the swim wave, so eyes and glow shells move with the body. The anatomy is quoted as fractions of the shared seahorse geometry, which all forty tokens use, and a JS mirror of the GLSL tests it. At `swimWave` 0 nothing changes.

The playground breed lab can now review motion: `/breeds.html?url=…&rig=seahorse&times=…` renders the rigged model at chosen moments, side-on, or with `&view=34` from behind; `&effort=1.9` shows a working animal.
