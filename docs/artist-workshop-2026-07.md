# Artist Workshop — July 2026

## Batch 2 (five classics, zero registry churn)

*Second run of the outsourcing protocol, applying every batch-1 lesson:
visual acceptance sentences in each brief, file-scoped tests during the
batch, a shared screenshot script handed to agents, pre-computed
stale-expectation hit lists.*

### Batch design (decided before launch)

**The audit was wrong, and grep-first caught it.** P6 said "merge
rainstorm + hard-rain — they differ only by intensity." They don't:
Rainstorm is parallax rain streaks with lightning; Hard Rain is the After
Dark original of *colored ripple rings* expanding on a dark desktop —
different savers in kind. The consolidation test (§2.4 of the skill)
requires same-kind, so the merge dissolved into two independent
modernizations. Consequence: **no registry owner needed at all** — all
five agents are strictly in-place (one saver file + one new test file
each), the cleanest collision surface a batch can have. Lesson candidate:
an audit priority is a hypothesis; the pre-flight grep-and-read is where
it becomes a plan.

**Slots:** rainstorm (full kit: intensity/wind/lightning/splash) ·
hard-rain (full kit + luminous-ripple rendering) · spotlight (params +
victim litness — our oldest passthrough finally touches what it lights) ·
bouncing-ball (canvas port, squash & stretch, floor shadow) · bsod
(attribution gap — it had NO attribution block while quoting Windows
crash text — plus three fictional screens and deterministic cycling; stays
DOM by design).

**Kept at the curator's desk:** the catwalk entrance + purr. The cat is
the flagship and the entrance is pure taste — the skill says never
outsource taste.

