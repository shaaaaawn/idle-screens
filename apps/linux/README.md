# idle-screens for Wayland

A native screensaver overlay for Wayland compositors that implement
wlr-layer-shell. One overlay surface per monitor, each hosting a WebKitGTK 6
webview showing either a live **idlescreens.com channel** (WebSocket-steered —
publish to the channel and the saver morphs in real time) or the **bundled
offline saver engine** (the same web build the Mac app ships — 32 savers as of
today; `apps/mac/web/src/savers.ts` is the source of truth). Exits on user
input (overlay mode only).

> **Branch:** the Linux app lives on the `develop` branch today (`apps/linux/`).

## Does this run on my system?

Two independent questions, and only one of them is about your distro.

**Your distro** almost certainly works. The app links three system libraries and
nothing else cares which package manager installed them. Installing a release
tarball needs only those libraries — `install.sh` checks and names them for you.
Building from source needs their `-dev` headers, which `./scripts/check-deps.sh`
probes for by pkg-config module name.

**Your compositor** is the real constraint. The overlay is a wlr-layer-shell
surface, and not every compositor implements that protocol:

| Session | Overlay screensaver | `--windowed` |
| --- | --- | --- |
| wlroots-family — sway, Hyprland, river, **labwc**, wayfire | ✅ | ✅ |
| KDE Plasma (Wayland) | ✅ (untested) | ✅ |
| GNOME (Wayland) | ❌ Mutter does not implement layer-shell | ✅ plain window |
| Anything on X11 | ❌ | ✅ plain window |

GNOME's position on layer-shell is long-standing and deliberate, so this is not
a bug we can fix from here. Starting the overlay without it exits immediately
with an error naming this table.

Status by target: **Arch/Omarchy (Hyprland) on x86_64** is the one that has been
run on real hardware. **Raspberry Pi OS Trixie (labwc) on aarch64** builds and
passes its tests in CI on a native arm64 runner, but has not yet been run on a
Pi — so treat the Pi notes below as carefully-reasoned, not battle-tested.

## Quick start

A Raspberry Pi 5 on Pi OS Trixie, start to finish. Substitute your package
manager and idle installer elsewhere — the shape is the same on every distro.

