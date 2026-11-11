# AGENTS.md

Instructions for coding agents in this repo. Claude Code, Cursor, Codex and pi
all read this file — keep it the only one: a `CLAUDE.md` here or in any parent
directory makes Claude Code stop reading `AGENTS.md`.

## Repository layout

pnpm workspace monorepo. Eleven publishable packages + four apps (`ls packages/`
is the truth if this count drifts):

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
  saver-metaquarium/ @idle-screens/saver-metaquarium  -- three.js aquarium: GLB fish, environments,
                                                         fishMix schools, steerable camera
  savers-classic/    @idle-screens/savers-classic     -- 17 classic savers (toasters, DVD, warp, etc.)
  schema/            @idle-screens/schema             -- declarative saver format (depends on core)
  validator/         @idle-screens/validator           -- WCAG flash + perf gates (standalone, zero deps)
  capabilities/      @idle-screens/capabilities       -- device tier + eligibility (standalone, zero deps)
apps/
  playground/        Vite dev workbench (imports every package; dev-only, not published)
  mac/               Native macOS menu-bar app (Swift, not published to npm)
  ios/               Native iOS client + VJ remote (Swift, XcodeGen, not published to npm)
  linux/             Native Wayland layer-shell overlay (Rust + WebKitGTK 6; wlroots/KDE
                     compositors, x86_64 + aarch64; not npm)
docs/                Design docs (specs, research)
```

**Dependency graph:** `core` is the foundation. `saver-black-hole`, `saver-tide`, `saver-limelight`, `saver-slipstream`, `saver-catwalk`, `saver-metaquarium`, `savers-classic`, and `schema` depend on `core` (`saver-metaquarium` also uses `capabilities` and `three`). `validator` and `capabilities` have zero dependencies and can be used independently.

## Commands (run from repo root)

```bash
corepack enable pnpm        # repo pins pnpm 9 via packageManager
pnpm install
pnpm build                  # tsup build all packages (must run before typecheck on clean checkout)
pnpm typecheck              # tsc --noEmit across all packages
pnpm lint                   # eslint
pnpm test                   # vitest run (NOT what CI runs — see preflight)
pnpm test:coverage          # vitest + coverage thresholds (what CI runs)
pnpm dev                    # Vite playground at localhost:5177 (PLAYGROUND_PORT overrides)
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

**Linux app** (`apps/linux`): standalone Rust crate (not in the pnpm workspace). From repo root, `cd apps/linux && ./scripts/check-deps.sh && ./scripts/dev-run.sh --windowed --saver warp`. `check-deps.sh` probes pkg-config modules, so it works on any distro and prints the right apt/pacman line. Runs on **wlroots-family compositors and KDE Plasma Wayland — not GNOME/Mutter or X11**, which have no wlr-layer-shell; the app says so and exits rather than aborting. Targets x86_64 and aarch64 (Raspberry Pi OS Trixie/labwc). See `apps/linux/README.md` for the dependency table, idle-daemon wiring (hypridle / swayidle / Quickshell), and troubleshooting. CI: `.github/workflows/linux-ci.yml`.

You cannot build this on macOS, but you do not need a Linux box either — a `debian:trixie` container reproduces the CI leg exactly, and on Apple silicon that container is arm64, so it *is* the Raspberry Pi target. `make app linux build` off-Linux prints the one-liner. `./scripts/test-swayidle-install.sh` covers the session-config rewriting with no swayidle, display or Wayland needed, so run it anywhere before touching `packaging/swayidle/`.

**Apple apps** (`apps/ios`): one XcodeGen project with an iPhone/iPad target (`IdleScreens`) and an Apple TV target (`IdleScreensTV`). Run `xcodegen generate` after adding any file, or the target silently omits it. **Test tvOS in the native Simulator app driven by `xcrun simctl`** (install / launch with debug args like `-channel <id>` / `io screenshot`) — IDE and agent "live simulator preview" integrations are iOS-only and cannot attach to an Apple TV simulator. See `apps/ios/README.md`.

