# idle-screens for macOS

A zero-dependency Swift menu-bar app that shows the idle-screens web engine as a
screensaver. Not a `.saver` bundle — a standalone app that avoids the abandoned,
sandboxed `legacyScreenSaver` substrate (see `docs/research/macos-swift-wrapper.md`).

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
  build-app.sh              assemble + ad-hoc sign IdleScreens.app
  notarize.sh              Developer ID sign + notarize + DMG
  packaging/idle-screens.rb Homebrew cask
```

## Build & run (dev)

```bash
# from repo root, once:
pnpm install && pnpm build          # build the @idle-screens/* packages

# then:
cd apps/mac
./build-app.sh                      # web bundle + swift build + assemble .app
open dist/IdleScreens.app           # menu-bar icon appears
```

Debug flags on the binary: `--show` (start the saver immediately), `--hold`
(don't dismiss on input, for inspection), `--diagnostics` (print the diagnostics
report and exit).

**Overlay keys** while the saver is showing: **← / →** browse savers, **F**
favorite, **⌫** hide from cycle, **Return** pin the one you're viewing, any
other key/mouse dismisses.

**Saver updates.** "Check for Saver Updates" pulls a newer bundle from
`idlescreens.com/mac/` (served by idle-server — see below) and caches it under
Application Support; the shipped bundle is the offline fallback.

The saver list in the menu is generated from `web/src/savers.ts` into
`Sources/IdleScreens/SaverCatalog.swift` by `gen-catalog.mjs` (run automatically
by `build-app.sh`). Edit the TS list, not the Swift file.

## Release (sign + notarize)

Requires an Apple Developer account (Developer ID Application cert). Locally:

```bash
export DEVELOPER_ID="Developer ID Application: Your Name (TEAMID)"
xcrun notarytool store-credentials idle-notary \
  --apple-id you@example.com --team-id TEAMID --password <app-specific-password>
export NOTARY_PROFILE=idle-notary
./notarize.sh                       # → dist/IdleScreens.dmg (stapled)
```

In CI, push a `mac-v*` tag to trigger `.github/workflows/mac-release.yml`, which
needs these repo secrets:

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
