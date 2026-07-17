# idle-screens for macOS

A zero-dependency Swift menu-bar app that shows the idle-screens web engine as a
screensaver. Not a `.saver` bundle — a standalone app that avoids the abandoned,
sandboxed `legacyScreenSaver` substrate.

## How it works

- **Menu-bar only** (`LSUIElement`) — no Dock icon.
- **Idle detection** via `CGEventSource.secondsSinceLastEventType` (no permissions).
- **Overlay**: one borderless `NSWindow` per display at `.screenSaver` level,
  each hosting a `WKWebView`. Fades in/out; the same saver + seed render on every
  display in sync.
- **Content**: the bundled web build (offline) or an `idlescreens.com/channel/<id>`
  (live, MCP-steerable, with automatic fallback to bundled when offline).
- **Wake** on any local input — no Accessibility/Input Monitoring prompt.
- **Power**: holds a display-sleep assertion while active; optional "Only on Power".
- **Launch at login** via `SMAppService`.

## Layout

```
apps/mac/
  Package.swift              SPM executable (macOS 13+)
  Info.plist                 LSUIElement app metadata
  Sources/IdleScreens/
    main.swift               entry point
    AppDelegate.swift        menu bar UI + settings + conflict warnings
    IdleMonitor.swift        CGEventSource idle poll
    SaverController.swift     overlay windows, fade, cycling, channel mode
    SystemInfo.swift          battery + display-sleep introspection
    SaverCatalog.swift        GENERATED from web/src/savers.ts
  web/                       host page bundling @idle-screens/* savers
    src/savers.ts            single source of truth for the saver list
    build.mjs / gen-catalog.mjs
  scripts/
    build-app.sh             assemble + ad-hoc sign IdleScreens.app
    lib.sh                   shared env + signing helpers
    check-signing.sh         verify Keychain, .env, notary profile
    generate-csr.sh          one-time Developer ID CSR
    setup-notary.sh          store notarytool creds from .env
    setup-gh-secrets.sh      push signing secrets to GitHub
    release-local.sh         full local sign + notarize + staple
    notarize.sh              sign + notarize + staple (lower level)
    staple-dmg.sh            staple after async notarization
    tag-release.sh           push mac-v* tag for CI release
    audit-no-secrets.sh      grep scripts for hardcoded credentials
  packaging/idle-screens.rb Homebrew cask
```

## Build & run (dev)

```bash
# from repo root, once:
pnpm install && pnpm build          # build the @idle-screens/* packages

# then:
cd apps/mac
./scripts/build-app.sh              # web bundle + swift build + assemble .app
open dist/IdleScreens.app           # menu-bar icon appears
```

Debug flags on the binary: `--show` (start the saver immediately), `--hold`
(don't dismiss on input, for inspection), `--diagnostics` (print the diagnostics
report and exit), `--check-updates` (run a bundle refresh and exit), `--probe`
(show the saver, then print the webview's rendered state).

**Overlay keys** while the saver is showing: **← / →** browse savers, **F**
favorite, **⌫** hide from cycle, **Return** pin the one you're viewing. Keys and
clicks dismiss immediately; small pointer drift does **not** (only a deliberate
move of >8pt within a moment wakes it), so the saver won't vanish on a trackpad
twitch.

## Launch & troubleshooting

**It's a menu-bar app — there is no window and no Dock icon.** After launch, look
for the **display icon in the menu bar** (top-right). On first run a one-time
welcome window appears; after that it's silent. If you don't see the icon, the
app isn't running — relaunch with `open dist/IdleScreens.app`.

- **"Nothing happens" when I open it** → that's expected; check the menu bar. To
  confirm it's alive: `pgrep -x IdleScreens`.
- **Gatekeeper blocks it** ("unidentified developer") → the app is only ad-hoc
  signed. Right-click the app → **Open** (once), or
  `xattr -dr com.apple.quarantine dist/IdleScreens.app`. A notarized DMG (see
  Release, below) avoids this for end users.
- **The saver flashes and vanishes** → fixed: pointer drift no longer dismisses
  it. Rebuild if you're on an older build. Keys/clicks still dismiss (that's the
  point).
