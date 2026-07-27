# Artist Workshop — July 2026 (Batch 1)

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
