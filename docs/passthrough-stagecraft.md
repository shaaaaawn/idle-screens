# Passthrough Stagecraft

*Design notes on the deep passthrough savers — what we built, why it looks the
way it looks, and where it goes next. Written after the black-hole → tide →
limelight → slipstream → catwalk arc landed (July 2026).*

---

## 1. The thesis

A screensaver normally treats the screen as a dead surface: black it out, draw
something pretty on top. The passthrough savers reject that. **The page you
were just reading is the material.** Its headings, cards, links and images are
mass, geometry, boundary condition, furniture — and the saver's job is to
reveal a physics the page apparently had all along.

The emotional target is the moment a viewer realizes *their own content* is
what's bending, floating, casting shadows, or being slept on. That recognition
is worth more than any amount of particle count. Every decision below serves
it.

Three artistic laws fall out of this:

1. **The page must survive.** The content is dimmed, deformed, occluded — but
   never destroyed, never replaced, never unreadable for more than a beat.
   The saver is a weather that passes over the page, not a demolition.
2. **The physics must be believable at a glance.** Not accurate — believable.
   A damped cosine *is* a landing. A parallax offset *is* height. We buy the
   illusion with two or three honest cues and spend nothing on the rest.
3. **Restraint is the style.** Deformations live in single-digit pixels and
   fractions of a degree. The moment the page looks broken instead of alive,
   we've overdone it. (Tide's Jacobian is clamped so no block can ever mirror;
   the cat's landing dip peaks around 7px; a lean maxes at 6.5°.)

## 2. The ladder of interaction

Each deep saver was built to prove one new *kind* of coupling between the
effect and the page. In order:

| Saver | Coupling | One-line artistic spec |
| --- | --- | --- |
| **Black Hole** | A field, sampled at each block | A wandering singularity; the page's blocks lens, swirl, and are consumed rigid-body-style, then reform. Warm accretion palette over a void. |
| **Tide** | The field's **derivative** | Water rises over the page. Submerged blocks don't just move — they *shear and stretch* with the wave, because each one is handed the analytic Jacobian of the flow at its own box. Light blocks raft; heavy ones sink out of focus. Cold depth palette, caustic shafts. |
| **Limelight** | Blocks acting on **each other** | A theatre rig off-screen above. Blocks gain height, stand up with parallax and side walls, cast distance-faded shadows from an apex — and a block standing in another's shadow is dimmed by it. The pool of light is drawn first so the shadows have something to eat. Tungsten key, cold counter-light. |
| **Slipstream** | The page as **boundary condition** | Night wind. The blocks are obstacles in an analytic potential-flow field; streamlines thread between the content and part around it, and blocks lean with the *local deflected* wind, hinged at their base like grass. Moonlit silver-blue, sodium amber when steered warm. |
| **Catwalk** | An **inhabitant** | A cat lives on the page. The blocks are its furniture: they dip and ring under its landings, sag while it sits, rock while it kneads — and it rides the dip it caused. The first saver where the page has a *relationship* with something, not just a force applied to it. |

The ladder matters more than any rung. Each step changed what "interact with
the DOM" means: force → deformation → mutual occlusion → feedback loop →
companionship. The next rungs (see §5) keep climbing: inhabitants that
remember, inhabitants that respond to *you*, multiple inhabitants that respond
to each other.

## 3. The grammar we discovered

Rules that got learned the hard way and should be treated as house style for
any future passthrough work.

**Closed-form time, always.** Nothing integrates state frame-to-frame. Water
level, shadow direction, a landing's ring, the cat's entire day — all pure
functions of `(seed, t)`. This is not just the determinism proof for
`renderFrame(t, seed)`; it's an artistic constraint that forces every motion
to be *composed* rather than simulated, like animation keyed on a timeline.
Physics is faked with decaying springs evaluated from event timestamps:
`exp(-λτ)·cos(ωτ)` is our hammer and it is enough.

**Choreography compiles; the frame only evaluates.** The cat's itinerary
(which perch, when, what it does there) is compiled once at collect time into
absolute timestamps, with the last jump returning home so the loop is
seamless. Anything that looks like a decision was actually decided at mount.
This is how you get an *animal* out of pure functions.

**Identity forks; sequences never share a cursor.** Anything rebuilt after
mount (a `resize()` re-collect) must draw from `rng.fork(salt)`, never the
shared stream — or the same `t` renders differently after a viewport change.
And anything that *is* someone — the cat's eye color, coat, plumpness — forks
from its own salt (`0xface`) so the body survives every recompile. Same seed,
same cat, forever.