> **No binary release exists yet.** No `linux-v*` tag has been cut, so step 2
> has nothing to fetch until one is. Until then use
> [Building from source](#building-from-source) instead; its build and install
> steps differ from this release-tarball flow (on a Pi, build with
> `cargo build --release --locked -j2`).

```bash
# 1. runtime libraries (no compiler needed — this is a prebuilt binary)
sudo apt update && sudo apt install -y \
  libgtk-4-1 libwebkitgtk-6.0-4 libgtk4-layer-shell0

# 2. the aarch64 release tarball (set VER to the linux-v* tag you want)
VER=0.1.0
curl -LO "https://github.com/shaaaaawn/idle-screens/releases/download/linux-v${VER}/idle-screens-wayland-${VER}-aarch64.tar.gz"
tar -xzf "idle-screens-wayland-${VER}-aarch64.tar.gz"
cd "idle-screens-wayland-${VER}-aarch64"

# 3. install, then see it right now in a window
./install.sh
idle-screens-wayland --windowed --channel ballet

# 4. wire it to your idle daemon so it appears on its own
./packaging/swayidle/install-swayidle.sh
```

Step 3 is the honest smoke test: if a channel renders in a window, the only
thing left is idle wiring. If it does not, jump to
[Troubleshooting](#troubleshooting) rather than debugging swayidle.

## Install

### Option A — GitHub release tarball

**Runtime dependencies.** A release binary needs three shared libraries and no
toolchain:

```bash
# Debian / Ubuntu / Raspberry Pi OS
sudo apt install -y libgtk-4-1 libwebkitgtk-6.0-4 libgtk4-layer-shell0
# Arch (no split -dev packages)
sudo pacman -S --needed gtk4 webkitgtk-6.0 gtk4-layer-shell
```

`install.sh` checks for exactly these before it touches anything, and prints the
right line for your distro if any are missing — so you can also just run it and
do what it says.

Download `idle-screens-wayland-<version>-<arch>.tar.gz` from
[GitHub Releases](https://github.com/shaaaaawn/idle-screens/releases) (tag
`linux-v*`) — `x86_64` for a PC, `aarch64` for a Raspberry Pi — extract, and run:

```bash
./install.sh
```

> Nothing is published yet — the first `linux-v*` tag has not been cut. Use
> Option B or C until it is.

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

Needs the build dependencies from [Building from source](#building-from-source),
not just the runtime ones above.

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

## Idle integration

The binary draws an overlay and exits — it does not schedule itself. Something in
your session has to launch it at idle and dismiss it on resume. Which "something"
depends on your desktop:

| Session | Idle daemon | Wire it up with |
| --- | --- | --- |
| Omarchy 4.x | Quickshell idle service | `./packaging/omarchy/install-omarchy.sh` |
| Hyprland, older Omarchy | `hypridle` | `./packaging/omarchy/install-hypridle.sh` |
| sway, **labwc**, wayfire, **Raspberry Pi OS** | `swayidle` | `./packaging/swayidle/install-swayidle.sh` |
| anything else | yours | Run `idle-screens-wayland` from your own idle hook; dismiss with `pkill -TERM -f '[i]dle-screens-wayland'` |

`install.sh` detects which of these is present and points you at the right one.

> **Dismissal commands:** use `pkill -f '[i]dle-screens-wayland'`, not
> `pkill -x idle-screens-wayland`. The kernel truncates a process name to 15
> characters (`idle-screens-wa`), so the `-x` form silently never matches and
> the saver is never dismissed. The `[i]` bracket keeps `pkill`'s own shell
> from matching itself. `pidof idle-screens-wayland` is fine — it resolves
> through the executable path. **Exception — swayidle:** its own command line
> contains the saver command, so `-f` would match and kill swayidle itself; the
> swayidle snippet uses `pkill -x idle-screens-wa` (the truncated name) instead.

### swayidle (sway / labwc / wayfire / Raspberry Pi OS)

```bash
./packaging/swayidle/install-swayidle.sh
```

Unlike hypridle, **swayidle has no config file** — it is configured entirely by
its command line, wherever your session launches it. The installer finds that
launch site (`~/.config/labwc/autostart` and friends), copies it out of `/etc/xdg`
first if that is where it lives, and extends the existing invocation. It never
starts a second swayidle: there is one process and it owns every timeout.

**The ordering rule.** Your saver timeout must be strictly *smaller* than the
display-blank (`wlopm`/DPMS) timeout, or the panel powers off seconds after the
overlay appears and the saver runs behind a dark screen. Pi OS ships a short
blank timeout, so the installer raises any timeout that is not already above the
saver's. Tune with `SAVER_TIMEOUT=` / `BLANK_TIMEOUT=` (defaults 150 / 900), or
apply `packaging/swayidle/swayidle.snippet` by hand.

After editing, restart swayidle — `labwc --reconfigure` does **not** re-run
autostart, so a reconfigure is not enough.

### Omarchy

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

### hypridle by hand (non-Omarchy Hyprland)

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

Two things dismiss the saver: the app's idle watcher **and** your idle daemon's
resume hook. Kiosk needs both disabled.

**1. Config or flag:**

```toml
# ~/.config/idle-screens/config.toml
kiosk = true
```

or pass `--kiosk` on the command line.

**2. An idle listener with no resume hook.**

hypridle (see `packaging/hypridle-kiosk.conf.example`):

```ini
listener {
    timeout = 150
    on-timeout = pidof idle-screens-wayland || idle-screens-wayland --kiosk
}
```

swayidle — `KIOSK=1 ./packaging/swayidle/install-swayidle.sh`, or by hand. Note
the `wlopm` blanking pair is dropped as well; leaving it in would sleep the panel
behind a saver that nothing will dismiss:

```sh
swayidle -w \
  timeout 150 'pgrep -x idle-screens-wa || idle-screens-wayland --kiosk &' &
```

Exit manually when needed:

```bash
pkill -TERM -f '[i]dle-screens-wayland'
```

Or bind a compositor shortcut to that command. `--windowed` dev mode also ignores
mouse for exit, but draws a normal window instead of a fullscreen overlay.

## Raspberry Pi OS Trixie (labwc)

See [Quick start](#quick-start) for the copy-pasteable version; this section is
the reasoning behind it.

The Pi is a supported target: labwc is wlroots-based, and trixie's apt has all
three native libraries for arm64. Use the `aarch64` release tarball, or build on
the Pi with `cargo build --release --locked -j2` — the `-j2` matters, since gtk4
and webkit6 codegen can OOM the box at full parallelism. Do **not** run
`sync-web.sh` there; build the web bundle on a dev machine and rsync `webroot/`
across, so Node never has to touch the Pi.

Idle wiring is the swayidle path above. For a wall display, add `kiosk = true`
to `config.toml` and re-run the installer with `KIOSK=1`, which also drops the
`wlopm` blanking pair — otherwise the panel sleeps behind a saver that nothing
will dismiss.

WebKit's DMA-BUF renderer is auto-disabled on Broadcom V3D, the same treatment
the NVIDIA proprietary driver gets. If your Pi actually renders more smoothly
with it on, set `[webkit] disable_dmabuf = "never"`; the launch log names which
branch fired.

**Saver gating.** This is handled for you in bundled mode. Mesa V3D advertises
WebGL2 on a Pi and is not lying — it just cannot drive three.js at fullscreen —
so the app detects Broadcom V3D and tells the host page
`?maxBackend=canvas2d`. The page then drops savers it cannot afford (on a Pi:
metaquarium plus the `medium`-cost scenes) and logs each exclusion with a reason.
A frame watchdog also steps down to a cheaper saver if frames stay worse than
30fps, so a heavy bundled scene degrades instead of becoming a slideshow.

Override it if a medium-cost scene runs fine on your box:
`[webkit] max_backend = "never"` trusts the browser, or pin a backend name.
See `packaging/config.toml.example`.

**Channel mode still lacks this.** The hosted viewer at idlescreens.com is
idle-server's, not ours, so a metaquarium *channel* on a Pi will still crawl or
fall back to a CSS placeholder. Point a Pi at schema-scene channels, which render
on 2D canvas.

## Configuration

`~/.config/idle-screens/config.toml` — see `packaging/config.toml.example`.
CLI flags override the file (`idle-screens-wayland --help`).

Update the offline bundle: `idle-screens-wayland check-updates` (SHA-256
verified, anti-downgrade guarded; also checked in the background at launch).

## Behavior notes

- **Exit on input (overlay mode):** uses `ext-idle-notify-v1`. The watcher
  arms once you've been still for ~1 s, then any input dismisses the saver.
  Your idle daemon's resume hook (`pkill -TERM`) is a backup. When the daemon
  launches the saver you're already idle, so the first mouse move wakes the
  session.
- **Compositor without `ext-idle-notify-v1`:** degraded, not broken. The watcher
  logs `idle watcher failed: …` and exits; the saver then dismisses only via
  SIGTERM. Since that is exactly what the daemon's resume hook sends, the normal
  idle path still works — what you lose is auto-dismiss for saver launches you
  started *by hand* or from the tray, where no timeout is in flight to resume
  from. Check with `wayland-info | grep -i idle`.
- **Compositor without wlr-layer-shell** (GNOME/Mutter, X11): the overlay cannot
  be created and the app exits with an error saying so. `--windowed` still works.
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
  The way to keep a display awake is timeout ordering (see swayidle above), not
  an inhibitor.
- **DMA-BUF renderer:** WebKit's DMA-BUF path misbehaves on the NVIDIA
  proprietary driver (flicker/blank) and on Broadcom V3D (Raspberry Pi), so it
  is auto-disabled when either is detected. The launch log names which branch
  fired. Override with `[webkit] disable_dmabuf = "always" | "never"`.
- **Tray needs a StatusNotifier host.** Waybar and Plasma have one; GNOME needs
  an AppIndicator extension, and without a host the icon simply never appears.
- **Logs:** stderr (`-v` for debug). Under an idle daemon they land in the user
  journal: `journalctl --user -e | grep idle-screens`.

## Troubleshooting

Running it:
### The overlay is black on a channel

Two non-bug causes, in order of likelihood:

1. **The channel is asleep.** A sleeping channel renders nothing. Wake it (the
   `wake` MCP tool, or publish to it) and the screen fills in.
2. **The saver needs more GPU than this box has.** WebGL savers such as
   metaquarium fall back to a CSS placeholder when they cannot mount. Common on
   a Raspberry Pi, which advertises WebGL2 but cannot really drive three.js at
   fullscreen.

If it is black in *bundled* mode instead, see "Blank / failed load" above.

### `this compositor does not implement wlr-layer-shell`

Your session is GNOME/Mutter or X11. See "Does this run on my system?" at the
top — the overlay needs a compositor that speaks wlr-layer-shell. `--windowed`
works everywhere.

### Window closes when I move the mouse (windowed dev)

Use `--windowed`; overlay mode is meant to dismiss on input. If you're testing
the real overlay manually, pause for ~1 s before moving — that's when the
watcher arms.

Building it:
### Blank / failed load (`file:///webroot/...`)

Pass an absolute web root, or use `./scripts/dev-run.sh` which passes
`--web-root ./webroot` (canonicalized internally). Ensure `webroot/index.html`
exists — run `./scripts/sync-web.sh` once.

### `pnpm: command not found`

Install pnpm at the repo root (`corepack enable pnpm && pnpm install`), or rely
on the automatic `npx pnpm@9` fallback in `scripts/sync-web.sh`.

### `Permission denied` on `target/debug/.cargo-lock`

The `target/` directory was probably built as root (e.g. inside Docker). Fix
ownership or delete and rebuild:

```bash
sudo chown -R "$USER:$USER" target
# or
rm -rf target && cargo build
```

## Building from source

Everything above assumes the release tarball. This section is for building
the binary yourself — required on a distro we don't publish for, and the
normal path if you are working on the app.

### Native dependencies

Three native libraries, identified by the pkg-config module each provides —
those names are identical on every distro, which is why `check-deps.sh` probes
for them instead of asking a package manager:

| pkg-config module | minimum | Arch package | Debian / Ubuntu / Pi OS package |
| --- | --- | --- | --- |
| `gtk4` | 4.12 | `gtk4` | `libgtk-4-dev` |
| `webkitgtk-6.0` | 2.40 | `webkitgtk-6.0` | `libwebkitgtk-6.0-dev` |
| `gtk4-layer-shell-0` | 1.0 | `gtk4-layer-shell` | `libgtk4-layer-shell-dev` |

These are the *build* packages. Running a prebuilt binary needs only the runtime
libraries behind them — see [Install](#install).

```bash
# Arch / Omarchy
sudo pacman -S --needed base-devel rustup pkgconf git rsync \
  gtk4 webkitgtk-6.0 gtk4-layer-shell
rustup default stable

# Debian / Ubuntu / Raspberry Pi OS (trixie or newer)
sudo apt update && sudo apt install -y --no-install-recommends \
  build-essential pkg-config git rsync curl ca-certificates wayland-utils \
  libgtk-4-dev libwebkitgtk-6.0-dev libgtk4-layer-shell-dev
# trixie's apt rustc is older than the crate's rust-version — use rustup:
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
```

On any other distro install whatever provides those three modules;
`check-deps.sh` will confirm it and name anything still missing. Debian
**bookworm** cannot work — it has no `gtk4-layer-shell` package.

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

### First build

From a fresh clone on `develop`:

```bash
git clone https://github.com/shaaaaawn/idle-screens.git
cd idle-screens
git checkout develop        # the Linux app lives here

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

**On a low-powered box (Raspberry Pi, small SBC)**, build the web bundle
elsewhere and copy it in — `sync-web.sh` runs a whole pnpm monorepo build for
output that is byte-identical everywhere:

```bash
# on a dev machine
./scripts/sync-web.sh
rsync -a --delete apps/linux/webroot/ pi@raspberrypi.local:~/idle-screens/apps/linux/webroot/
# on the Pi, thereafter
SKIP_WEB=1 ./scripts/dev-run.sh --windowed --channel ballet
```

### Dev commands

| Command | What |
| --- | --- |
| `./scripts/dev-run.sh --windowed --saver warp` | Normal window for in-session testing; **does not** exit on mouse move |
| `./scripts/dev-run.sh --windowed --channel ballet` | Windowed channel viewer |
| `./scripts/dev-run.sh --saver warp --seed 42` | Real fullscreen overlay on all monitors |
| `SKIP_WEB=1 ./scripts/dev-run.sh …` | Skip web bundle rebuild |
| `cargo test` | Unit tests (config, bundle paths, URL builder, platform probes) |
| `./scripts/check-deps.sh` | Probe the three native pkg-config modules; names what to install |
| `./scripts/test-swayidle-install.sh` | Test the swayidle installer against fabricated configs (no swayidle or display needed) |
| `cargo build --release` | Production binary → `target/release/idle-screens-wayland` |
| `idle-screens-wayland tray` | StatusNotifier tray (manual launch / updates) |
| `./scripts/make-release.sh` | Build release tarball locally (same as CI) |

## Release (maintainers)

Tag `linux-v0.1.0` on `develop`/`main` to trigger `.github/workflows/linux-release.yml`:

```bash
git tag linux-v0.1.0
git push origin linux-v0.1.0
```

CI builds the binary + web bundle on both architectures and publishes:

- `idle-screens-wayland-<ver>-x86_64.tar.gz` — installable bundle (`install.sh`)
- `idle-screens-wayland-<ver>-aarch64.tar.gz` — same, for Raspberry Pi and other arm64
- `idle-screens-wayland-<ver>-src.tar.gz` — AUR source tarball
- `SHA256SUMS-<arch>` — checksums, one file per build leg

**glibc floor.** Both binaries are built on Debian trixie (glibc 2.41), so they
run on trixie-or-newer and on current Arch — not on Debian bookworm or Ubuntu
24.04. That costs nothing in practice: those releases have no
`gtk4-layer-shell` package and could not run the app anyway. Building on Arch
instead would be strictly worse, since an Arch-glibc binary runs on nothing older.

The aarch64 leg needs GitHub's native arm runners (`ubuntu-24.04-arm`) — QEMU is
far too slow for a webkit6 + gtk4 build. If those are unavailable, build the
aarch64 tarball on the Pi itself with `./scripts/make-release.sh` and attach it
to the release by hand.

Local dry run: `./scripts/make-release.sh`

## Try it without building (Chromium shortcut, Omarchy/Hyprland)

Omarchy ships Chromium; validate the idea with a hypridle listener before
building anything:

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

Idle scheduling (hypridle/swayidle/Quickshell), locking, launch-at-login beyond
tray autostart — the Linux environment already provides most of this. The binary
draws the overlay and exits; the tray adds manual launch and updates only.

X11 is out of scope. So is shipping a `.deb` or an SD-card image; the release
tarball plus `install.sh` is the supported path on every distro.
