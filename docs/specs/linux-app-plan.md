# Linux app support — plan & options

Target: stream an idlescreens.com channel as a screensaver on Linux, starting
with **Omarchy** (DHH's Arch + Hyprland distro) and generalizing to other
Wayland compositors later. X11 is explicitly out of scope for v1 (see
"Why Wayland-first", below).

Status: **proposal** — researched 2026-07, not yet started.

---

## What we learned about Omarchy (this changes the plan)

Omarchy **already has a screensaver system**, and it's a plug-in point:

- `~/.config/hypr/hypridle.conf` has a screensaver listener at **150 s idle**
  that runs `pidof hyprlock || omarchy-launch-screensaver`, then a lock
  listener ~2 s later (hyprlock draws *on top* of the saver).
- `omarchy-launch-screensaver` is a plain shell script on `$PATH`: it launches
  a fullscreen terminal per monitor (class `org.omarchy.screensaver`) running
  `omarchy-screensaver` (Terminal Text Effects ASCII animations), iterating
  `hyprctl monitors -j`. It exits on any input and respects a user toggle
  (`omarchy-toggle-enabled screensaver-off`).

So on Omarchy the integration is *culturally sanctioned*: replace the command
hypridle runs on idle. No portals, no permissions, no daemon of our own needed
for v1. The lock story is also already solved — hyprlock layers on top of
whatever the saver drew, ~2 s later.

**Watch out:** Omarchy's dev branch is migrating Hyprland configs from
hyprlang `.conf` to Hyprland's new Lua config (0.55+). Any config snippets we
generate should support both syntaxes.

## How the Mac app maps to Linux

The Mac app (`apps/mac`, ~2,200 lines of Swift) is a thin native shell around
the shared web bundle. Every component has a Wayland equivalent:

| Concern | macOS (today) | Linux/Wayland equivalent |
|---|---|---|
| Idle detection | `CGEventSource.secondsSinceLastEventType` poll | `ext-idle-notify-v1` protocol (Hyprland implements it; any client can bind it — no permission) — or simply let hypridle exec us |
| Fullscreen overlay per display | borderless `NSWindow` at `.screenSaver` level | `zwlr_layer_shell_v1` **overlay** layer, one surface per `wl_output`, anchored to all edges, `exclusive_zone = -1` |
| Web rendering | `WKWebView` | **WebKitGTK 6.0** (`webkitgtk-6.0` in Arch extra) inside a GTK4 window via **gtk4-layer-shell** |
| Wake on input | local event monitor dismisses overlay | dismiss on ext-idle-notify `resumed` event (don't grab input ourselves) |
| Keep display awake | display-sleep IOKit assertion | `zwp_idle_inhibit_manager_v1` — **but see the DPMS tension below** |
| Channel mode | `WKWebView` loads `idlescreens.com/channel/<id>` | identical URL, identical fallback logic |
| Offline fallback | bundled web build in the .app | same bundle installed to `/usr/share/idle-screens/web/` |
| Menu bar UI | `NSStatusItem` menu | none for v1 — config file + CLI flags (Omarchy has no tray convention); optional waybar module later |
| Launch at login | `SMAppService` | not needed — hypridle launches us on demand |
| Packaging | signed/notarized DMG + Homebrew cask | AUR package (`idle-screens-git`), later a binary `-bin` package |

Key simplification vs. the Mac app: on Linux **we don't own the idle loop or
the lifecycle** — hypridle does. The app can be a "show yourself, die on
input" process, which is much smaller than the Mac app.

---

## Options

### Option A — Zero-code recipe (works today, ~30 minutes)

Ship nothing; document a config. Omarchy already has Chromium:

```ini
# ~/.config/hypr/hypridle.conf
listener {
    timeout = 150
    on-timeout = pidof hyprlock || chromium --app=https://idlescreens.com/channel/ballet --kiosk --ozone-platform=wayland --class=org.omarchy.screensaver
    on-resume = pkill -f 'app=https://idlescreens.com'
}
```

* **Pros:** zero code; validates the whole idea end-to-end this week; uses the
  browser's GPU stack (best-tested Wayland path); Omarchy's window rules for
  `org.omarchy.screensaver` may already apply (fullscreen, no animations).
* **Cons:** it's an xdg-shell window, not an overlay — a notification or
  focus-stealing window can appear above it; Chromium cold-start is slow
  (visible flash of browser chrome/white); Chromium may hold its own
  idle-inhibit and **fight hypridle's lock/DPMS timers** (this exact bug hit
  Omarchy with Chromium 146); one process per monitor needs scripting like
  `omarchy-launch-screensaver` does; no offline fallback.
* **Verdict:** do this immediately as the validation step and README recipe,
  but it's not the product.

### Option B — Native shell: GTK4 + gtk4-layer-shell + WebKitGTK 6 (recommended)

A small native binary, `idle-screens-wayland` (C, Rust, or Vala — all three
have maintained bindings for this stack). Prior art proves every piece:

- **hyprsaver** (Rust, active 2026) is the exact architecture with a GLSL
  renderer instead of a webview: overlay layer surface per monitor, launched
  by hypridle, dismissed on input, coexists with hyprlock.
- **Glimpse** proves WebKitGTK 6 renders inside gtk4-layer-shell surfaces on
  Hyprland specifically.

Behavior:

1. On launch, enumerate `GdkMonitor`s; create one layer-shell window per
   monitor (overlay layer, all-edges anchor, `exclusive_zone -1`, keyboard
   interactivity `none`).
2. Each hosts a WebKitGTK webview loading the channel URL (or the bundled
   offline build — same self-heal fallback the Mac app has).
3. Exit on ext-idle-notify-v2 `resumed` (input-idle variant, which ignores
   inhibitors), or on SIGTERM from hypridle's `on-resume`.
4. Monitor hotplug: watch the `GListModel` of monitors, add/remove surfaces.

* **Pros:** true overlay (nothing renders above it except the session lock);
  instant start (no browser chrome); one process for all monitors; same
  saver+seed sync across displays like the Mac app; ~10–20 MB binary + shared
  system WebKitGTK (already common on Arch); all deps in Arch **extra**
  (`webkitgtk-6.0`, `gtk4-layer-shell`).
* **Cons:** WebKitGTK's DMA-BUF renderer has **known flicker/blank issues on
  NVIDIA proprietary drivers** — must ship a
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` fallback toggle and detect NVIDIA;
  gtk4-layer-shell occasionally breaks on new GTK4 releases (rolling-release
  risk on Arch; pin/test in CI); a new language/toolchain in the repo
  (recommend **Rust** — `gtk4-rs` + `webkit6` + `gtk4-layer-shell` crates,
  matches hyprsaver's ecosystem).
* **Verdict:** the real port. Small (est. well under the Mac app's 2,200
  lines since hypridle owns idle + lifecycle), idiomatic on Hyprland, and the
  webview is the same engine family as the Mac's WKWebView (both WebKit) so
  saver rendering behavior should match closely.

### Option C — Tauri or Electron cross-platform shell

* **Tauri v2: not viable.** wry/tao still sit on GTK3 + webkit2gtk-4.1; the
  GTK4 migration is an open issue, and layer-shell needs the surface
  configured *before mapping*, which tao does too early. No maintained
  layer-shell plugin exists. You'd get a plain fullscreen window — Option A's
  weaknesses with Option B's build complexity.
* **Electron:** native Wayland is default since ~38.2, but xdg-toplevel only
  (no layer-shell), ~250 MB disk, high RAM — wrong shape for an always-idle
  utility on a minimalist distro.
* **Verdict:** skip. Revisit only if we someday want one codebase for a
  Windows port too.

### Option D — Be the lock screen (ext-session-lock)

Render web content *as* the lock screen via `ext-session-lock-v1` (
gtk4-layer-shell exposes this protocol too), or via `swaylock-plugin` which
runs any layer-shell client as the lock background.

* **Pros:** saver keeps showing while locked (the Mac app can't even do this).
* **Cons:** only one lock client per session — we'd **replace hyprlock**, and
  with it Omarchy's themed lock UX and PAM handling; security-critical code
  (a crashed locker = unlocked session); swaylock-plugin is explicitly less
  battle-tested.
* **Verdict:** not v1. The Omarchy model (saver on overlay layer, hyprlock
  2 s later on top) already composes correctly with Option B.

### Why Wayland-first (and X11 maybe never)

Omarchy is Wayland/Hyprland. The X11 path would be a different codebase
(xscreensaver hack protocol or a fullscreen override-redirect window +
XScreenSaver extension idle detection) for a shrinking audience — even
xscreensaver itself now has preliminary Wayland support (6.11: blanking only,
via ext-idle-notify). If demand appears, an X11 shell can reuse the same web
bundle; nothing in the plan forecloses it.

---

## The DPMS / lock tension (design decision needed)

On the Mac we hold a display-sleep assertion while the saver shows. On
Hyprland, the equivalent (`zwp_idle_inhibit_manager_v1`) **pauses hypridle's
v1-idle listeners entirely** — including the lock-after-152s and
display-off/suspend timers. hypridle has no option to ignore Wayland-protocol
inhibitors (only dbus/systemd ones).

Recommended default: **do not hold an idle inhibitor.** Let Omarchy's
lock and DPMS listeners fire on their own schedule; the saver simply dies when
the screen goes dark or on resume. Offer `--inhibit` as an opt-in flag with a
README warning that it delays lock/suspend. This matches the incumbent
(`omarchy-screensaver` doesn't inhibit either) and respects the user's
security posture.

Related gotcha from Omarchy's tracker: launching a saver must not synthesize
input events, or it resets hypridle's timer and the lock never comes.

## Streaming a channel: what the server already gives us

Nothing server-side is needed. `https://idlescreens.com/channel/<id>` is the
fullscreen viewer (WebSocket live-updates at `/c/<id>/ws`); it's what the Mac
app's channel mode loads today. Viewport-unit specs (now the default) mean the
same scene scales correctly from a laptop to a 4K monitor.

---

## Phased plan (Option B)

**Phase 0 — recipe (no code).** Add `docs/linux-recipe.md` with the Option A
hypridle + Chromium kiosk config, tested on the Omarchy box. Validates
rendering, GPU behavior, and the hypridle wiring before any native work.

**Phase 1 — MVP shell.** `apps/linux/` — Rust binary:
layer-shell surface per monitor, WebKitGTK webview, channel URL from
`~/.config/idle-screens/config.toml` (or `--channel <id>` flag), exit on
resume/SIGTERM. Install doc: two-line hypridle listener change. NVIDIA
detection → DMA-BUF fallback env var.

**Phase 2 — parity features.** Bundled offline build + channel-fail
self-heal (port `host-controller.ts` wiring — the web side is already shared);
`--show` debug flag; fade-in (layer surfaces support alpha); config for
per-monitor channels.

*Local savers work identically to the Mac app.* The bundled web build
(`apps/mac/web` — rename to `apps/web-host`?) is engine-agnostic HTML/JS;
WebKitGTK loads it from `/usr/share/idle-screens/web/` the way WKWebView loads
it from the .app bundle. The native↔JS bridge ports 1:1
(`WKScriptMessageHandler` → `WebKitUserContentManager` script messages), so
saver cycling, seed sync, and channel fallback reuse the shared
`host-controller.ts`. Caveats: overlay browse keys (←/→/F) need keyboard
interactivity `on_demand` (Hyprland focus quirks — defer past MVP), and
WebKitGTK's WebGPU is experimental so the fluid saver takes its canvas2d
fallback automatically.

**Phase 3 — Omarchy integration + packaging.** AUR package; an
`omarchy-launch-screensaver`-compatible wrapper script so users can swap it in
with one line; PR or discussion upstream in basecamp/omarchy if it proves
solid (they take screensaver contributions — the tte saver went through the
same door).

**Phase 4 (optional) — broader Wayland.** Test on Sway/river (same
layer-shell + ext-idle-notify stack); GNOME/KDE need different approaches
(no wlr-layer-shell on Mutter) — likely "kiosk window" degraded mode, decide
if worth it.

## Open questions

1. **Language for the shell** — Rust (hyprsaver precedent, best crates story)
   vs C/Vala (smaller toolchain). Recommend Rust.
2. **One webview per monitor vs one shared** — layer-shell requires a surface
   per output; each needs its own webview. For channel mode each connects as a
   separate viewer (fine — the Mac app does the same per display).
3. **Where the offline bundle comes from** — reuse the `/mac/` parity bundle
   idle-server already hosts (rename to `/bundle/`?), or package it in the AUR
   build from the repo.
4. **Thumbnails/casting** — the Mac app's "Cast this Mac" posts JSON-RPC to
   `/mcp`; trivial to port (one HTTP POST) but defer until someone asks.

## Sources

- Omarchy hypridle config & screensaver script: `basecamp/omarchy`
  (`config/hypr/hypridle.conf`, `bin/omarchy-launch-screensaver`)
- hyprsaver (architecture template): github.com/maravexa/hyprsaver
- Glimpse (WebKitGTK 6 + gtk4-layer-shell proof): github.com/hazat/glimpse
- Protocols: wayland.app — `ext-idle-notify-v1` (v2 adds input-idle),
  `zwlr_layer_shell_v1`, `zwp_idle_inhibit_manager_v1`, `ext-session-lock-v1`
- WebKitGTK NVIDIA DMA-BUF issues: WebKit bugs 260453 / 262607
- Chromium idle-inhibit vs hypridle: basecamp/omarchy issue #5092
- Tauri GTK4/layer-shell blockers: tauri #12561, wry #1228, tao #925
- xscreensaver 6.11 Wayland status: jwz.org/blog (2025-07)
