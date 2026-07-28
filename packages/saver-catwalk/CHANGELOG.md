# @idle-screens/saver-catwalk

## 1.1.1

### Patch Changes

- bae7b6b: `SaverManifest.timeModel` (`'closed-form' | 'simulated'`) — a semantic claim
  about how the saver relates to time, so tooling can prefer it over hardcoded
  per-saver capability lists. Catalog savers declare theirs; the playground
  properties panel surfaces the claim.
- Updated dependencies [bae7b6b]
  - @idle-screens/core@0.4.2

## 1.1.0

### Minor Changes

- 3a10f2c: Entrance prologue: the cat walks in from off-page and settles under lamplight
  before the itinerary loop begins, so the first seconds feel like a curtain rise
  rather than a mid-loop cut. The purr-adjacent lamplight pool follows the walk-in
  so the landing perch is readable from the first frame.

### Patch Changes

- Updated dependencies [3a10f2c]
  - @idle-screens/core@0.4.1

## 1.0.0

### Minor Changes

- 072780b: New package: `@idle-screens/saver-catwalk` — a cat lives on your page.

  A silhouette cat parkours across the live page's own blocks. Every perch reacts
  like a real object: it dips and rings under the landing (a damped cosine from
  the landing timestamp — physics with no integrated state), sags while the cat
  sits, recoils when it springs off — and the cat rides the dip, because its y IS
  the perch's y. It sits, grooms, stretches, and falls asleep on the blocks it
  likes, Zzz drifting up; a pool of lamplight follows it through the night veil so
  the block it occupies is the one you can read; its eyes glow and blink in the
  dark.

  Determinism: the whole performance is compiled at collect time into a seeded
  ITINERARY — which perch, when, what it does there — with the final jump
  returning home so the loop is seamless. Cat position, pose, and every block's
  spring response are closed-form in `t`; `renderFrame(t, seed)` reproduces any
  frame, page transforms included, and a same-size `resize()` re-derives the
  identical itinerary from forked RNG streams.

  And every seed is a DIFFERENT CAT — in body and in temperament. A seeded
  look rolls the coat shade, plumpness, tail length, eye colour (gold, green,
  copper, or ice-blue — ~6% are odd-eyed), and whether it wears a white chest
  patch and sock paws. A seeded playfulness trait weights what it does at each
  stop. A playful
  cat **stalks and pounces on a moth** (which escapes, every time) and **bats a
  neighbouring block** — the swatted chip is shoved sideways and rings back, the
  one place the cat touches something that isn't its own perch. It also **kneads
  biscuits** (the perch rocks under the alternating paws), looks back over its
  shoulder mid-sit, does a butt-wiggle before every pounce and jump, walks with
  a real gait and paw prints when a page offers nothing to perch on, floats a
  heart while grooming, and blinks. It rolls belly-up on wide perches (paws
  wiggling in the air, the perch swaying slowly under it), chatters its jaw at
  the moth mid-stalk, pops a startled "!" when it spots it and a curious "?"
  during the look-around, twitches its tail in its sleep while dreaming, and
  always does the big wake-up stretch before leaving a nap. It keeps a
  FAVOURITE perch: the loop returns it home near the end — greeted with a
  heart — for the longest nap of the day. The genuinely playful ones get THE
  ZOOMIES: three flat-out jumps chained with barely a landing between them,
  recovered from with an embarrassed groom. It sometimes lands right on the end
  of a block and sits there with its tail hanging off the ledge, swinging slow;
  and mid-sit it will give you the slow-blink.

  11 typed params (`pace`, `jumpArc`, `bounce`, `veil`, `lightRadius`, `eyeGlow`,
  `tint`, …) plus a dusk-falls `demoTrack`.

### Patch Changes

- 072780b: **core:** new optional `SaverInstance.composition(): SaverLayer[]` — a mounted
  instance can describe its practical composition stack, bottom-up: the `page`
  deck a passthrough saver performs on (host-bound; the saver only borrows the
  document), the `surface`(s) it owns, and the logical draw `pass`es inside
  them. Deliberately distinct from the schema's declared sprite layers, and
  deliberately small: multi-surface savers, per-pass toggles and cross-saver
  scenes extend this model rather than replacing it.

  All four deep passthrough savers (catwalk, tide, limelight, slipstream) now
  describe their stacks. The playground's Layers panel renders the stack for
  any mounted saver — compositor-style, top deck first, with eye toggles that
  solo decks for inspection (hide the page, keep the performer; hide the
  overlay, watch the pure page deformation).

- Updated dependencies [072780b]
- Updated dependencies [072780b]
  - @idle-screens/core@0.4.0