**Light first, then let the scene eat it.** On a dark page, "dark + darker
shadows" is invisible. Limelight's pool is an additive glow drawn *before*
the shadows so the shadows visibly carve it; the beam is drawn on its own
layer and the set's slots are punched out before compositing. Order of
operations is the picture.

**Rim light is how silhouettes exist.** A black cat on a night veil is
nothing. A 1px cool stroke (`rgba(172,196,240,~0.45)`) over every fur shape
made the difference between "faint smudge" and "cat." Same lesson at every
scale: the moonlit edge is the drawing.

**Aim at the content, not the viewport.** Real pages are columns with huge
margins. Limelight aims in content-box space (`lightX: 0.5` = middle of the
*content*); catwalk only perches on real blocks. Effects that roam viewport
coordinates spend half their life performing to an empty margin.

**Never render nothing.** Selector-poor pages (app shells, div-soup) must
degrade to something alive, not a dark veil. Catwalk falls back to structural
block harvesting, and below that to a floor patrol — the cat paces the bottom
of the screen with paw prints rather than not existing. Every passthrough
saver needs its own version of this promise.

**The page is borrowed, not owned.** Save every inline style touched, restore
every one on dispose, and only touch elements the performance actually uses.
`de-nest` before selecting victims (a parent and child must never both be
transformed), quantise filter strings so the DOM stays quiet, and write only
on change.

**Emotes are punctuation, not dialogue.** `!`, `?`, ♥, Zzz — one glyph,
pop-hold-fade over ~a second, in a palette-adjacent tint. They annotate a
behavior the body is already performing; they never carry the performance.

## 4. The cat, specifically

### Intention

The cat is not an effect. Black hole is a spectacle you watch; the cat is a
*presence you share the screen with*. The design goal was the feeling of
looking up from your desk at 11pm and noticing the cat has moved — you didn't
see it happen, but the room is different. Idle screens are mostly seen in
peripheral vision and mid-distraction; a creature with its own agenda rewards
exactly that kind of intermittent attention. You should be able to watch it
for two minutes and see a small story (arrive, look around, decide, nap), or
glance once an hour and just note where it's gotten to.

### Anatomy of the illusion

- **Silhouette + rim + whiskers + eyes.** The body is five ellipses and some
  stroked lines, and that's deliberate — a low-detail silhouette lets the
  viewer's own cat fill in the rest. The four things that cannot be cut:
  the haunch (mass reads "cat," not "blob"), the moonlight rim, the three
  whisker hairlines, and the glowing eyes with real blinks.
- **The tail is the actor.** It's a live quadratic that flicks at ~0.4Hz
  idle, races when stalking or annoyed, hooks high and happy after a landing,
  wraps when curled, twitches in dreams. If you only animate one thing on a
  creature, animate the tail.
- **Weight is a two-way contract.** The perch dips (damped cosine), *and the
  cat's y is the perch's y* — it rides the dip it caused. Either half alone
  reads as a glitch; together they read as mass.
- **Anticipation sells the jump.** Crouch → butt-wiggle → leap-stretch →
  tuck → landing squash → tail hook. The wiggle is the single highest
  cuteness-per-line feature in the codebase. Disney's principles survive
  contact with `canvas2d`.

### The behavior system

A seeded random walk over the page's perches becomes a timetable of visits,
each with an action drawn from a weighted pool: `sit`, `groom` (+ floating
hearts), `stretch`, `sleep` (Zzz, dream tail-twitches, and always the big
wake-up stretch), `knead` (the perch rocks under alternating paws), `bat`
(three timed swats that shove a *neighboring* block sideways — the one moment
the cat touches something that isn't its own perch), `pounce` (stalk low, jaw
chattering, `!`, wiggle, lunge — and the moth escapes, every time, because a
cat that catches the moth has finished its story), and `roll` (belly-up on
wide perches only, paws wiggling, perch swaying slow).

Two seeded traits make each seed a different animal: **playfulness** weights
the action pool (a placid cat naps through its loop; a playful one hunts),
and the **look** rolls coat shade, plumpness, tail length, eye color (gold /
green / copper / ice-blue, ~6% odd-eyed), and white chest-patch-and-socks
markings. The steerable params (`tint`, `catSize`, `pace`, `veil`…) modulate
*around* the identity rather than replacing it — an agent can make any cat
ginger-ish or hurried, but it's still that cat.

### Why the moth always escapes

Failure is characterization. A cat that succeeds is a turret; a cat that
misses, recovers its dignity, and sits down as if it meant to do that — that's
a cat. The same logic should govern every future behavior: the story beat is
the attempt.

