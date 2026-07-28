---
'@idle-screens/schema': minor
---

Persistence-aware perception: `luminanceGrid` (and everything built on it —
braille/density maps, coverage, meanLuminance, centroid, transects,
`diffScenes`, `perceiveScene`) now models `ghosting` and `trail` analytically
instead of ignoring them. Ghosting splats decayed past frames (ink from m
frames ago at weight g^m, mirroring the renderer's bounded warm-up replay);
trails mirror `drawTrail`'s past-position sampling with decaying alpha and
shrinking radius. A spec at `ghosting: 0.9` no longer perceives identically to
`ghosting: 0` — the smear agents are told to reach for is finally measurable
without a renderer. Specs without persistence produce byte-identical grids to
before.
