# CLAUDE.md

## Repository layout

pnpm workspace monorepo. Six publishable packages + one dev app:

```
packages/
  core/              @idle-screens/core         -- engine, <idle-screen> element, idle detection,
                                                   plugin registry, seeded RNG, control-track, types
  saver-black-hole/  @idle-screens/saver-black-hole  -- passthrough gravitational-lensing saver
  savers-classic/    @idle-screens/savers-classic     -- 13 classic savers (toasters, DVD, warp, etc.)
  schema/            @idle-screens/schema             -- declarative saver format (depends on core)
  validator/         @idle-screens/validator           -- WCAG flash + perf gates (standalone, zero deps)
  capabilities/      @idle-screens/capabilities       -- device tier + eligibility (standalone, zero deps)
apps/
  playground/        Vite dev workbench (imports all 6; dev-only, not published)
docs/                Design docs (vision, control-track spec, behavior contract)
```

**Dependency graph:** `core` is the foundation. `saver-black-hole`, `savers-classic`, and `schema` depend on `core`. `validator` and `capabilities` have zero dependencies and can be used independently.

## Commands (run from repo root)

```bash
corepack enable pnpm        # repo pins pnpm 9 via packageManager
pnpm install
pnpm build                  # tsup build all packages (must run before typecheck on clean checkout)
pnpm typecheck              # tsc --noEmit across all packages
pnpm lint                   # eslint
pnpm test                   # vitest run (120 unit tests)
pnpm dev                    # Vite playground at localhost:5173
pnpm test:e2e               # Playwright (element + savers + determinism + config menu)
pnpm test:all               # build + typecheck + lint + test + e2e (the full CI gate)
```

**Important:** `pnpm build` must run before `pnpm typecheck` on a clean checkout. Packages typecheck against each other's emitted `dist/*.d.ts`, so the declarations must exist first.

## Architecture notes

**The saver plugin contract.** A saver is a `SaverPlugin` with a `manifest` (id, label, passthrough flag, paramSpace) and a `mount(ctx: SaverContext): SaverInstance` function. `SaverContext` provides `host` (an HTMLElement to render into), `width`/`height`, a seeded `Rng` (NEVER use `Math.random()`), and optional `page` (for passthrough savers that eat the live page). `SaverInstance` returns `setPaused`, `resize`, and optionally `renderFrame(t, seed)` for deterministic frame-addressable rendering. See `.claude/skills/idle-screens-saver-plugin-authoring/` for the full contract.

**Seeded RNG is mandatory.** Every source of randomness must use the `Rng` from `SaverContext`, never `Math.random()`. This enables the determinism proof: same program + seed + control-track = identical frames.

**Control track.** Implemented with `step`/`linear`/`smooth` eases and `number`/`color`/`bool`/`enum` param types. `applyTrack(state, track, t)` interpolates params at time `t`. The determinism proof is exercised by Playwright e2e tests on the black hole saver.

**Passthrough savers.** A saver with `manifest.passthrough: true` renders with a transparent canvas (`alpha: true`) and uses `destination-out` compositing to punch a transparent hole through a dark mask, letting the live page show through. The black hole and spotlight are passthrough savers.

**The `<idle-screen>` custom element.** Defined by `core`, it owns the dialog overlay, idle detection, plugin mount/unmount, and fade transitions. Consumers hand it an engine instance imperatively (`el.engine = engine`).

**`behavior-contract.md` is the authoritative specification.** All 97 items are implemented and tested. The vision doc and control-track spec are aspirational/historical; check their status headers.

## Build, CI, and deploy

- **CI** (`.github/workflows/ci.yml`): build -> typecheck -> lint -> test -> Playwright e2e. Runs on ubuntu, Node 22, pnpm (frozen lockfile). Triggers on push to `main` and `develop`, plus PRs and `workflow_call`.
- **Release** (`.github/workflows/release.yml`): uses `changesets/action` to version-bump and publish to npm on push to `main`. Requires `NPM_TOKEN` secret (granular access token with "Bypass 2FA"). Both `NPM_TOKEN` and `NODE_AUTH_TOKEN` env vars must be set (setup-node creates `.npmrc` using `NODE_AUTH_TOKEN`, overriding changesets' `NPM_TOKEN` `.npmrc`).
- **GitHub Pages** (`.github/workflows/pages.yml`): builds the playground and deploys to `https://shaaaaawn.github.io/idle-screens/` on push to `main`. Requires Pages source set to "GitHub Actions" in repo settings.
- **Changesets** for versioning/publishing. Config: `access: "public"`, `baseBranch: "main"`, playground is ignored. Run `pnpm changeset` to add a changeset before publishing.
- All packages use **tsup** for builds. Output goes to `dist/`.
- Tests use **Vitest** with happy-dom. E2e uses **Playwright** with Chromium.

## Branching

- **`main`** -- production. Pushes trigger CI + release (changesets publish to npm) + playground deploy to GitHub Pages. Do not push directly; merge from `develop`.
- **`develop`** -- day-to-day work. Pushes trigger CI only. Default working branch.

## Conventions

- TypeScript strict mode with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`.
- `"type": "module"` throughout -- ESM only.
- Node >= 22 required (see `engines` in root `package.json`).
- GitHub org is `shaaaaawn` (5 a's). npm scope is `@idle-screens`. npm username is `shawnfx`.
- Classic savers are ports from Berkeley Systems' After Dark via Bryan Braun's after-dark-css. See `CREDITS.md` for attribution.

## Consumer integration (shawn-site)

The Angular site at `~/code/shawn-site` consumes `@idle-screens/core`, `@idle-screens/saver-black-hole`, and `@idle-screens/savers-classic` from the **npm registry** (`^0.1.0` in `app/package.json`). To update: publish a new version via changesets (merge to `main`), then `npm update` in the site's `app/` directory. The old vendored-tarball approach is retired.

## npm publishing

- npm org: `idle-screens` (on npmjs.com). npm username: `shawnfx`.
- All 6 packages are published at `0.1.0` with `publishConfig: { "access": "public" }`.
- Scoped packages require the npm org to exist or publish returns 404.
- Granular access token with "Bypass 2FA" is required for CI publishing (classic automation tokens fail with 403).