**Pre-computed stale-expectation hits** (in briefs as flag-don't-fix):
- capabilities.spec ~57: bouncing-ball 'ok' on CSS-only minimal device →
  flips to 'blocked' with minBackend canvas2d (curator re-points the
  assertion to a surviving css+idle saver, likely bsod).
- perception.spec CSS_SAVERS: loses 'bouncing-ball' (curator decides
  DETERMINISTIC_IMPERATIVE membership for it and spotlight).
- playground-ui.spec ~934/~953: use hard-rain as "classic saver with NO
  demo track" (timeline live-mode) — flips when the curator registers
  hardRainDemoTrack; re-point to a still-trackless classic (mystify).
- worker.spec WORKER_SAVERS + idle-worker.ts: bouncing-ball additions are
  curator-only integration.
- The 'rain' search-filter counts (gallery 3 / palette 3) survive — the
  merge that would have broken them didn't happen.

### Curator desk work (parallel to the batch)

The catwalk entrance + purr, kept in-house: a one-time prologue before the
loop clock (`tg < entrance.dur`) — the cat walks in from the nearest screen
edge (paw prints trailing), gathers with a 620ms crouch (the butt-wiggle
pose, reused), and its first leap's arc ends at the exact point and instant
of the loop's first landing, so the ordinary perch spring rings on arrival.
The stage is held at rest during the prologue (`applyPage(0, calm)`), and
reduced-motion stills park just after the arrival so a paused audience never
sees the empty stage. The purr: while the cat kneads (~1.2Hz) or sleeps
(~0.45Hz swell) the lamplight pool's warm tint breathes — ±5% radius,
0.06–0.14 alpha, enveloped in/out inside the dwell. All closed-form in the
loop clock. 16/16 package tests (2 new: entrance choreography + pool
breathing via a gradient-stop spy), tsc clean, verified live: t≈1.1s shows
only lamplight at the floor, t≈2.6s the cat mid-first-perch landing.

### Results

| P | agent verdict | curator gate | notes |
| --- | --- | --- | --- |
| hard-rain | ✅ self-verified (9/9 file-scoped, tsc 0, 2 screenshots) | *(pending gate)* | Radial-gradient annuli (bright leading edge, soft interior) + optional additive halo; smoothstep fade-in and a pop flourish before the 89% cutoff. Original grid + 8 colours verbatim as `palette:'classic'`. Identity from `fork(dropIndex)` / position-keyed density gates — resize-rebuild proven identical by test. Correctly flagged the playground-ui live-mode tests. Diagnosed a brief bug: the prescribed vitest command resolves root to the package so include globs miss — needs repo-root invocation. |
| bsod | ✅ self-verified (20/20, tsc 0, eslint 0, all 5 screens screenshotted) | *(pending gate)* | Attribution block added (parody/homage, no third-party assets); win31/win98 text paraphrased from near-verbatim lifts, period voice kept. Discovered the deck was bigger than the audit knew (win10/panic/amiga existed) and REPLACED the trademark-flavored three with fictional screens: `basalt` kernel panic, MERIDIAN "SYSTEM MEDITATION ERROR" (0.5Hz soft pulse), LUMEN sad-face with deterministic progress ticks. Pure `screenIndexAtTime(t)` cycling, seeded shuffle drawn once at mount, both orderings precomputed so param flips never redraw from rng. Correctly skipped the demo track and said why. Flagged its replace-vs-append inference — right call, accepted. |

| rainstorm | ✅ self-verified (13/13, tsc 0, 4 track-pinned screenshots) | *(pending gate)* | Fixed drop pool sized to the storm ceiling with `fork(depth·1e5+i)` identity; intensity gates by per-drop `visRank` (never array size) so purity survives the density knob. Lightning 220ms ramp, one pulse/period, `lightningEvery=0` off-switch tested. Splash as a pure proximity envelope on near-layer drops. Wrote its own track-pinning screenshot variant to prove drizzle vs storm — unprompted, good instinct. Flagged the audit doc's stale merge plan (curator reconciles). Hit the same vitest-root quirk. |

| bouncing-ball | ✅ self-verified (9/9, tsc 0 in own file, bounce-instant screenshots) | *(pending gate)* | Canvas port preserving the 3.4s/3.0s triangle waves; signed vertex-proximity squash with cross-axis volume bulge; found black-shadow-on-black composites to invisible → graphite grey. Computed the exact bounce instant analytically to screenshot compression (t−64ms) and stretch (t+36ms). Flagged all three pre-computed stale expectations verbatim + a latent no-op in the dvd.test.ts log-reset pattern (rebinding vs mutating — curator queue). |

*(spotlight pending)*

### Mid-batch curator interventions (owner-directed + gate prep)

- **The real DVD logo is back, by owner decision.** Batch 1's "generic marks
  only" rule was overturned: the owner wants the classic mark, and the legal
  posture is trademark (not copyright) — drawn from scratch, nostalgic-meme
  homage, no asset, no implied affiliation. `drawDvd` now renders the heavy
  italic letters over the disc ellipse with its centre hole; the demo track
  gives the DVD mark 10 of 16 seconds; manifest attribution + CREDITS row
  state the DVD FLLC trademark note explicitly. Verified live (mint-green
  glowing logo mid-glide), 5/5 tests after adding `ellipse` to the dvd test
  stub (the known happy-dom gap — my edit, the file had no active owner).
- **bsod "only shows one screen" report — verified false alarm:** live shots
  at t≈3s (basalt panic) and t≈14s (win98 + scanlines) prove the 10s-dwell
  cycle advances; the seeded order just fronts the panic screen. The stray
  "PRESS ANY KEY" seen over the gallery mid-batch was the agent's mid-edit
  DOM passing through the live dev server — the landed version is contained
  (DOM probe of the plain gallery finds nothing).

### Outcome: batch REVERTED by owner decision (same day)

The owner hit live glitches mid-batch and ordered a full revert of the five
saver rewrites, keeping only the credits/attribution work. Executed: the five
`savers-classic` sources restored to HEAD, the five new test files deleted,
bsod's attribution block re-added to the reverted file, the parody note added
to its CREDITS row. Kept: CREDITS.md, all attribution blocks, the dvd
real-logo restore (separately owner-ordered), and the catwalk entrance+purr
(curator desk work, tested green, offered for revert too). Gate after revert:
156/156 unit tests, repo typecheck clean, original hard-rain confirmed live.
The spotlight agent died mid-edit with the session process — its file was
restored to HEAD sight-unseen.

### Self-critique

The revert isn't a protocol failure to gloss — it's the loudest lesson yet:
**never point the shared dev server the OWNER is watching at a five-agent
live edit.** The dev server aliases packages to src, so every partial save
hot-reloaded into the owner's browser: transient type errors, half-written
renderers, HMR wedges. The owner experienced the batch as "glitches" and
lost confidence in work that was individually green. Batch 3 rule: agents
verify against a THROWAWAY server/port (or the curator snapshots on their
behalf); the owner-facing server only ever runs gated code. Second lesson:
agent work product survives in git history/reports even when reverted — the
briefs, tests, and reports are reusable if any of these modernizations is
re-ordered later. Third: the brief's file-scoped vitest command was wrong
(root-relative include globs); two agents burned tokens rediscovering it —
verify the verification commands themselves before briefing.

---

# Batch 1

*The first test of the `screensaver-artist` skill's outsourcing protocol:
five Sonnet agents executing P1–P5 from
[catalog-audit-2026-07.md](catalog-audit-2026-07.md), overseen by the
curator. This document is the Karpathy loop: briefs → results → gates →
self-critique → lessons folded back into the skill.*

## The batch design (decided before launch)

**Priorities executed:** P1 dvd+logo consolidation · P2 warp · P3 globe ·
P4 fade-out · P5 flurry.

**Collision plan.** One registry owner (P1) touches `index.ts`,
`savers.test.ts`, e2e ids/counts, worker registry. P2–P5 are strictly
in-place single-file rewrites + own test files. Demo tracks are *exported*
by agents but *registered* by the curator afterward — `timeline-profiles.ts`
is a five-way merge hotspot and no agent may touch it. Same for CREDITS.md
and changesets.

**A survival-driven design reversal worth recording:** the audit initially
said "retire the `dvd` id, keep `logo`." Grepping first showed `dvd` is the
click-target in a dozen playground-ui e2e tests owned by another active
session — so the *id* `dvd` survives and `logo` retires, purely to keep the
blast radius inside the batch. Identity decisions must follow the reference
graph, not aesthetics.

**Brief anatomy** (every agent got): artistic intent + what must NOT change
(motion signatures preserved closed-form; no trademarked marks) · the full
kit checklist · house laws (seeded forks, closed-form t, dpr cap, flash
budgets) · explicit file ownership with a DO-NOT-TOUCH list by name ·
self-verification commands with "report the verbatim tails" · exact export
naming contracts so integration is mechanical.

## Results

*(filled in as agents land)*

| P | agent verdict | curator gate | notes |
| --- | --- | --- | --- |
| P1 dvd+logo | ✅ self-verified (124/124, tsc 0) | ✅ accepted | Zero-RNG design: hue steps from analytic wall-hit counts, corner burst from simultaneous-bounce proximity, seed as phase offset. Preserved dvd's 144/120 px/s diagonal; documented logo's 5000/6300ms ratio as the reference. Correctly FLAGGED (not touched) two out-of-scope stale lists: perception.spec `CSS_SAVERS` still contains 'dvd', determinism.spec `SAVER_IDS` still contains 'logo' → curator queue. Discovered lifecycle stub lacks `quadraticCurveTo` → drew marks with arc+lineTo. |
| P2 warp | ✅ self-verified (136/136 pkg, 573/573 repo, tsc 0) | ✅ accepted | Tuned BASE_RATE so spawn-to-recycle matches the old 60fps decrement feel; kept 520 stars. Pop-in fixed with a smoothstep envelope continuous through the wrap (both ends meet at 0 — respawn invisible). Caught its own culling bug (head-only edge check vanished long streaks early). Verified the DEMO_TRACKS fallback path independently. |
| P3 globe | ✅ self-verified (136/136, tsc 0, eslint 0) | ✅ accepted | Preserved 0.9 rad/s spin, 90 px/s bounce, 21/11 lattice as defaults. Real anti-aliasing fix: dot-scatter → polyline strokes at `0.85/dpr` line width + back-hemisphere depth fade + additive limb glow. Attribution carried verbatim. Seeded path drawn once, never reconsumed. |
| P4 fade-out | ✅ self-verified (138/138, tsc 0) | ✅ accepted | Preserved the 40s leg; loop = 80s round trip, both numbers documented. Row/col-salted forks so resize never re-rolls a surviving cell. Did a real flash-safety bound calc (~0.1% cells crossing/frame at speed 3). Flagged perception.spec `CSS_SAVERS` staleness for fade-out — same class of gap P1 found for dvd. |
| P5 flurry | ✅ self-verified; revision ✅ (139/139) | ✅ accepted after 1 revision + curator luminosity tune | Converted rect-fade trail (accumulated pixels, unseekable) to 14 analytic look-back particles/arm. Kept 5 arms, additive glow, harmonic wander octaves. Caught its own `renderStill` anchor-time bug in a self-review pass. Noted OTHER agents' mid-run test failures while running package-wide vitest — see critique. |

## Curator integration pass

Done by the curator, exactly as reserved: re-exported all five demo tracks
from the package index and registered them in `DEMO_TRACKS`; cleared the
stale capability lists both agents flagged (`perception.spec` CSS_SAVERS
lost `dvd`/`fade-out`/`logo`, gained dvd+fade-out in DETERMINISTIC;
`determinism.spec` dropped `logo`) plus one they couldn't know about
(`perception.spec` asserted globe's motion is null *because* it used to be
sample-only — modernizing a saver flips test expectations that encode its
old capabilities); merged CREDITS rows; wrote the batch changeset.

Gates: build ✓, typecheck 0, lint 0 errors, 573 unit tests, savers/worker/
determinism/perception/stage e2e all green.

**Editor's visual sweep (the non-delegable part):** dvd ✓ (handsome rounded
wordmark, hue-stepping, glow), warp ✓ (streaks, no pop-in), globe ✓ (clean
polyline lattice, limb glow), fade-out ✓ (slate mosaic mid-dissolve, no
banging). **flurry ✗ — REJECTED on first look:** all gates green, but the
screen showed five isolated comet-heads, not weaving ribbons. The analytic
trail was too short/sparse to read as an arm. Sent back with the failing
frame described and concrete revision targets (trail span ~20-35% of
diagonal, overlapping samples, head-to-tail taper). This rejection is the
protocol working: tests cannot see identity.

