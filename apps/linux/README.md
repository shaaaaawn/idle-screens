# idle-screens for Wayland (Omarchy / Hyprland)

A native screensaver overlay for Wayland compositors that implement
wlr-layer-shell (Hyprland, Sway, river, …), built for
[Omarchy](https://omarchy.org). One overlay surface per monitor, each hosting a
WebKitGTK 6 webview showing either a live **idlescreens.com channel**
(WebSocket-steered — publish to the channel and the saver morphs in real time)
or the **bundled offline saver engine** (the same 22-saver web build the Mac
app ships). Exits on user input (overlay mode only).

> **Branch:** the Linux app lives on the `develop` branch today (`apps/linux/`).

## Prerequisites (Arch / Omarchy)

Native runtime dependencies:

```bash
sudo pacman -S --needed base-devel rustup \
  gtk4 webkitgtk-6.0 gtk4-layer-shell libadwaita
rustup default stable
```

For building the web bundle (first run / after saver changes), you also need
Node and pnpm at the repo root. Any of these work:

```bash
# preferred — repo pins pnpm 9 via packageManager
corepack enable pnpm && pnpm install

# or let the scripts fall back automatically
npx --yes pnpm@9 install   # from repo root
```

Verify native deps:

```bash
cd apps/linux
./scripts/check-deps.sh
```

## First-time setup

From a fresh clone on `develop`:

```bash
git checkout develop
cd idle-screens

# node deps (once)
pnpm install          # or: npx --yes pnpm@9 install

# build + stage the web bundle, compile the binary
cd apps/linux
./scripts/check-deps.sh
./scripts/dev-run.sh --windowed --saver warp
```

`dev-run.sh` calls `scripts/sync-web.sh` (builds packages + mac-web →
`webroot/`), then runs `cargo run` with `--web-root ./webroot`.

Skip the web rebuild on subsequent runs:

```bash
SKIP_WEB=1 ./scripts/dev-run.sh --windowed --saver warp
```

## Dev commands

| Command | What |
| --- | --- |
| `./scripts/dev-run.sh --windowed --saver warp` | Normal window for in-session testing; **does not** exit on mouse move |
| `./scripts/dev-run.sh --windowed --channel ballet` | Windowed channel viewer |
| `./scripts/dev-run.sh --saver warp --seed 42` | Real fullscreen overlay on all monitors |
| `SKIP_WEB=1 ./scripts/dev-run.sh …` | Skip web bundle rebuild |
| `cargo test` | Unit tests (config, bundle paths, URL builder) |
| `cargo build --release` | Production binary → `target/release/idle-screens-wayland` |

## Install (production)

### Option A — manual

```bash
cd apps/linux
./scripts/sync-web.sh              # or use a release tarball that includes webroot/
cargo build --release --locked
sudo install -Dm755 target/release/idle-screens-wayland /usr/bin/
sudo mkdir -p /usr/share/idle-screens/web
sudo cp -r webroot/. /usr/share/idle-screens/web/
sudo install -Dm644 packaging/config.toml.example \
  -t /etc/skel/.config/idle-screens/   # optional: seed default config
```

### Option B — PKGBUILD / AUR-style

```bash
./scripts/make-src-tarball.sh        # → dist/idle-screens-wayland-<v>-src.tar.gz
# point packaging/PKGBUILD source= at the tarball, then:
makepkg -si
```

### Wire hypridle

Add to `~/.config/hypr/hypridle.conf` (see `packaging/hypridle.conf.example`
for hyprlang, or `packaging/hypridle.lua.example` for Lua config):

```ini
listener {
    timeout = 150
    on-timeout = pidof hyprlock || idle-screens-wayland
    on-resume = pkill -TERM -x idle-screens-wayland
}
```

The saver runs at 150 s idle; hyprlock layers on top ~2 s later, untouched.

## Configuration

`~/.config/idle-screens/config.toml` — see `packaging/config.toml.example`.
CLI flags override the file (`idle-screens-wayland --help`).

Update the offline bundle: `idle-screens-wayland check-updates` (SHA-256
verified, anti-downgrade guarded; also checked in the background at launch).

## Behavior notes

- **Exit on input (overlay mode):** uses `ext-idle-notify-v1`. The watcher
  arms once you've been still for ~1 s, then any input dismisses the saver.
  hypridle's `on-resume = pkill -TERM` is a backup. When hypridle launches
  the saver you're already idle, so the first mouse move wakes the session.
- **`--windowed` dev mode:** the idle input watcher is **disabled**. Close the
  window with your window manager (Alt+F4) or Ctrl+C the terminal process.
  **← / →** browse savers, **Esc** exits. Click the window first if keys don't
  respond.
  The overlay omits the browse hint — it uses `KeyboardMode::None` so keys
  wake the session instead of reaching the webview (unlike the Mac app, which
  routes ←/→ natively while showing).
- **No idle inhibitor by default.** On Hyprland an inhibitor pauses ALL
  hypridle listeners — including lock and DPMS. `--inhibit` exists but is not
  yet implemented; DPMS blanking the saver is the intended default behavior.
- **NVIDIA (proprietary driver):** WebKit's DMA-BUF renderer flickers on some
  setups; it's auto-disabled when the driver is detected. Override with
  `[webkit] disable_dmabuf = "always" | "never"`.
- **Logs:** stderr (`-v` for debug). Under hypridle they land in the user
  journal: `journalctl --user -e | grep idle-screens`.

## Troubleshooting

### `Permission denied` on `target/debug/.cargo-lock`

The `target/` directory was probably built as root (e.g. inside Docker). Fix
ownership or delete and rebuild:

```bash
sudo chown -R "$USER:$USER" target
# or
rm -rf target && cargo build
```

### `pnpm: command not found`

Install pnpm at the repo root (`corepack enable pnpm && pnpm install`), or rely
on the automatic `npx pnpm@9` fallback in `scripts/sync-web.sh`.

### Blank / failed load (`file:///webroot/...`)

Pass an absolute web root, or use `./scripts/dev-run.sh` which passes
`--web-root ./webroot` (canonicalized internally). Ensure `webroot/index.html`
exists — run `./scripts/sync-web.sh` once.

### Window closes when I move the mouse (windowed dev)

Use `--windowed`; overlay mode is meant to dismiss on input. If you're testing
the real overlay manually, pause for ~1 s before moving — that's when the
watcher arms.

## Try it without building (Chromium shortcut)

Omarchy ships Chromium; validate the idea with a hypridle listener:

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

## Not here on purpose

Idle scheduling (hypridle), locking (hyprlock), launch-at-login, tray UI —
the Linux environment already provides them. This binary just draws and exits.
