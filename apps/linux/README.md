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
| `idle-screens-wayland tray` | StatusNotifier tray (manual launch / updates) |
| `./scripts/make-release.sh` | Build release tarball locally (same as CI) |

## Release (maintainers)

Tag `linux-v0.1.0` on `develop`/`main` to trigger `.github/workflows/linux-release.yml`:

```bash
git tag linux-v0.1.0
git push origin linux-v0.1.0
```

CI builds the binary + web bundle and publishes:

- `idle-screens-wayland-<ver>-x86_64.tar.gz` — installable bundle (`install.sh`)
- `idle-screens-wayland-<ver>-src.tar.gz` — AUR source tarball

Local dry run: `./scripts/make-release.sh`

## Install (production)

### Option A — GitHub release tarball

Download `idle-screens-wayland-<version>-x86_64.tar.gz` from
[GitHub Releases](https://github.com/shaaaaawn/idle-screens/releases) (tag `linux-v*`),
extract, and run:

```bash
./install.sh
```

Installs to `~/.local` by default — **no sudo**. Set `PREFIX=/usr` (or
`/usr/local`) for a system-wide install; the installer only escalates when the
prefix is not writable.

To remove an install (shipped in the same tarball):

```bash
./uninstall.sh          # remove from PREFIX (default ~/.local)
./uninstall.sh --all    # also sweep /usr/local and /usr
./uninstall.sh --purge  # also drop config, device id, and update cache
```

A plain uninstall keeps `~/.config/idle-screens` and the per-machine device id,
so reinstalling does not re-pair the machine.

**Bundle lookup.** The binary searches for the web bundle in this order, taking
the first that contains `index.html` + `assets/main.js`:

1. `$IDLE_SCREENS_WEB` (runtime override, used by `dev-run.sh`)
2. the `IDLE_SCREENS_WEB_DIR` build-time override
3. `~/.local/share/idle-screens/web` (user-local install)
4. `/usr/local/share/idle-screens/web`
5. `/usr/share/idle-screens/web` (packaged install)

A user-local install therefore wins over a leftover system one. Before this
order existed, `/usr/share` was the only default while `install.sh` honored
`PREFIX` for the bundle — so a rootless install put the bundle where the binary
never looked and silently rendered whichever stale bundle a previous system
install had left behind.

### Option B — manual (from source)

```bash
cd apps/linux
./scripts/sync-web.sh
cargo build --release --locked
sudo install -Dm755 target/release/idle-screens-wayland /usr/bin/
sudo mkdir -p /usr/share/idle-screens/web
sudo cp -r webroot/. /usr/share/idle-screens/web/
```

### Option C — PKGBUILD / AUR-style

```bash
./scripts/make-src-tarball.sh
makepkg -si   # using packaging/PKGBUILD
```

### Omarchy integration

```bash
# From an extracted release tarball — detects your Omarchy and wires it up:
./packaging/omarchy/install-omarchy.sh
```

Omarchy has shipped **two** different idle mechanisms, and the wiring differs.
The installer detects which is present and supports both; they are safe to
install together, since each is inert when it is not the one driving the
session.

| Omarchy | Idle mechanism | How idle-screens hooks in |
| --- | --- | --- |
| 4.x (current) | Quickshell idle service (`omarchy-shell`) | Cloned `omarchy.idle` plugin |
| Older | `hypridle` | Patched `~/.config/hypr/hypridle.conf` |

**Current Omarchy.** The idle service runs `omarchy-launch-screensaver` and
offers no config key for *which* screensaver to run.

PATH shadowing does **not** work here, despite looking like the obvious fix.
Omarchy's `default/bash/env-bootstrap` deliberately *appends* `~/.local/bin`
— "appended so system binaries keep precedence" — so a shim there can never
beat the packaged `omarchy-launch-screensaver`. Editing the packaged plugin is
also out, since `omarchy update` reverts it.

The supported override is `omarchy plugin clone`, which copies a first-party
plugin into `~/.config/omarchy/plugins/<user>.<id>` and switches the shell to
it. `install-omarchy-plugin.sh` clones `omarchy.idle` and repoints its
screensaver command at `omarchy-idle-screens`.

> **Trade-off:** the clone is a fork. It stops receiving upstream fixes to the
> idle service until you re-clone it. Revert with
> `omarchy plugin remove <user>.idle && omarchy plugin enable omarchy.idle`.

That service also tracks the screensaver by **window class**, and cancels the
idle cycle — so the screen never locks — if it cannot see a window of class
`org.omarchy.screensaver`. `omarchy-idle-screens` therefore launches with
`--app-id org.omarchy.screensaver`. Set `app_id` in `config.toml` (or pass
`--app-id`) to override.

`omarchy-idle-screens` also prefers the `idle-screens-wayland` sitting next to
it over whatever `PATH` resolves, for the same precedence reason: a stale
`/usr/bin` copy would otherwise shadow a user-prefix install, and an older
binary rejects `--app-id` outright, so the saver would never start.

**Older Omarchy.** `install-hypridle.sh` points the screensaver listener at
`omarchy-idle-screens` and adds an `on-resume` kill. Manual snippet:
`packaging/omarchy/hypridle.listener.snippet`.

Both paths also install the tray autostart entry and seed
`~/.config/idle-screens/config.toml`, which is the single source of truth for
mode/channel — the launcher passes no overrides.

> **Dismissal commands:** use `pkill -f '[i]dle-screens-wayland'`, not
> `pkill -x idle-screens-wayland`. The kernel truncates a process name to 15
> characters (`idle-screens-wa`), so the `-x` form silently never matches and
> the saver is never dismissed. The `[i]` bracket keeps `pkill`'s own shell
> from matching itself. `pidof idle-screens-wayland` is fine — it resolves
> through the executable path.

### System tray

```bash
idle-screens-wayland tray          # StatusNotifier icon (Waybar tray)
```

Menu: show saver, kiosk mode, check updates, open config, quit tray.
Autostart: `~/.config/autostart/idle-screens-tray.desktop` (installed by
`install.sh`, which writes an **absolute** `Exec=` path). Two things make the
tray survive login on Omarchy, both learned the hard way:

- systemd's `xdg-autostart-generator` resolves `Exec=` when it generates the
  unit, early enough that `~/.local/bin` is not reliably on its PATH. A bare
  `Exec=idle-screens-wayland` yields *no unit at all*, or binds to a stale
  `/usr/bin` copy.
- The tray retries registration for up to 5 minutes. Under uwsm the autostart
  unit races the bar that owns `org.kde.StatusNotifierWatcher` (Quickshell on
  Omarchy); a single attempt loses that race and exits 1 with
  "The name is not activatable", so the tray silently never appears.

Check it with `systemctl --user status 'app-idle\x2dscreens\x2dtray@autostart.service'`.

Idle-triggered launch is handled by the Quickshell idle service or hypridle
(whichever your Omarchy uses); the tray is for manual control.

### Wire hypridle (non-Omarchy)

Add to `~/.config/hypr/hypridle.conf` (see `packaging/hypridle.conf.example`
for hyprlang, or `packaging/hypridle.lua.example` for Lua config):

```ini
listener {
    timeout = 150
    on-timeout = pidof hyprlock || idle-screens-wayland
    on-resume = pkill -TERM -f '[i]dle-screens-wayland'
}
```

The saver runs at 150 s idle; hyprlock layers on top ~2 s later, untouched.

### Kiosk mode (mouse doesn't dismiss)

Two things dismiss the saver today: the app's idle watcher **and** hypridle's
`on-resume = pkill …`. Kiosk needs both disabled.

**1. Config or flag:**

```toml
# ~/.config/idle-screens/config.toml
kiosk = true
```

or pass `--kiosk` on the command line.

**2. hypridle listener without `on-resume`** (see `packaging/hypridle-kiosk.conf.example`):

```ini
listener {
    timeout = 150
    on-timeout = pidof idle-screens-wayland || idle-screens-wayland --kiosk
}
```

Exit manually when needed:

```bash
pkill -TERM -f '[i]dle-screens-wayland'
```

Or bind a Hyprland shortcut to that command. `--windowed` dev mode also ignores
mouse for exit, but draws a normal window instead of a fullscreen overlay.

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

Idle scheduling (hypridle), locking (hyprlock), launch-at-login beyond tray
autostart — the Linux environment already provides most of this. The binary
draws the overlay and exits; the tray adds manual launch and updates only.
