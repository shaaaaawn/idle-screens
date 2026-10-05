---
"@idle-screens/saver-metaquarium": patch
---

For agents — `validateMetaquariumParams` now also reports params that would silently do nothing: `fishCount`/`fishUrl` beside a non-empty `fishMix` (which sets the cast), a mix over the 24-fish cap, a `cameraFollow`/`followSpot`/`spotRig` slot or vignette actor past the end of the cast, `starfishDance` with no starfish in the mix, and dials on something switched off (`danceTempo`, `followDistance`/`followAngle`, orbit params while following, spot params with no spot, `shoalKind`/`shoalSpeed` with no shoal, `floraMix`/`floraPalette`/`floraLayout` with no plants). Each problem names the other params it is about in a new optional `also` field. Two recipes cast the bundled characters: `reef-characters` (tangs, blowfish, an octopus and a crab on a reef) and `starfish-class` (an aerobics class on an ice floor). The manifest description now says what the tank is rather than how it was first built.