## Self-critique (curator's own performance)

**What worked:**
- File-disjoint batch design held: zero merge conflicts across 5 parallel
  agents; the single-registry-owner rule did its job.
- "Report verbatim verification tails" produced honest, checkable reports.
- Naming contracts made integration mechanical (one import line, one map).
- Two agents independently FLAGGED out-of-scope staleness instead of fixing
  it — the DO-NOT-TOUCH list taught restraint, not blindness.

**What I got wrong:**
1. **I told every agent to run the package-wide test suite while four other
   agents were editing the same package.** They all saw each other's
   mid-edit failures and had to reason around the noise (each report
   contains a paragraph explaining away cross-agent flakes). Next batch:
   file-scoped vitest during the batch, package-wide only at the curator
   gate.
2. **My briefs specified engineering acceptance but no VISUAL acceptance
   criterion.** Flurry met every written requirement and still failed
   review. The brief should have said "at defaults the arm must read as a
   continuous ribbon covering ~a quarter of the screen" — a sentence that
   was in my head and not on paper. Taste must be written down or it isn't
   a brief.
3. **I didn't hand agents a screenshot loop.** They verified with unit tests
   and stubs only; not one looked at pixels. The house has headless capture
   scripts — the brief should include one and require a self-screenshot
   before reporting done.
