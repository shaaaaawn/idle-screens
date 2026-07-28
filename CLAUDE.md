# CLAUDE.md

## Repository layout

pnpm workspace monorepo. Ten publishable packages + four apps:

```
packages/
  core/              @idle-screens/core         -- engine, <idle-screen> element, idle detection,
                                                   plugin registry, seeded RNG, control-track, types
  saver-black-hole/  @idle-screens/saver-black-hole  -- passthrough gravitational-lensing saver
  saver-tide/        @idle-screens/saver-tide         -- passthrough water saver: Jacobian-driven
                                                         affine deformation of live page blocks
  saver-limelight/   @idle-screens/saver-limelight    -- passthrough stage-light saver: page blocks
                                                         gain height and occlude each other
  saver-slipstream/  @idle-screens/saver-slipstream   -- passthrough wind saver: page blocks are
                                                         obstacles in an analytic flow field
  saver-catwalk/    @idle-screens/saver-catwalk      -- passthrough cat saver: a seeded-itinerary
                                                         cat parkours across the page's blocks
  savers-classic/    @idle-screens/savers-classic     -- 17 classic savers (toasters, DVD, warp, etc.)
  schema/            @idle-screens/schema             -- declarative saver format (depends on core)
  validator/         @idle-screens/validator           -- WCAG flash + perf gates (standalone, zero deps)
  capabilities/      @idle-screens/capabilities       -- device tier + eligibility (standalone, zero deps)
apps/
  playground/        Vite dev workbench (imports all 10; dev-only, not published)
  mac/               Native macOS menu-bar app (Swift, not published to npm)
  ios/               Native iOS client + VJ remote (Swift, XcodeGen, not published to npm)
  linux/             Native Wayland/Hyprland overlay (Rust + WebKitGTK 6; on develop, not npm)
docs/                Design docs (specs, research)
```

**Dependency graph:** `core` is the foundation. `saver-black-hole`, `saver-tide`, `saver-limelight`, `saver-slipstream`, `saver-catwalk`, `savers-classic`, and `schema` depend on `core`. `validator` and `capabilities` have zero dependencies and can be used independently.

## Commands (run from repo root)

```bash
corepack enable pnpm        # repo pins pnpm 9 via packageManager
pnpm install
pnpm build                  # tsup build all packages (must run before typecheck on clean checkout)
pnpm typecheck              # tsc --noEmit across all packages
pnpm lint                   # eslint
pnpm test                   # vitest run (NOT what CI runs — see preflight)
pnpm test:coverage          # vitest + coverage thresholds (what CI runs)
pnpm dev                    # Vite playground at localhost:5173
pnpm test:e2e               # Playwright (element + savers + determinism + config menu)
pnpm test:all               # build + typecheck + lint + test + e2e (missing coverage!)
```

**Important:** `pnpm build` must run before `pnpm typecheck` on a clean checkout. Packages typecheck against each other's emitted `dist/*.d.ts`, so the declarations must exist first.

### Before opening or updating a PR (mandatory)

Do **not** open / push a PR on a green-enough subset (`pnpm test`, a single package
typecheck, “build passed”). CI runs `pnpm test:coverage` and, when `apps/linux/**`
touches, Linux `cargo fmt --check` + clippy. From the mono root:

```bash
make preflight X=screens          # install + build + typecheck + lint + test:coverage
make preflight X=screens ARGS=--e2e   # also Playwright (release PRs)
```

That script is `idle-mono/scripts/preflight.sh` — it fails on the first red step
and is the agent/human gate. If the branch touches `apps/linux/**`, also:

```bash
cd apps/linux && cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings
```

(or let preflight’s linux fmt step do it when `cargo` is on PATH).

**Linux app** (`apps/linux`, `develop` branch): standalone Rust crate (not in the pnpm workspace). From repo root, `cd apps/linux && ./scripts/check-deps.sh && ./scripts/dev-run.sh --windowed --saver warp`. See `apps/linux/README.md` for Arch deps (`webkitgtk-6.0`, etc.), hypridle wiring, and troubleshooting. CI: `.github/workflows/linux-ci.yml`.

## Architecture notes

**The saver plugin contract.** A saver is a `SaverPlugin` with a `manifest` (id, label, passthrough flag, paramSpace) and a `mount(ctx: SaverContext): SaverInstance` function. `SaverContext` provides `host` (an HTMLElement to render into), `width`/`height`, a seeded `Rng` (NEVER use `Math.random()`), and optional `page` (for passthrough savers that eat the live page). `SaverInstance` returns `setPaused`, `resize`, and optionally `renderFrame(t, seed)` for deterministic frame-addressable rendering. See `.claude/skills/idle-screens-saver-plugin-authoring/` for the full contract.

