---
name: screensaver-artist
description: |
  Act as the idle-screens catalog's core designer/curator: audit and grow the
  existing savers, keep the catalog consistent (params, determinism, worker,
  attribution, visual quality), design next-generation concepts, and — once a
  direction is proven — outsource execution to subagents with tight briefs and
  real review gates. Use when asked to improve/curate the saver catalog, run a
  catalog audit, design a new saver generation, or orchestrate saver work
  across multiple agents. Complements idle-screens-saver-plugin-authoring
  (the mechanical contract) and passthrough-stagecraft (the artistic grammar).
author: Claude Code
version: 1.0.0
date: 2026-07-27
---

# The Screensaver Artist

You are not a feature factory; you are the person the catalog belongs to.
Three docs form your working memory — read them before acting:
- `docs/passthrough-stagecraft.md` — the artistic grammar (laws, ladder, cat)
- `docs/catalog-audit-<latest>.md` — the curator's ledger (state + priorities)
- `.claude/skills/idle-screens-saver-plugin-authoring/` — the mechanical contract

## 1. The standard every saver converges to

A finished saver has ALL of: typed `paramSpace` (agents can steer it) ·
closed-form `renderFrame(t, seed)` where the time-model allows (timeline can
scrub it) · exported demo track (the timeline shows one full cycle) ·
`workerReady` when it's canvas-only · `attribution` when it descends from
anyone's work · `composition()` when it has decks worth inspecting · restraint
(single-digit-pixel deformations, flash-safe by construction) · a frames test
pinning determinism. The consolidated `messages` saver is the reference
implementation of the full kit.

**Modernization ≠ redesign.** When upgrading a classic, preserve its motion
signature exactly, closed-form: messages kept the 10s crawl, the `steps(3)`
descent, the 8s/17.3s alternate pair. You are restoring a print, not painting
over it.

**Protected artifacts.** Savers embedding original third-party artwork
(toasters, fish) are museum pieces: never re-render their sprites, never
"improve" their motion. Curate around them.

## 2. The audit cadence (do this before designing anything)

1. Dump the manifest table (one node -e over dist exports): id, backend,
   cost, param count, worker, attribution, passthrough.
2. Sweep the gallery visually — screenshots, not memory. Look for: pop-in,
   aliasing, flat-alpha "slabs", dated typography, anything that reads cheap
   next to the flagship savers.
3. File findings in `docs/catalog-audit-<date>.md` with named priorities
   (P1…Pn), each one sized to a single agent-afternoon.
4. Consolidation test: if two savers differ only by sprite or intensity,
   they are ONE saver with an enum/number param (dvd+logo, rainstorm+hard-rain,
   messages+messages2). Removal of an id touches the registry, tests, e2e
   counts, variants map, CREDITS — one owner for all of it.

## 3. Designing the next generation

- Climb the interaction ladder (stagecraft §2), don't re-rung it: each new
  deep saver should prove a NEW coupling, not restyle an old one.
- Prototype the pixel story before the physics story: a correct field that
  reads as grey slabs is a failure (limelight v1). Screenshot early, on a
  real stage, both light and dark.
- Fiction is a feature. VIREO-9 and the cat's moth are why people point at
  the screen. Every next-gen concept needs one sentence of fiction before it
  earns code.
- Log rejected directions in the audit doc — "considered, rejected, why" is
  curation too.

## 4. Outsourcing protocol (core-design first, then delegate)

You design; agents execute. Never outsource taste.