- **The saver shows a black screen** → the webview failed to load. Run
  `.../IdleScreens --probe` to print the rendered state, and check Console for
  `[idle-screens] webview didFail`. A bad cached bundle now self-heals to the
  built-in one; you can also force it via the menu's **Reset to Built-in Savers**.
- **It never starts on idle** → the display may sleep before the saver's "Start
  After" time (the app warns about this on launch), or a gate is active
  (Only on Power / Pause During Fullscreen / Active Hours). See **Diagnostics…**.
- **See what's going on**: `log stream --predicate 'process == "IdleScreens"'`.

**Saver updates.** "Check for Saver Updates" pulls a newer bundle from
`idlescreens.com/mac/` (served by idle-server — see below) and caches it under
Application Support; the shipped bundle is the offline fallback.

The saver list in the menu is generated from `web/src/savers.ts` into
`Sources/IdleScreens/SaverCatalog.swift` by `gen-catalog.mjs` (run automatically
by `scripts/build-app.sh`). Edit the TS list, not the Swift file.

## Release (sign + notarize)

Requires an Apple Developer account (Developer ID Application cert).

### One-time setup

1. Copy `.env.example` to `.env` and fill in signing fields:

   ```
   APPLE_ID=you@example.com
   APPLE_TEAM_ID=TEAMID
   APPLE_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
   P12_PASSWORD=strong-export-password
   CSR_ORG=Your Org, LLC
   ```

2. Generate a CSR and create the cert at [developer.apple.com](https://developer.apple.com/account/resources/certificates/add) (**Developer ID Application**, not Apple Distribution):

   ```bash
   cd apps/mac
   ./scripts/generate-csr.sh
   # upload .secrets/developer-id.csr, download .cer, double-click to install
   ```

3. Store notary credentials + push GitHub secrets:

   ```bash
   ./scripts/setup-notary.sh
   ./scripts/setup-gh-secrets.sh
   ```

4. Verify everything:

   ```bash
   ./scripts/check-signing.sh
   ```

### Every release (local)

```bash
cd apps/mac
./scripts/release-local.sh          # → dist/IdleScreens.dmg (stapled)
```

Options:

- `./scripts/notarize.sh --skip-build` — re-sign/notarize without rebuilding
- `./scripts/staple-dmg.sh` — staple after a notarization that finished async

### CI release

```bash
./scripts/tag-release.sh            # tags mac-v{version} from Info.plist and pushes
```

Or push a `mac-v*` tag manually to trigger `.github/workflows/mac-release.yml`.
GitHub needs these repo secrets ( `./scripts/setup-gh-secrets.sh` sets all six):

| Secret | What |
|--------|------|
| `MACOS_CERTIFICATE` | base64 of the Developer ID `.p12` |
| `MACOS_CERTIFICATE_PWD` | password for the `.p12` |
| `MACOS_DEVELOPER_ID` | the `Developer ID Application: … (TEAMID)` string |
| `APPLE_ID` | Apple ID email for notarytool |
| `APPLE_TEAM_ID` | 10-char team id |
| `APPLE_APP_PASSWORD` | app-specific password for notarytool |

After a release, update `version` + `sha256` in `packaging/idle-screens.rb`
(the notarize script prints the DMG SHA-256) and push it to the Homebrew tap.

## Server side (idle-server)

Two features talk to `~/code/idle-server`:

- **Cast to Channel** — `ChannelClient` POSTs a JSON-RPC `publishScene` to
  `idlescreens.com/mcp` (the existing MCP endpoint). No server change needed.
- **Saver updates** — idle-server hosts a parity Mac bundle at `/mac/`
  (`site/mac/` → `dist/site/mac/` with `manifest.json`), built from its own
  `@idle-screens` deps. Redeploy idle-server (`npm run deploy`) to publish new
  savers; the app pulls them via "Check for Saver Updates". Cloudflare Assets
  serves `/mac/*` directly, so no worker routing change was required.
