---
"@idle-screens/saver-metaquarium": minor
---

Choreography: an authored starfish dance on the beat. `choreography` takes a cue sheet per dancer (`a: 8:lie, 4:rise, 4:reach >right @cam | *: 4:march ~360, 4:jacks ^0.5`). Each cue is a move for some beats (fractional beats allowed), with travel (`>mark` or `>side,depth`), facing (`@deg`, `@cam`), turns (`~360`) and leaps (`^h`). Moves are the eight dance moves, partner moves danced solo, and the floor: `lie`, `curl`, `wave`, `pop`, `rise`, `sit`, `walk`, `crawl` and `hold`. Cues cross-fade into each other, a lying dancer stands only as far as its posture says, and a choreographed class faces `cameraAzimuth`, so a circling camera doesn't swing the dance round with it. The sheet is a pure function of the beat (choreo.ts), so a sheet lines up with music and a renderer can seek.
