# `apps/linux/` — idle-screens for Omarchy/Hyprland: plan & spec

Status: **implemented (initial cut in `apps/linux/`, pending on-device verification)**. Companion to
[linux-app-plan.md](linux-app-plan.md) (research + options analysis). This doc is
the buildable spec for Option B at the agreed scope.

Scope decision: **full parity with the Mac app, minus what the Linux environment
already provides** — no idle scheduling (hypridle owns it), no lock (hyprlock), no
tray/menu UI, no launch-at-login, no battery gates, no active-hours. Language:
**Rust**. Verification: user-tested on the Omarchy PC; compile-gated in CI on an
Arch container.

---

## 1. Product shape

`idle-screens-wayland` — a single Rust binary. When run, it immediately covers
every monitor with a layer-shell **overlay** surface hosting a WebKitGTK 6 webview,
and exits on user input. hypridle launches it at idle; hyprlock layers on top ~2 s
later (Omarchy's existing flow, untouched).

Two content modes, same as the Mac app:

- **Channel mode** — load `https://idlescreens.com/channel/<id>`. Live updates
  arrive over the page's own WebSocket (`/c/<id>/ws`); publishing to the channel
  restyles the saver in real time. Falls back to bundled mode if the load fails.
- **Bundled mode** — load the shared offline web build (`file://` + query params),
  the same artifact the Mac app ships (22 savers).

## 2. Repo integration

- Cargo binary crate at `apps/linux/`. **Not** a pnpm workspace member (no
  `package.json`; the `apps/*` glob only matches dirs that have one). An empty
  `[workspace]` table in `Cargo.toml` isolates it from any parent workspace.
  `Cargo.lock` is committed (binaries pin deps).
- Consumes `apps/mac/web/dist/` (index.html + assets/main.js + savers.json) as its
  web bundle, staged into `apps/linux/webroot/` (gitignored) by `scripts/sync-web.sh`.
- Own CI workflow (`.github/workflows/linux-ci.yml`), path-filtered to
  `apps/linux/**` so the main CI is untouched.

## 3. File tree

```
apps/linux/
├── Cargo.toml / Cargo.lock / rustfmt.toml / README.md
├── src/
│   ├── main.rs        # env fixups → CLI → config → GTK app → run; signal handlers
│   ├── cli.rs         # clap derive; `check-updates` subcommand
│   ├── config.rs      # TOML at ~/.config/idle-screens/config.toml + CLI merge → Settings
│   ├── state.rs       # AppState (Rc): seed, mode, web_root, channel_fell_back, windows
│   ├── windows.rs     # per-monitor layer windows, hotplug, fade in/out, --windowed
│   ├── webview.rs     # WebView build, URL builder, load-failed/crash signals, JS bridge
│   ├── idle.rs        # ext-idle-notify watcher (second wl_display connection, own thread)
│   ├── bundle.rs      # web-root resolution + manifest refresh (BundleManager.swift port)
│   └── platform.rs    # NVIDIA detection, XDG paths, env_logger init
├── packaging/
│   ├── PKGBUILD
│   ├── config.toml.example
│   ├── hypridle.conf.example      # hyprlang snippet
│   └── hypridle.lua.example       # new Hyprland Lua-config snippet
├── scripts/
│   ├── sync-web.sh    # pnpm build + mac-web build + rsync dist → webroot/
│   ├── dev-run.sh     # sync-web + cargo run -- --web-root ./webroot --no-update-check "$@"
│   └── make-src-tarball.sh        # crate + webroot → release source tarball
└── webroot/           # gitignored staging of the web bundle
.github/workflows/linux-ci.yml
```

## 4. Dependencies

| Crate | Why |
|---|---|
| `gtk4` (0.9, feature `v4_12`) | windowing; matches Arch gtk4 |
| `webkit6` | gtk-rs bindings for webkitgtk-6.0 |
| `gtk4-layer-shell` | layer-shell surfaces (init before realize) |
| `wayland-client` 0.31 + `wayland-protocols` (staging) | ext-idle-notify-v1 client |
| `clap` (derive) | CLI |
| `serde` + `toml` + `serde_json` | config; savers.json; JS-string escaping |
| `sha2` | bundle integrity |
| `ureq` | blocking HTTP in a worker thread — **no tokio**; GLib main loop + std::thread only |
| `fastrand` | session seed |
| `dirs`, `anyhow`, `log` + `env_logger`, `libc` | XDG paths, errors, logging, SIGTERM |

TO-VERIFY at implementation time: current `webkit6` / `gtk4-layer-shell` crate
versions; whether `wayland-protocols` exposes ext-idle-notify **v2**
(`get_input_idle_notification`, ignores inhibitors). v1 is acceptable for MVP —
our surfaces take no input, so real user input still resets compositor idle.

## 5. Behavior spec

### 5.1 Lifecycle

```
launch → parse CLI → load config → NVIDIA env fixup (before GTK init!)
      → GTK activate → resolve web root → one layer window per monitor
      → all load the same URL (same session seed) → fade in on load-finished
      → idle watcher armed → [Resumed | SIGTERM | SIGINT]
      → fade out (~450 ms) → quit   (+1 s watchdog force-quit)
```

Shutdown must be fast and unconditional — the process can be running underneath
hyprlock, and a stuck saver over a lock screen is the worst failure mode.

### 5.2 Windows (windows.rs)

- `init_layer_shell()` **before realize**; `Layer::Overlay`; anchor all 4 edges;
  `exclusive_zone(-1)` (cover waybar); `KeyboardMode::None` (browse keys deferred);
  `set_monitor()` before first map.
- `--windowed`: plain xdg window instead — dev inside a live session without idling.
- Hotplug: `gdk::Display::monitors()` `GListModel` `items_changed` — added monitor
  joins with the same session seed/URL; removed monitor's window is closed and
  dropped (keyed by connector name).
- Fade: `add_tick_callback` opacity ease-out, ~900 ms in / ~450 ms out (Mac ratios,
  configurable `fade_ms`). Fade-in starts on webview `load-changed == Finished`.
  Black window + webview background — worst case is black, never a white flash.

### 5.3 Webview (webview.rs)

- `set_background_color(black)`; enable WebGL; media playback without gesture;
  suppress context menu.
- `web-process-terminated` → log + reload current URL (Mac watchdog parity).
- `load-failed` → channel fallback (5.5).
- One-way native→JS bridge via `evaluate_javascript` on
  `window.__idleScreensMac.*` (ids JSON-escaped with serde_json). The web bundle
  has **no** web→native messaging — no UserContentManager needed.

### 5.4 URL contract (mirrors SaverController.swift)

- Channel: `https://idlescreens.com/channel/<id>` verbatim (or a full URL passed
  through).
- Bundled:
  `file://<web_root>/index.html?seed=<u32>[&saver=<id>][&cycle=<min>][&brightness=%.2f][&hints=0]`
  — `brightness` emitted only when < 1.0; one session seed shared by every monitor
  so displays render in lockstep.

### 5.5 Channel fallback (global)

On `load-failed`: if channel mode AND failing URI is not `file://` AND not already
fallen back → set `channel_fell_back`, load the bundled URL in **all** windows.
Straight port of the Mac `channelFallback` including the file:// guard.

### 5.6 Exit on input (idle.rs)

Second Wayland connection (`Connection::connect_to_env`) on its own thread —
zero interaction with GTK's Wayland state. Bind `ext_idle_notifier_v1`
(version ≥ 2 if available), create a notification with **~1 s timeout**:

- `Idled` fires → **arm**. (Launched by hypridle at 150 s idle this is immediate;
  launched manually it waits until the hand leaves the mouse — the Mac
  "wake-on-input too aggressive" lesson, solved structurally.)
- `Resumed` while armed → `MainContext::invoke` → shutdown.

SIGTERM/SIGINT (via `glib::unix_signal_add_local`) → same shutdown path
(hypridle `on-resume = pkill -TERM` convention). Shutdown is idempotent
(`shutting_down` flag — Resumed and SIGTERM can race).

### 5.7 Idle inhibitor: **off by default**

On Hyprland, a `zwp_idle_inhibit` inhibitor pauses **all** hypridle listeners —
including lock and DPMS. `--inhibit` exists as an opt-in (deferred milestone;
needs gdk4-wayland surface FFI) with a documented warning.

### 5.8 Bundle resolution & refresh (bundle.rs — BundleManager.swift port)

Resolution order: `--web-root` → cache → shipped (`/usr/share/idle-screens/web`).

- Cache: `~/.local/share/idle-screens/web-cache`. Valid iff `index.html` +
  `assets/main.js` exist AND cached `savers.json` entry count ≥ shipped count
  (anti-downgrade; shipped count read at runtime, simpler than Mac's compiled-in
  count).
- Refresh: GET `https://idlescreens.com/mac/manifest.json` →
  `{version, files:[{path, sha256}]}`. Proceed only if `version >` cached version
  (plain text file next to the cache). Reject absolute paths and any `..` segment.
  Download to `web-cache-staging/`, verify each SHA-256 (lowercase hex), any
  failure aborts + cleans staging. Atomic swap (remove cache, rename staging),
  write version, re-validate, delete if anti-downgrade fails.
- `check-updates` subcommand: blocking, prints result, exit 0/1.
- Launch-time check (`update.check = "launch"`): background std::thread; result
  applies **next** launch — never hot-swap a running session.
- Same `/mac/` bundle the Mac app consumes (safari17-target IIFE runs fine on
  WebKitGTK 2.52) — do not fork the artifact. Server-side rename to `/bundle/`
  is optional later.

### 5.9 NVIDIA (platform.rs)

`webkit.disable_dmabuf = "auto" | "always" | "never"`. Auto = proprietary-driver
detection (`/sys/module/nvidia` or `/proc/driver/nvidia/version`) → set
`WEBKIT_DISABLE_DMABUF_RENDERER=1` **before** GTK/WebKit init. Works around known
WebKitGTK DMA-BUF flicker on NVIDIA.

### 5.10 Logging

`env_logger` → stderr (`RUST_LOG` respected; `-v` = debug). Launched under
hypridle, stderr lands in the user journal — README documents
`journalctl --user -t hypridle` etc.

## 6. Config

`~/.config/idle-screens/config.toml` — every key optional; CLI flags override.

```toml
mode = "savers"            # "savers" | "channel"
channel = "ballet"         # channel id or full URL
saver = ""                 # pin one saver by id (bundled mode)
cycle_minutes = 10         # <= 0 disables cycling
brightness = 1.0           # 0.1..1.0 (night dimming)
hints = true               # false → suppress on-screen saver name
inhibit = false            # opt-in idle inhibitor (WARNING: pauses hypridle lock/DPMS)
fade_ms = 900

[webkit]
disable_dmabuf = "auto"    # "auto" | "always" | "never"

[update]
check = "launch"           # "launch" | "never"
base_url = "https://idlescreens.com/mac/"
```

CLI:

```
idle-screens-wayland [--channel ID|URL] [--saver ID] [--cycle MIN]
                     [--brightness 0.1..1] [--seed U32] [--windowed]
                     [--output NAME] [--web-root DIR] [--inhibit]
                     [--no-update-check] [--config PATH] [-v]
idle-screens-wayland check-updates
```

Running the binary = show immediately (no `--show`; hypridle just execs it).

## 7. hypridle integration (shipped in /usr/share/doc)

hyprlang (`~/.config/hypr/hypridle.conf`) — swap Omarchy's screensaver listener:

```ini
listener {
    timeout = 150
    on-timeout = pidof hyprlock || idle-screens-wayland
    on-resume = pkill -TERM -x idle-screens-wayland
}
```

Plus the equivalent Lua snippet (new Hyprland Lua config). Keep the existing
hyprlock/DPMS listeners untouched — hyprlock's session-lock surface layers above
our overlay by design.

**Try-it-now (Phase 0, zero code):** README leads with the Chromium kiosk recipe
(`chromium --app=https://idlescreens.com/channel/ballet --kiosk
--ozone-platform=wayland` in an hypridle listener) so rendering can be validated
on the PC before the native app lands.

## 8. Packaging & CI

- **PKGBUILD** (AUR `idle-screens-wayland`): `depends=(gtk4 webkitgtk-6.0
  gtk4-layer-shell)`, `makedepends=(rust)`; builds from a release **source tarball
  that already contains the prebuilt `webroot/`** (no node/pnpm in the AUR build).
  Installs `/usr/bin/idle-screens-wayland`, `/usr/share/idle-screens/web/`, doc
  examples.
- Tarball from `scripts/make-src-tarball.sh`; published by a later
  `linux-release.yml` on `linux-v*` tags (mirrors the `mac-v*` convention).
- **CI** (`linux-ci.yml`): `container: archlinux:latest` (matches target; Ubuntu's
  webkitgtk lags) — pacman installs gtk4/webkitgtk-6.0/gtk4-layer-shell/rustup;
  `cargo fmt --check`, `clippy -D warnings`, `cargo build --release --locked`,
  `cargo test` (unit-testable: config merge, manifest path safety, sha verify,
  URL building). Path-filtered; follows ci.yml conventions (checkout@v4,
  `permissions: contents: read`, timeout).

## 9. Dev loop (Mac dev machine + Omarchy PC)

The dev Mac cannot build/run this crate. Loop: push from the Mac → on the PC
`git pull && apps/linux/scripts/dev-run.sh --windowed --channel ballet` →
then drop `--windowed` for real overlay + input-exit testing → report back.

## 10. Milestones

| # | Deliverable | Verify on PC |
|---|---|---|
| 1 | Scaffold + `--windowed` channel view (black bg, no ctx menu) | ballet renders, no white flash |
| 2 | Layer-shell overlay + fade + SIGTERM clean exit | covers waybar; pkill exits; layers under hyprlock |
| 3 | Exit on input (arm-after-Idled watcher) | manual launch survives moving mouse; input after stillness exits; hypridle e2e |
| 4 | Multi-monitor + hotplug + bundled mode (file:// + params, shared seed) | monitors in lockstep; unplug/replug |
| 5 | Config file + NVIDIA auto + crash reload + channel→bundled fallback | bogus channel falls back everywhere; killed WebKitWebProcess self-heals |
| 6 | Bundle refresh port + `check-updates` | live manifest works; tampered hash + downgrade rejected |
| 7 | PKGBUILD + CI + doc snippets + README | CI green; `makepkg -si` installs; hypridle integration works |

Deferred: `--inhibit` implementation, keyboard `on_demand` browse keys, native
cross-monitor cycle timer (only if `?cycle` desyncs on device), ext-idle-notify v2.

## 11. Reference files (contracts being ported)

- `apps/mac/Sources/IdleScreens/BundleManager.swift` — refresh/anti-downgrade
- `apps/mac/Sources/IdleScreens/SaverController.swift` — URL params, seed sync,
  fallback, fade timing
- `apps/mac/web/build.mjs` + `dist/` — the shared web bundle
- `.github/workflows/{ci.yml, mac-release.yml}` — CI/release conventions