## Architecture notes

**The saver plugin contract.** A saver is a `SaverPlugin` with a `manifest` (id, label, passthrough flag, paramSpace) and a `mount(ctx: SaverContext): SaverInstance` function. `SaverContext` provides `host` (an HTMLElement to render into), `width`/`height`, a seeded `Rng` (NEVER use `Math.random()`), and optional `page` (for passthrough savers that eat the live page). `SaverInstance` returns `setPaused`, `resize`, and optionally `renderFrame(t, seed)` for deterministic frame-addressable rendering. See `.claude/skills/idle-screens-saver-plugin-authoring/` for the full contract.

**Seeded RNG is mandatory.** Every source of randomness must use the `Rng` from `SaverContext`, never `Math.random()`. This enables the determinism proof: same program + seed + control-track = identical frames.

**Control track.** Implemented with `step`/`linear`/`smooth` eases and `number`/`color`/`bool`/`enum` param types. `applyTrack(state, track, t)` interpolates params at time `t`. The determinism proof is exercised by Playwright e2e tests on the black hole saver.

**Passthrough savers.** A saver with `manifest.passthrough: true` renders with a transparent canvas (`alpha: true`) — either compositing `destination-out` to punch a hole through a dark mask, or simply drawing translucently — letting the live page show through, and may transform the page's own blocks via `ctx.page.victims()`. Black hole, tide, limelight, slipstream, catwalk, and spotlight are the passthrough
savers (`grep -rn 'passthrough: true' packages/*/src` is the truth).

**The `<idle-screen>` custom element.** Defined by `core`, it owns the dialog overlay, idle detection, plugin mount/unmount, and fade transitions. Consumers hand it an engine instance imperatively (`el.engine = engine`).

**The behavior contract (97 items) is fully implemented and tested.** The design docs in `docs/research/` are historical context, not implementation guidance.

## Build, CI, and deploy

- **CI** (`.github/workflows/ci.yml`): build -> typecheck -> lint -> test -> Playwright e2e. Runs on ubuntu, Node 22, pnpm (frozen lockfile). Triggers on push to `main`, PRs into it, and `workflow_call`. `workflow_call` accepts `skip_e2e` (Release uses this — PR already ran full e2e).
- **Release** (`.github/workflows/release.yml`): on push to `main` (and `workflow_dispatch` retry). Slim CI (no e2e) → `changesets/action` opens "chore: version packages" → **auto-merges** that PR → **publishes in the same run**. Prefer **npm Trusted Publishing (OIDC)** (`id-token: write`, npm ≥ 11.5.1). Optional secrets: `NPM_TOKEN` (legacy fallback until every package has a Trusted Publisher), `RELEASE_GITHUB_TOKEN` (PAT/app so the version merge can also re-trigger Pages/CI; without it, same-run publish still works), `IDLE_SERVER_DISPATCH_TOKEN` (PAT with `repo` on private idle-server — fires Consume after publish).
- **GitHub Pages** (`.github/workflows/pages.yml`): builds the playground and deploys to `https://shaaaaawn.github.io/idle-screens/` on push to `main`. Requires Pages source set to "GitHub Actions" in repo settings.
- **Mac app** (`.github/workflows/mac-release.yml`): tag `mac-v*` to build/sign/notarize the DMG. Independent of changesets.
- **Apple apps** (`.github/workflows/apple-ci.yml`): regenerates the XcodeGen project, then builds and unit-tests both the iPhone and Apple TV targets on `apps/ios/**` changes. The two targets share `IdleScreens/API`, `/Render` and `/Theme` wholesale, so a file written for one can break the other — an iPhone-only file in a shared dir goes in the TV target's `excludes:` in `project.yml`. Nothing here signs or ships; TestFlight goes out via `make app tvos ship` / `make app ios ship`, which run the same suite as a gate first.
- **Linux app** (`.github/workflows/linux-ci.yml`): `cargo fmt`, clippy, build, test across three legs — Arch x86_64, Debian trixie x86_64, Debian trixie aarch64 (native arm runner). Triggers on `apps/linux/**` changes on `main` and on PRs into it.
- **Linux release** (`.github/workflows/linux-release.yml`): tag `linux-v*` → x86_64 **and** aarch64 tarballs + GitHub Release. Built on Debian trixie, not Arch: a binary's glibc floor is its build base, and trixie's runs on Arch while the reverse does not.
- All packages use **tsup** for builds. Output goes to `dist/`.
- Tests use **Vitest** with happy-dom. E2e uses **Playwright** with Chromium.