4. **Stale-expectation sweep should be pre-computed.** Both agents burned
   tokens rediscovering that capability lists exist. The curator should
   grep for the saver id across e2e expectation lists BEFORE briefing and
   put the hit list in the brief ('these files will go stale; flag, don't fix').

**The flurry revision round-trip, in full:** the agent's fix was structurally
right (connected stroked segments, diagonal-fraction trail span, taper) and
it found a real rendering bug on its own — round line-caps double-blend
under additive 'lighter' compositing at every joint, producing beading; butt
caps fix it. It also verified with live pixels this time, unprompted proof
that the screenshot-requirement lesson is correct. The revision came back
READABLE but not LUMINOUS — a two-constant brightness issue. Decision point:
third loop vs curator tune. Chose the direct tune (halo reach, head alpha,
core lightness) as proportionate for a taste-critical constant tweak, and
note the boundary: structure gets sent back, seasoning gets tuned at the
desk. 139/139 after.

**Cost:** ~990k subagent tokens for five savers + one revision cycle.
Briefing quality is the lever: the whole revision was brief-debt.

## Lessons folded into the skill

(applied to `.claude/skills/screensaver-artist/SKILL.md` same day)
- Brief must include a visual acceptance sentence per saver + a screenshot
  self-check requirement.
- During a parallel batch, agents test file-scoped; package-wide belongs to
  the curator gate.
- Pre-compute the stale-expectation hit list (grep e2e capability lists for
  the saver id) and include it in the brief.
