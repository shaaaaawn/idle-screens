---
"@idle-screens/saver-metaquarium": patch
---

Betafish break-dance, and betafish eyes that stay on their heads.

- **Dances.** Six new clips on the betafish rig — `toprock`, `footwork`, `windmill`, `headspin` (loops on a 120 bpm bar), `freeze` and `drop` — and the same six as vignette gestures (`a windmill`, `b headspin`, …). A betafish dances them with its own body (the move takes it over, its swim and moments give way); any other fish gets a whole-body version.
- **Eyes, attached.** The rig had taken each eye block (a 3×3 of cells proud of the flank) for a pectoral fin and hinged it like a door, so the eyes flapped off the head with every stroke and flared with the gill covers. The eye cells now ride the head skin under them, the gill covers sit behind the eye, and the "pectoral" bones are gone.
- **Eyes, seamless.** Each eye cell is a whole voxel; the buried side faces between cells reached the front and z-fought it into hairlines across the pupil. They now sink a hair behind the front at draw time (the model's data is untouched).
- **Eyes, alive.** `beta-eyes` read the flank wall hidden behind the eye blocks, so the pupils it glided were never seen; it now reads the blocks' visible faces.