## Releasing (changesets)

Changesets version and publish **only the npm packages** in `packages/`. They
do not gate CI, the playground, or the Mac app.

### When to add a changeset

Add a `.changeset/*.md` file **when merging to `main`** if the release includes
consumer-facing changes in any publishable package:

| Change | Typical package(s) | Bump |
| --- | --- | --- |
| Engine / element / worker API | `@idle-screens/core` | **patch while core is 0.x**; minor only after 1.0.0 |
| New or changed saver | `@idle-screens/savers-classic` or one of the `saver-*` packages | minor (feature) / patch (fix) |
| Schema format or compiler | `@idle-screens/schema` | minor (additive) / major **only** for intentional breaks |
| Validator or capabilities API | `@idle-screens/validator` or `@idle-screens/capabilities` | minor or patch |

### Critical: `0.x` core minors cascade fake majors

Changesets treats a **`minor` bump on a `0.x` package as breaking** for dependents
(semver: `^0.4.0` does not include `0.5.0`). So a changeset like
`'@idle-screens/core': minor` forces **major** bumps on schema, savers-classic,
black-hole, catwalk, etc. — even when those packages' own changesets say
`minor`/`patch`. That is why changelogs showed `## 4.0.0` / `## 3.0.0` under
"### Minor Changes" (#34, #44).

**Rule while `@idle-screens/core` is below 1.0.0:** every core changeset must be
`patch` (features and fixes). Do not file `minor` or `major` on core unless you
intentionally want a catalog-wide major cascade.

**Graduation:** when ready, ship one planned `major` on core → `1.0.0`, accept
one dependent major wave, then `minor` means minor again.

One changeset per release batch is fine — summarize the whole npm-facing delta in
a single file. Run `pnpm changeset` interactively, or author the markdown by
hand (see any existing `.changeset/*.md` file for the format).

### When you do **not** need a changeset

- Playground / workbench UI (`apps/playground` — explicitly ignored in config)
- Mac app (`apps/mac` — ships via `mac-v*` tag, not npm)
- iOS / tvOS app (`apps/ios` — ships via TestFlight / App Store, not npm)
- Linux app (`apps/linux` — ships via PKGBUILD / manual install, not npm)
- Docs, tests, CI, refactors with no published API change
- Work that is not ready to publish (merge it without a changeset; it ships when a later changeset versions the affected package)

No CI check enforces changesets. Forgetting one does not break the build — npm
just won't get new versions until a changeset lands on `main`.

### Day-to-day: pull requests straight to `main`

There is no `develop` branch (retired 2026-11-07). Branch from `origin/main`, open
the PR against `main`, and merge with **Create a merge commit**. Agents work in a
mono lane (`scripts/lane.sh claim`), whose `idle-screens` tree starts at `origin/main`.

**Merging a PR that carries a changeset is a release.** The Release workflow runs
on every push to `main`: if pending changesets exist it versions the packages,
auto-merges the "chore: version packages" PR and publishes to npm in the same run.
So add a changeset only when the change is ready to reach npm consumers; a PR
without one merges to `main` and waits for the next PR that has one.

### Release flow

```
# in a lane, on a branch from origin/main:
make preflight X=screens ARGS=--e2e     # green before you push
pnpm changeset                          # only when a publishable package changed
# PR → main, merge commit → Release versions + publishes in the same run
```

To release work that already merged without a changeset, open a PR whose only
change is the changeset. On the same `main` push, GitHub Pages deploys the
playground independently. The Mac DMG is a separate manual `mac-v*` tag.

After npm shows the new versions, consume them in idle-server: see
`idle-mono/scripts/RELEASE.md` (the dispatch to idle-server's Consume workflow
runs only when `IDLE_SERVER_DISPATCH_TOKEN` is set; otherwise run it by hand).

Verify a release landed — the consumed changesets are gone and the source
version matches what npm serves:

```bash
git fetch origin && git ls-tree --name-only origin/main .changeset/   # config.json + README.md only
git show origin/main:packages/schema/package.json | grep '"version"'
npm view @idle-screens/schema version
```

Config: `.changeset/config.json` — `access: "public"`, `baseBranch: "main"`,
`updateInternalDependencies: "patch"`.

### npm Trusted Publishing (required once; then drop `NPM_TOKEN`)

For each published `@idle-screens/*` package on npmjs.com → **Settings → Trusted
Publisher → GitHub Actions**:

| Field | Value |
| --- | --- |
| Organization or user | `shaaaaawn` |
| Repository | `idle-screens` |
| Workflow filename | `release.yml` (filename only) |
| Environment | _(leave empty)_ |
| Allowed actions | `npm publish` |

Packages: `core`, `schema`, `savers-classic`, `saver-black-hole`, `saver-catwalk`,
`saver-tide`, `saver-limelight`, `saver-slipstream`, `saver-metaquarium`,
`validator`, `capabilities`. After all eleven are configured and a Release has
published via OIDC, remove the repo `NPM_TOKEN` secret and prefer
"Require two-factor authentication and disallow tokens" on the packages.

## Branching

- **`main`** -- the only long-lived branch. Every change lands through a pull request into it (merge commit). Pushes trigger CI + release (changesets publish to npm when pending) + playground deploy to GitHub Pages. Do not push directly.
- Feature branches (`feat/…`, `fix/…`, `chore/…`) are cut from `origin/main` and deleted after merge. `develop` was retired on 2026-11-07; its last commit is the tag `archive/develop`.

## Conventions

- TypeScript strict mode with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`.
- `"type": "module"` throughout -- ESM only.
- Node >= 22 required (see `engines` in root `package.json`).
- GitHub org is `shaaaaawn` (5 a's). npm scope is `@idle-screens`. npm username is `shawnfx`.
- Classic savers are ports from Berkeley Systems' After Dark via Bryan Braun's after-dark-css. See `CREDITS.md` for attribution.

## Consumer integration (idle-server)

The Cloudflare Worker at `~/code/idle-server` consumes `@idle-screens/schema` (plus core, savers-classic, saver-black-hole) from npm. Its `src/worker.ts` contains a `SCHEMA_REFERENCE` constant that mirrors `packages/schema/FORMAT.md` — **update the server's reference whenever the schema format changes** (new sprite kinds, motion types, top-level fields, etc.). See `~/code/idle-server/AGENTS.md` for the update checklist.

## Consumer integration (shawn-site)

The Angular site at `~/code/shawn-site` consumes `@idle-screens/core`, `@idle-screens/saver-black-hole`, and `@idle-screens/savers-classic` from the **npm registry** (`^0.1.0` in `app/package.json`). To update: publish a new version via changesets (merge to `main`), then `npm update` in the site's `app/` directory. The old vendored-tarball approach is retired.

## npm publishing

- npm org: `idle-screens` (on npmjs.com). npm username: `shawnfx`.
- All packages publish with `publishConfig: { "access": "public" }`.
- Scoped packages require the npm org to exist or publish returns 404.
- Granular access token with "Bypass 2FA" is required for CI publishing (classic automation tokens fail with 403).
