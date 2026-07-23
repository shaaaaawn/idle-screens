# AVAL (pixel-point/aval) — Findings & What We Took From It

Reviewed July 2026. AVAL: https://github.com/pixel-point/aval — an open format +
web runtime for **stateful prerendered video** (a Lottie/GIF/`<video>`
alternative for UI micro-animations), from Pixel Point (Alex Barashkov), MIT,
"technical preview," built largely with Codex. 651★ in its first 48 hours.

## What it is (one paragraph)

Author a declarative `motion.json`: video frame ranges become **units**
(one-shot / loop / finite), units map to **states**, states connect via
**edges** triggered by named events, with authored **portal frames** and
bounded waits. `avl compile` (FFmpeg under the hood, allowlisted args only)
produces a binary `.avl`; `<aval-player>` plays it via WebCodecs + WebGL2
(packed-alpha transparency), with host-owned fallback markup in a
`slot="fallback"` when capabilities are missing.

## Why it matters to us

We independently converged on the same skeleton: **declarative JSON spec →
compiled runtime → custom element**, "no embedded scripting" as the security
boundary, determinism as a headline. Their edges/triggers design is essentially
the state-machine section of our `scene-format.md` thought experiment — shipped
and market-validated. The substance differs: their pixels are prerendered video
(large assets, finite, perfect fidelity); ours are generative (tiny assets,
infinite variation, seeded RNG). They have no ambient/idle/channel/MCP story —
no product overlap, high architectural overlap.

## What we adopted (shipped July 2026)

1. **SHA-256 bundle integrity** (their `integrity` attribute → our gap): the Mac
   app's bundle refresh downloaded and executed JS with no hash verification.
   Now `manifest.json` pins a SHA-256 per file and the app rejects mismatches
   (verified with a tampered-bundle test). `build-site.mjs` + `BundleManager`.
2. **Published format spec + JSON Schema** (their `format/0.1.md` + schemas/):
   `packages/schema/saver-spec.schema.json` (draft-07, ships with the npm
   package, importable) + `packages/schema/FORMAT.md`. Format version explicitly
   decoupled from package semver. A test suite proves the JSON Schema and the
   runtime validator agree on all shipped examples. The schema is deliberately
   stricter (rejects unknown fields) as agent-authoring typo protection.
3. **THREAT-MODEL.md** (they shipped one at 2 days old): repo root; writes down
   the declarative safety boundary, passthrough/Worker trust levels, the
   unauthenticated-channel gap, and the Mac update chain.
4. **Host-owned fallback slot** (their `slot="fallback"`): `<idle-screen>` now
   reveals light-DOM `slot="fallback"` content when a saver fails to mount,
   instead of a black screen. E2e-tested (element.spec.ts L11).

## Not adopted (deliberately)

- **Binary compiled format** — our specs are small JSON; a wire format solves a
  problem we don't have (theirs packs video samples).
- **Certification/conformance packages + publication ledger** — impressive
  rigor, overkill at our stage. Nearest analog we already have: the determinism
  proof + flash-safety validator as e2e gates.
- **Prerendered-video savers** — Aerial-style video savers are beloved, and an
  `.avl` fullscreen saver would work, but it cuts against the tiny-asset
  generative philosophy. Filed as a future saver *type*, not a direction.

## Build-in-public lessons (the meta-findings)

How a 2-day-old repo got 651 stars — and what to copy when idle-screens goes
public:

1. **One flagship demo that makes you feel it in 5 seconds.** Theirs: a rabbit
   that reacts to hover. Ours should be: open a channel page on one screen,
   tell Claude "make it snow," watch it change. The MCP-steerable-display demo
   is more novel than anything AVAL shows — it just doesn't exist as a
   30-second experience yet.
2. **A landing page with the pitch in one sentence.** "Interactive video with a
   built-in state machine" — instantly graspable, names the category it
   replaces (Lottie/GIF). Ours: "screensavers your AI can steer" /
   "After Dark for the agent era."
3. **Ship the rigor artifacts visibly.** THREAT-MODEL.md, format spec, browser
   support matrix, a11y/reduced-motion doc — at the repo root of a *preview*.
   Rigor-as-marketing: it converts skeptics who assume AI-built = sloppy.
4. **Own the AI-built story.** Barashkov leads with "craziest thing I've ever
   built with Codex" and commits the agent plans/specs to the repo
   (`docs/superpowers/plans`, `docs/superpowers/specs`). The transparency *is*
   the content-marketing. Our analog: this repo's roadmap/research docs and the
   behavior contract are already that artifact — surface them rather than
   hiding them in a gitignored docs/ dir when going public.
5. **"Technical preview" framing** lowers the bar for rough edges while the
   star-momentum builds; version the format honestly (their wire v0.1 vs
   package v1.0.0) instead of sandbagging everything at 0.x.
6. **Announce where the audience already is** (X thread from a known account,
   HN). The launch is a coordinated artifact — repo + landing + demo + thread
   on the same day — not a gradual leak.

## Follow-ups filed

- Flagship 30-second MCP demo page/video before any public push.
- Landing page for idlescreens.com (the gallery is a viewer, not a pitch).
- Consider un-gitignoring the curated specs (behavior contract, scene-format)
  when going public — they're launch content, not internal noise.
- Manifest signing (offline key) if Mac-app distribution widens beyond
  first-party.