**Seeded RNG is mandatory.** Every source of randomness must use the `Rng` from `SaverContext`, never `Math.random()`. This enables the determinism proof: same program + seed + control-track = identical frames.

**Control track.** Implemented with `step`/`linear`/`smooth` eases and `number`/`color`/`bool`/`enum` param types. `applyTrack(state, track, t)` interpolates params at time `t`. The determinism proof is exercised by Playwright e2e tests on the black hole saver.

**Passthrough savers.** A saver with `manifest.passthrough: true` renders with a transparent canvas (`alpha: true`) — either compositing `destination-out` to punch a hole through a dark mask, or simply drawing translucently — letting the live page show through, and may transform the page's own blocks via `ctx.page.victims()`. Black hole, tide, limelight, slipstream, and spotlight are the passthrough savers.

**The `<idle-screen>` custom element.** Defined by `core`, it owns the dialog overlay, idle detection, plugin mount/unmount, and fade transitions. Consumers hand it an engine instance imperatively (`el.engine = engine`).

**The behavior contract (97 items) is fully implemented and tested.** The design docs in `docs/research/` are historical context, not implementation guidance.

## Build, CI, and deploy

- **CI** (`.github/workflows/ci.yml`): build -> typecheck -> lint -> test -> Playwright e2e. Runs on ubuntu, Node 22, pnpm (frozen lockfile). Triggers on push to `main` and `develop`, plus PRs and `workflow_call`.
- **Release** (`.github/workflows/release.yml`): uses `changesets/action` to version-bump and publish to npm on push to `main`. Requires `NPM_TOKEN` secret (granular access token with "Bypass 2FA"). Both `NPM_TOKEN` and `NODE_AUTH_TOKEN` env vars must be set (setup-node creates `.npmrc` using `NODE_AUTH_TOKEN`, overriding changesets' `NPM_TOKEN` `.npmrc`).
- **GitHub Pages** (`.github/workflows/pages.yml`): builds the playground and deploys to `https://shaaaaawn.github.io/idle-screens/` on push to `main`. Requires Pages source set to "GitHub Actions" in repo settings.
- **Mac app** (`.github/workflows/mac-release.yml`): tag `mac-v*` to build/sign/notarize the DMG. Independent of changesets.
- **Linux app** (`.github/workflows/linux-ci.yml`): `cargo fmt`, clippy, build, test in an Arch container. Triggers on `apps/linux/**` changes on `main` and `develop`.
- **Linux release** (`.github/workflows/linux-release.yml`): tag `linux-v*` → release tarball + GitHub Release.
- All packages use **tsup** for builds. Output goes to `dist/`.
- Tests use **Vitest** with happy-dom. E2e uses **Playwright** with Chromium.

## Releasing (changesets)

Changesets version and publish **only the ten npm packages** in `packages/`. They
do not gate CI, the playground, or the Mac app.

### When to add a changeset

Add a `.changeset/*.md` file **when merging to `main`** if the release includes
consumer-facing changes in any publishable package:

| Change | Typical package(s) | Bump |
| --- | --- | --- |
| Engine / element / worker API | `@idle-screens/core` | minor or patch |
| New or changed saver | `@idle-screens/savers-classic` or one of the `saver-*` packages | minor |
| Schema format or compiler | `@idle-screens/schema` | minor (breaking → major) |
| Validator or capabilities API | `@idle-screens/validator` or `@idle-screens/capabilities` | minor or patch |

One changeset per release batch is fine — summarize the whole npm-facing delta in
a single file. Run `pnpm changeset` interactively, or author the markdown by
hand (see any existing `.changeset/*.md` file for the format).

### When you do **not** need a changeset

- Playground / workbench UI (`apps/playground` — explicitly ignored in config)
- Mac app (`apps/mac` — ships via `mac-v*` tag, not npm)
- iOS / tvOS app (`apps/ios` — ships via TestFlight / App Store, not npm)
- Linux app (`apps/linux` — ships via PKGBUILD / manual install, not npm)
- Docs, tests, CI, refactors with no published API change
- Work that stays on `develop` and is not ready to publish

No CI check enforces changesets. Forgetting one does not break the build — npm
just won't get new versions until a changeset lands on `main`.

### Day-to-day on `develop`

Do **not** monitor for changesets during normal dev. Batch at release time: before
the `develop → main` merge, ask *"did any publishable package change?"* — if yes,
include a changeset in that PR.

### Release flow

```
# BEFORE opening the PR — mandatory local gate (matches CI):
make preflight X=screens ARGS=--e2e   # from idle-mono/

develop / release/* PR (includes .changeset/*.md when npm packages changed)
    → merge to main
release.yml runs CI, then changesets/action
    → if pending changesets: opens "chore: version packages" PR
    → merge that PR → pnpm changeset publish → npm
```

On the same `main` push, GitHub Pages deploys the playground independently.
The Mac DMG is a separate manual `mac-v*` tag.

### After every release: sync `develop` back from `main` (do not skip)

The `changesets/action` "version packages" PR — the version bumps, CHANGELOG
entries, and **deletion of the consumed `.changeset/*.md`** — lands on `main`,
not `develop`. If `develop` isn't fast-forwarded afterward it keeps the stale,
already-consumed changeset, and the **next** `develop → main` merge re-bumps
and **re-publishes the same content under a new version**. This bit us once:
the v1-ceiling batch shipped as `schema@2.3.0` from main while `develop` sat at
`2.2.0` with the changeset still present, primed to re-ship as `2.4.0`.

So the release flow's real last step is:

```
# after the version-packages PR merges to main:
git checkout develop && git fetch origin && git merge --ff-only origin/main
```

**This only works if the `develop → main` PR was a true merge.** If it was
**squash**-merged, develop is not a descendant of main and there is nothing to
fast-forward — `--ff-only` fails and it is tempting to skip the step. Check
first:

```bash
git rev-list --parents -n 1 <the-release-merge-sha> | wc -w   # 2 = squash, 3 = merge
git merge-base --is-ancestor origin/main origin/develop && echo "already synced"
```

Squash also *inverts* the danger. With a true merge, develop's stale versions
would conflict on the next merge; with squash they are carried wholesale
**onto main**, silently regressing published version numbers.

After a squash, a plain `git merge origin/main` conflicts across everything
both sides touched since the old base. Do a metadata-only sync instead — same
end state, no conflicts:

1. copy `packages/*/package.json` and `packages/*/CHANGELOG.md` from `main`
2. delete only the changesets `main` actually consumed — `git cat-file -e
   <release-sha>:.changeset/<file>` tells you whether a file predates the
   release (consumed, delete it) or was added after (keep it)
3. leave root `package.json` alone; it carries develop-only overrides

**The same applies to anything merged directly to `main`** — Dependabot bumps,
CI workflow changes. A later squash from `develop` reverts them. Mirror them
back to `develop` or they are temporary. (Seen 2026-07-27: PRs #28/#30/#32 had
to be carried back by hand.)

Verify the sync worked — the consumed changesets are gone and the source
version matches what npm now serves:

```bash
ls .changeset/*.md                          # only README.md should remain
node -p "require('./packages/schema/package.json').version"
npm view @idle-screens/schema version       # should match the line above
```

If the merge is *not* ff-only, `develop` has diverged and needs a real merge;
investigate before publishing anything else.

Config: `.changeset/config.json` — `access: "public"`, `baseBranch: "main"`,
`updateInternalDependencies: "patch"`. Requires `NPM_TOKEN` (+ `NODE_AUTH_TOKEN`
for setup-node) in GitHub secrets.

## Branching

- **`main`** -- production. Pushes trigger CI + release (changesets publish to npm) + playground deploy to GitHub Pages. Do not push directly; merge from `develop`.
- **`develop`** -- day-to-day work. Pushes trigger CI only. Default working branch.

## Conventions

- TypeScript strict mode with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`.
- `"type": "module"` throughout -- ESM only.
- Node >= 22 required (see `engines` in root `package.json`).
- GitHub org is `shaaaaawn` (5 a's). npm scope is `@idle-screens`. npm username is `shawnfx`.
- Classic savers are ports from Berkeley Systems' After Dark via Bryan Braun's after-dark-css. See `CREDITS.md` for attribution.

## Consumer integration (idle-server)

The Cloudflare Worker at `~/code/idle-server` consumes `@idle-screens/schema` (plus core, savers-classic, saver-black-hole) from npm. Its `src/worker.ts` contains a `SCHEMA_REFERENCE` constant that mirrors `packages/schema/FORMAT.md` — **update the server's reference whenever the schema format changes** (new sprite kinds, motion types, top-level fields, etc.). See `~/code/idle-server/CLAUDE.md` for the update checklist.

## Consumer integration (shawn-site)

The Angular site at `~/code/shawn-site` consumes `@idle-screens/core`, `@idle-screens/saver-black-hole`, and `@idle-screens/savers-classic` from the **npm registry** (`^0.1.0` in `app/package.json`). To update: publish a new version via changesets (merge to `main`), then `npm update` in the site's `app/` directory. The old vendored-tarball approach is retired.

## npm publishing

- npm org: `idle-screens` (on npmjs.com). npm username: `shawnfx`.
- All 6 packages are published at `0.1.0` with `publishConfig: { "access": "public" }`.
- Scoped packages require the npm org to exist or publish returns 404.
- Granular access token with "Bypass 2FA" is required for CI publishing (classic automation tokens fail with 403).
