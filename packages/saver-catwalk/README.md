# @idle-screens/saver-catwalk

Passthrough cat screensaver for idle-screens: a silhouette cat parkours across the live page's own blocks. Seeded itinerary, paramSpace, control-track, frame-addressable.

The page's content is the cat's furniture. It jumps between blocks, and every
perch reacts like a real object — dips and rings under the landing, sags while
the cat sits, recoils when it springs off — and the cat rides the dip. It sits,
grooms, stretches, and falls asleep on the blocks it likes (Zzz included). A
pool of light follows it through the night veil, so the block it occupies is
the one you can read.

The whole performance is compiled at collect time into a seeded **itinerary**
(which perch, when, what it does there), so the cat's position, its pose, and
every block's spring response are closed-form in `t` — `renderFrame(t, seed)`
reproduces any frame exactly, page transforms included.

See the [idle-screens repository](https://github.com/shaaaaawn/idle-screens) for full documentation.
