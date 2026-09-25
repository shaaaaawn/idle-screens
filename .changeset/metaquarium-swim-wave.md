---
'@idle-screens/saver-metaquarium': minor
---

Swim wave: new `swimWave` param (0..1, default 0). Fish bend as they swim: a wave runs from nose to tail, beating with distance swum and working harder in a flurry, and the body curls into turns. It replaces the rigid yaw and the angelfish's whole-node clip while on; the turtle, seahorse, crab, jellyfish and skeleton-rigged fish keep their own motion. At 0 the stock programs compile and nothing changes. `inspect()` reports `waving` per fish. Shader patches now stack through a shared helper, so the eye display and the wave survive each other.
