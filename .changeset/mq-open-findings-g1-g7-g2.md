---
'@idle-screens/saver-metaquarium': minor
---

Vignettes and the frame state, from agent feedback:

- **Floor creatures stay on the floor as actors (X490).** A snail, crab, starfish or octopus cast as a vignette actor stands at its marks on the floor instead of hovering at the open stage's swim height; a snail glides between marks with its foot's wave keeping time with the walk.
- **`ink` gesture (X440).** An octopus actor squirts a cloud of ink on cue (`a ink`), reporting `doing: "ink"` in `frame.state.fish[i]`. Any other breed ignores it with a console warning and a `validateMetaquariumParams` problem.
- **A later `=mark` snaps at its beat's start (X444a)**, as `=` means "be there, no travel"; headings, paces, dodges, Dot's steps and the follow camera's trail no longer read velocity across the cut. The shipped presets are unchanged (pinned by a golden test).
- **Actors ignore maneuvers (X441):** no flurry, no kick, not counted as `maneuvering`.
- **Interior marks scale with the room (X447):** `max(crystalScale, 0.85)`, the room's own scale, so below 0.85 the marks stay on the furniture.
- **Light shafts move (X122):** each shaft breathes on its own phase and sways slowly (~0.03 rad) about its source. Shaft positions are unchanged.
- **`frame.state.camera.bearing` (X438):** where the camera stands now (cameraAzimuth turned by autoRotate, plus a shot's own swing). `azimuth` stays the param.
- **`frame.state.fish[i].shell` (X491):** the shell each snail wears as dressed.
- Guide and README: interior mark table (bearing, distance, height), `=`/`circle` semantics, house lights under `spotStrength`, starfishDance under autoRotate, geodeHomes tier cap, floraDensity's shared budget.