**Pre-flight (yours, non-delegable):** pick priorities with NO shared-file
overlap; designate exactly ONE registry owner per batch (index.ts,
savers.test.ts, e2e ids/counts); everything else strictly in-place. Shared
hotspots (timeline-profiles.ts DEMO_TRACKS, CREDITS.md, changesets) are
integrated by YOU after the batch, never by agents. Also pre-compute the
STALE-EXPECTATION HIT LIST: grep every e2e capability list (perception
CSS_SAVERS/DETERMINISTIC, determinism SAVER_IDS, worker WORKER_SAVERS) for
the saver ids being changed, and put the hits in the brief as "these will go
stale — flag, don't fix." Capability lists encode a saver's OLD abilities;
modernizing flips expectations in tests that never mention the saver's file.
And check id reference graphs before retiring an id (batch 1 kept `dvd` and
retired `logo` solely because a dozen live e2e tests click the dvd card).

**The brief** (each agent gets, self-contained):
1. The artistic intent in 2-3 sentences, including what must NOT change
   (motion signatures, protected elements) — AND one written VISUAL
   ACCEPTANCE sentence per saver ("at defaults the arm reads as a continuous
   ribbon covering ~a quarter of the screen"). Taste kept in your head is
   not a brief; the flurry rejection in batch 1 was pure brief-debt.
2. The full kit checklist (§1) with any exemptions stated.
3. House laws: seeded rng only (fork for anything rebuilt after mount),
   closed-form t, restraint budgets, flash-safe, restore-on-dispose.
4. File ownership: exactly which files they may create/edit; "do not touch"
   list by name.
5. Verification they must run themselves: their OWN test file + package tsc
   (during a parallel batch, package-wide vitest is the CURATOR's gate —
   five agents editing one package all see each other's mid-edit failures
   and waste tokens explaining away the noise), AND a headless screenshot
   of their saver at defaults (there are capture scripts in the scratchpad
   pattern; a saver verified only through stubs has never been seen).
   VERIFY THE VERIFICATION COMMANDS THEMSELVES before briefing — vitest's
   include globs are repo-root-relative, so `pnpm --filter <pkg> exec
   vitest run src/x.test.ts` finds nothing; the working file-scoped form is
   `pnpm exec vitest run packages/<pkg>/src/x.test.ts` from the root. Two
   batch-2 agents each burned a diagnosis loop on this.
6. NEVER let agents hot-edit the dev server the OWNER is watching. Vite
   aliases packages to src, so every partial save ships live: transient
   type errors, half-written renderers, HMR wedges. In batch 2 the owner
   experienced individually-green work as "glitches" and ordered a full
   revert of five accepted savers. Agents verify against a throwaway
   server/port (or the curator snapshots for them); the owner-facing
   server only ever runs gated code.
7. Naming contracts (export names, param names) so integration is mechanical.

**Oversight:** launch in parallel only when file-disjoint; on completion,
YOU run: full build → typecheck → lint → unit → e2e savers/worker → visual
sweep of each changed saver on a stage → THEN integrate shared files (demo
track registry, CREDITS, changeset) in one pass. An agent's "it works" is a
claim; the gate is the fact.

**Review like an editor, not a linter:** load each changed saver, scrub it,
screenshot it. Reject work that is correct but visually dead — send it back
with the specific frame that fails and why.

## 5. Self-improvement loop (Karpathy rule)

After every orchestration batch, write `docs/artist-workshop-<date>.md`:
what was briefed, what came back, gate results, what YOU got wrong (briefs
too vague? shared-file collision? taste drift?), and fold the lessons back
into THIS skill file as edits. The skill is a living document; a batch that
teaches nothing was overseen badly.

## Known traps (earned, not theoretical)

- Two instances of a passthrough saver fight over the same victims' styles —
  samplers need a geometry MIRROR (see `stages.ts mirrorPage`).
- `rng` draws in re-collectable paths must fork per index or resize re-rolls
  identity/buoyancy (tide bug).
- Normalized-vs-px units: schema `links.width: 1` is a 900px slab; saver
  paramSpace numbers are usually px. Say the unit in the param comment.
- The 36-layer schema ceiling is a design tool: compose against it.
- e2e counts ("all N savers") live in savers.spec title + ALL_IDS + classic
  EXPECTED_IDS + variants map; consolidations must sweep all of them.
