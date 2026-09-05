---
'@idle-screens/saver-metaquarium': minor
---

Behaviour pack 2 — fish that know other fish, and a tank that can describe itself.

- **Relationships**: three new swim styles bond a fish to the nearest preceding unbonded fish in the mix. `follow` rides its leader's route in a file, `pair` orbits a shared point with its partner, `chase` closes on its leader and falls back, tail working hardest as it closes. Bonded fish swim in their leader's depth band, so `seaturtle:1@surface, angelfish:3@follow` is a turtle with an escort at the surface. Closed-form: a follower is the leader's own curve sampled at a lag.
- **`swimStyle: 'auto'`**: each untagged fishMix token swims the way its breed does (seahorse hover, turtle skim, angelfish school, betafish drift; the NPC set mapped too). A token's `@style` still wins; unknown breeds loop.
- **`lightSeek`** (0–1, default 0): free fish are drawn toward the room's light shafts, each to its own pool by a per-fish appetite. Staging follows the light.
- **`formationBreathe`** (0–1, default 0): the school relaxes outward and draws back on a ~15 s cycle. Only ever expands, so the no-pair-inside-a-body-length law holds.
- **Proximity startle**: free fish now flinch in a wave from a sentinel fish, delayed by ground distance (the formation wave already did this by seat). A startle no neighbour answers is not a startle.
- **`pathShape: 'crossing'`**: a camera-relative parade lane — across the frame in front, back the other way behind, laid against `cameraAzimuth` when the shape is chosen. The procession that used to be an orbit hack.
- **Tilted ring**: the `ring` formation rises and falls around the carousel, so it reads as a wheel from a side camera instead of a flat line.
- **Idle sway**: station-keeping styles (hover, drift) turn in place while holding station instead of pointing rigidly down a loop they barely travel.
- **`inspect()`**: the tank reports its frame in numbers — camera, room, cast by style, each fish's breed/style/bond/seat/position/heading and whether a maneuver is displacing it, maneuver activity, centroid and spread. The analytic perception a classic saver never had.

Every new param defaults to the previous behaviour; `loop`, the formations' spacing, and every published scene render as before.
