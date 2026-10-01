---
'@idle-screens/saver-metaquarium': minor
---

The glowfish fishes now, and the crab can go neon.

- **A rigged anglerfish.** `breeds/rig/glowfish.py` rigs the delivered model in Blender without changing a voxel: the great lower jaw, a head that flips open on its back edge, a tail, two eyes that blink, and a three-link lure with the glowing bulb on its tip. Four clips — swim, lure, chomp, blink — driven by `src/angler.ts`: the tail beats with the distance swum; once a cycle it hovers nose-down, mouth agape, and fishes, dangling and twitching the bait; on some bouts it strikes, head flung open, lunging, jaws snapping shut; it blinks on its own clock.
- **Its light lives.** The lure breathes slowly, beckons while it fishes and goes dark at the strike, then comes back — its bloom, halo and the light it throws all follow the lure as it swings (a glow part riding one bone is placed from that bone). Flash-safe by construction: never faster than 1.5 Hz.
- **More colour.** The lure and the eyes no longer have fixed colours: each fish draws its own from the glow palette.
- **Metal teeth.** A new `METAL-` role: a polished plate that takes the studio environment when lit, chrome when flat (`fishMetal: 'off'` keeps the authored colour). The glowfish's teeth wear it.
- **`fishLook: 'neon'`.** The bundled creatures in blacklight: coats near black, the dark of the eyes — and a crab's mouth — glowing a seeded neon that blooms, glow parts as they are. Best in a dark room with `finish`. `natural` (the default) is unchanged.
- **One Blender file for every rig.** `breeds/rig/common.py` is what rigs share; `build.py` puts every rig in one .blend, a scene per breed, and `export.py` ships a hand edit from it.
- A crab's claw glow sat a little off the claws (its body stands off the fish's origin, and the glow placement ignored that); it is where the claws are now.
