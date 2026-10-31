---
"@idle-screens/saver-metaquarium": patch
---

Dancers and floor actors stay above the floor:
- **A choreography's lean** (`/deg`) now tips the dancer about what touches the floor. Standing, that's its feet; lying, its rim. Before, it tipped about the disc's resting place, and a forward lean drove the feet a quarter of the starfish's height into the floor. A 60° flying leap nose-dived through it entirely.
- **A floor creature's gesture in a vignette** (a crab or octopus nodding or wiggling) now lifts the creature by as much as the tilt drops its edge.

Measured per frame on the lowest skinned vertex against the floor: the worst sinking fell from 97% of the starfish's height to 11% (two frames at a take-off), and the crab no longer sinks at all.
