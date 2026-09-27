---
'@idle-screens/saver-metaquarium': minor
---

Fish come in sizes. **This changes the default look of every tank.**

Before this change:
- every model was normalised to one fish length, so a shark was the size of a babyfish;
- the only spread was a five-step cycle by cast slot (0.8 → 1.2), so every fifth fish matched.

Now a fish's length is four factors multiplied together:

- **Its breed's nominal length** (`BREED_SIZE`): shark 2.2, seaturtle 1.35, crab 0.9, dori 0.9, hackerfish 0.85, seahorse, jellyfish, glowfish and blowfish 0.8, babyfish 0.45, minted betafish and angelfish 1.
- **Its token's `*size`** in `fishMix`, for example `shark:1@patrol*1.5`. The range is 0.25–4; values outside it are clamped, and a malformed size is reported without dropping the fish.
- **Its own seeded spread**, set by the new `sizeVariance` (0–1, default 0.5, smooth). The spread is log-symmetric: 0.5 gives about ×0.76–×1.32, 1 about ×0.57–×1.74. It is independent of speed, so `swimVariance` no longer changes size.
- **`fishSize`**, a new global multiplier (0.3–3, default 1, smooth). Gliding it grows or shrinks the whole cast.

Everything that spaced fish in one fixed body length now uses the actual fish's length:

- **Formation seating:** a school spaces in its biggest member's lengths, so the no-pair-inside-a-body-length law holds at any size. A `ball` of big fish that the 57-unit water column would squash lays out as a flat sunflower disc instead.
- **Bonds:** follow and chase lags, and pair orbits.
- **Maneuver displacements.**
- **The follow camera:** `followDistance` is now in minted-fish lengths of the followed fish, and so are the eye-view threshold and the camera lift.
- **Spotlight shadows.**

`inspect()` reports each fish's `size`.
