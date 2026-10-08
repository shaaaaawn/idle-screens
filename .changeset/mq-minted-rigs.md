---
"@idle-screens/saver-metaquarium": minor
---

The minted breeds get rigs, as the other breeds have. Each breed is one model, so one rig built in Blender animates every token of it, and every token keeps its paint. Each rig is soft — every vertex's weights come from where it lies — so the skin bends and never cracks.

- **Angelfish** (all 200): a snout, head and three-bone back that curve as one, three bones along each of the dorsal and anal fins, and nine moves — nibble, curious, kiss, soar, pirouette, bow, flutter, sway, stretch.
- **Sea turtles** (all 16): a neck, a three-bone chain in each fore-flipper (a stroke runs out along the wing), hind flippers and a tail; ten moves including a barrel roll, a somersault, a wave and a face-wipe. They used to glide rigid.
- **Seahorses** (all 40): a six-bone prehensile tail that coils into a spiral, a rippling dorsal fin, a neck and snout; ten moves including a twirl, a courtship dance and a feeding strike. They used to be bent by a vertex patch.
- **Betafish** (all 256): a fan tail of three two-bone rays, a dorsal, side fins and gill covers that flare; ten moves including the full flare. Their painted eyes now look about — the pupil glides inside the white, in each token's own colours.

Every fish has a personality drawn from its slot: a temperament, a favourite move, its own tempo and rhythm, and its own way of meeting the viewer — a curious turtle stretches its neck toward you, a shy one draws its head in, a fighter betta flares at you.

Every fish in the tank, rigged or not, also moves more smoothly:

- It faces along a chord of its route rather than its instant tangent, and the default `wander` route no longer hairpins at every waypoint — fish used to spin up to 3 rad in a frame there.
- The dodge between passing fish turns the nose by its sideways share, eased, instead of flipping it ±0.5 rad.
- A rigged fish's bend and look come off compressed, front-gated inputs, so a hairpin or a viewer behind it never snaps the body or the head.