## 5. Where this goes

### Near — cheap wins inside catwalk (each ~an afternoon)

- **Perch memory within a loop.** A favorite perch it returns to twice; the
  second visit gets a longer nap. Pure itinerary compilation, zero new render
  code — and viewers *will* notice ("it likes the header").
- **Weather sync.** Read the hour from the seed (or a `mood` param): dawn
  cats stretch more, midnight cats hunt more, the veil tint follows. One
  weighting table.
- **The zoomies.** A rare itinerary event (playfulness > 0.8): three jumps
  chained with no dwell, ending in an over-rotated landing and an embarrassed
  groom. Cats own this move; nobody has animated it in a screensaver.
- **Sitting *on the edge*.** Perch on a block's corner with the tail hanging
  off and swaying below the block's bounds — sells the ledge-ness of the
  furniture harder than the spring does.
- **Scratching.** Brief vertical scratch at a tall block's side face; the
  block shivers (high-frequency, tiny-amplitude spring). Pairs with a
  stretch.
- **A second emote tier.** Slow-blink at the viewer (the cat "I love you"),
  and an annoyed ear-flatten + tail-lash when a *batted* block springs back
  and bumps it.

### Mid — one design session each

- **The bird.** A second inhabitant on its own compiled itinerary, perching
  where the cat isn't. The two schedules are compiled *against* each other:
  when their perches come within range, the cat's next action re-weights
  toward stalk — and the bird always leaves two beats before arrival. Two
  actors, still 100% closed-form.
- **Presence awareness at the seams.** The saver can't react to live input
  (it *is* the idle state), but it owns its entrance and exit. On sleep: the
  cat walks *in* from the screen edge rather than materializing. On wake: a
  startle pose for 200ms as the dialog fades — the viewer catches the cat
  noticing them. Both are deterministic overlays on the loop clock.
- **A kitten mode.** `catSize` low + playfulness pinned high is almost this
  already; a true kitten wants clumsier landings (overshoot the spring,
  scramble), shorter dwells, and a failed first jump that lands it back on
  the same perch. Comedy is just retuned easing.
- **Persistent identity.** Hash the channel/user id into the seed so *your*
  site has *its* cat — same odd-eyed, sock-pawed animal every night. One
  line in the host; enormous attachment payoff. (The engine's `storage` hook
  could even let the cat's favorite perch survive across sessions.)
- **MCP verbs.** The steering surface is already typed params, but the cat
  deserves verbs, not knobs: `call_cat(x, y)` compiles a detour visit;
  `feed_cat()` schedules a contented knead+sleep. An agent talking to a cat
  through a control track is exactly the idlescreens.com story.

### Far — new rungs on the ladder

- **A shared stage.** The savers currently can't see each other. A tiny
  cross-saver contract (a `SceneContext` with "occupied rects" + "events")
  would let the cat bat at tide's bubbles or nap in limelight's pool. This is
  the biggest architectural lift and the biggest artistic unlock; it should
  be schema-versioned like everything else.
- **The page as narrative.** The itinerary compiler currently reads geometry.
  It could read *semantics*: sleep preferentially on `<pre>` blocks (warm
  laptop), stalk the favicon, bat only at buttons. Needs care — it flirts
  with gimmick — but one or two semantic jokes per loop would land hard.
- **Other inhabitants, same grammar.** The compiled-itinerary + spring-
  vocabulary + seeded-identity stack is a *creature engine*, not a cat
  engine. A koi in tide's water. A moth-swarm that limelight's beam disturbs.
  A tiny robot that dusts the blocks it walks on. Each is a manifest, a pose
  table, and a weighted action pool away.

## 6. What must never break

Whatever gets added, these are load-bearing:

1. `renderFrame(t, seed)` bit-reproduces any frame — canvas *and* page.
2. `dispose()` restores every inline style it touched. The page is borrowed.
3. Flash safety by construction: nothing strobes; brightness drifts over
   seconds. (Every saver here passes the WCAG 2.3.1 gate with zero flashing
   area — keep it that way without needing the validator to say so.)
4. Degradation is graceful *and alive*: no page may produce an empty veil.
5. Restraint. If a reviewer's first word is "whoa," check the pixel budgets;
   if it's "oh no, my page," revert.

---

*Files: `packages/saver-catwalk/` (the cat), `packages/saver-tide/`,
`packages/saver-limelight/`, `packages/saver-slipstream/`,
`packages/saver-black-hole/` (the ancestor). The authoring contract lives in
`.claude/skills/idle-screens-saver-plugin-authoring/`.*
