# idle-screens for Wayland (Omarchy / Hyprland)

A native screensaver overlay for Wayland compositors that implement
wlr-layer-shell (Hyprland, Sway, river, …), built for
[Omarchy](https://omarchy.org). One overlay surface per monitor, each hosting a
WebKitGTK 6 webview showing either a live **idlescreens.com channel**
(WebSocket-steered — publish to the channel and the saver morphs in real time)
or the **bundled offline saver engine** (the same 22-saver web build the Mac
app ships). Exits on user input.

Design + spec: [docs/specs/linux-app-spec.md](../../docs/specs/linux-app-spec.md).

## Try it now — zero-code recipe (no build needed)

Omarchy ships Chromium; validate the whole idea with a hypridle listener:

```ini
# ~/.config/hypr/hypridle.conf
listener {
    timeout = 150
    on-timeout = pidof hyprlock || chromium --app=https://idlescreens.com/channel/ballet --kiosk --ozone-platform=wayland
    on-resume = pkill -f 'app=https://idlescreens.com'
}
```

Caveats (why the native app exists): it's a plain window, not an overlay;
Chromium cold-start flashes; Chromium's own idle-inhibit can fight hypridle's
lock/DPMS timers.

## Build & run (dev)

Requires (Arch): `gtk4 webkitgtk-6.0 gtk4-layer-shell libadwaita rustup`,
plus node+pnpm at the repo root for the web bundle.

```bash
cd apps/linux
./scripts/dev-run.sh --windowed --channel ballet   # normal window, in-session
./scripts/dev-run.sh --channel ballet              # real overlay (all monitors)
./scripts/dev-run.sh --saver warp --seed 42        # bundled savers
SKIP_WEB=1 ./scripts/dev-run.sh --windowed         # skip web rebuild
```

`dev-run.sh` stages the shared web bundle into `webroot/` (via
`scripts/sync-web.sh`) and runs with `--web-root ./webroot`.

## Install

```bash
./scripts/make-src-tarball.sh          # builds dist/idle-screens-wayland-<v>-src.tar.gz
# AUR-style: makepkg -si using packaging/PKGBUILD against that tarball
# or manual:
cargo build --release
sudo install -Dm755 target/release/idle-screens-wayland /usr/bin/
sudo mkdir -p /usr/share/idle-screens/web && sudo cp -r webroot/. /usr/share/idle-screens/web/
```

Then wire hypridle — see `packaging/hypridle.conf.example` (hyprlang) or
`packaging/hypridle.lua.example` (new Lua config). The saver runs at 150 s
idle; hyprlock layers on top ~2 s later, untouched.

## Configuration

`~/.config/idle-screens/config.toml` — see `packaging/config.toml.example`.
CLI flags override the file (`idle-screens-wayland --help`).

Update the offline bundle: `idle-screens-wayland check-updates` (SHA-256
verified, anti-downgrade guarded; also checked in the background at launch).

## Behavior notes

- **Exit on input** uses ext-idle-notify: the watcher only arms once you're
  still for ~1 s, so a manual launch doesn't die under your moving mouse. Any
  input after that dismisses. hypridle's `on-resume = pkill -TERM` is a backup.
- **No idle inhibitor by default.** On Hyprland an inhibitor pauses ALL
  hypridle listeners — including lock and DPMS. `--inhibit` exists but is not
  yet implemented; DPMS blanking the saver is the intended default behavior.
- **NVIDIA (proprietary driver):** WebKit's DMA-BUF renderer flickers on some
  setups; it's auto-disabled when the driver is detected. Override with
  `[webkit] disable_dmabuf = "always" | "never"`.
- **Logs**: stderr (`-v` for debug). Under hypridle they land in the user
  journal: `journalctl --user -e | grep idle-screens`.

## Not here on purpose

Idle scheduling (hypridle), locking (hyprlock), launch-at-login, tray UI —
the Linux environment already provides them. This binary just draws and exits.
