# Ticket drafts: first-class Omarchy support, and Linux distro reach

Drafted 2026-08-31 from [omarchy-plugin-spec.md](omarchy-plugin-spec.md) and
[linux-distro-targets.md](linux-distro-targets.md). Nothing here is filed yet —
these are ready to paste into GitHub issues.

**Framing.** Omarchy is a young, fast-growing community with an open plugin
marketplace, a documented hook system, and an active upstream. The goal is not
"make our installer less ugly" — it is to be the screensaver Omarchy users
expect to have, and to be a good citizen upstream while we do it. The distro
work is the opposite direction: breadth, so that people who arrive from Omarchy
and run something else are not turned away.

Two directions, hence two sections:

- **Outbound (§A)** — what we give the Omarchy ecosystem: a marketplace plugin,
  an upstream PR, theme integration.
- **Inbound (§B)** — what we harden on our side: distro reach, smoke testing,
  and removing our own sharp edges.

---

## §A Omarchy — first-class support

### A1. Publish `omarchy-plugin-idle-screens` to the plugin marketplace
**Priority: high. Effort: S. Blocked by: nothing.**

Today the only install path is "download a tarball, run `install.sh`, then run a
second script that forks a first-party plugin." Omarchy users expect
`omarchy plugin add <url> --enable`.

A plugin is just a git repo with a `manifest.json`
(`schemaVersion`, `id`, `name`, `version`, `author`, `license`, `kinds`,
`entryPoints`). Ship a repo whose `service` entry point wires up the saver, and
list it on plugins.omarchy.org.

**Done when:** `omarchy plugin add https://github.com/shaaaaawn/omarchy-plugin-idle-screens --enable`
installs and enables the saver on a clean Omarchy box; `omarchy plugin validate`
passes in our CI; the listing is live.

**Notes:** ids may not use the reserved `omarchy.*` namespace. Plugins run
unsandboxed inside the long-running shell process, so keep the QML minimal and
push logic into the binary. `omarchy plugin update` then gives us upgrades for
free.

---

### A2. Upstream a `screensaverCommand` config key to `basecamp/omarchy`
**Priority: high. Effort: XS (ours) + upstream review. Blocked by: nothing.**

This is the ticket that deletes our fork, and it is a good-faith contribution
rather than a favour we need.

`shell/plugins/services/idle/Service.qml` hardcodes the command:

```qml
runProcess(screensaverProcess, "screensaver",
  "[[ $(omarchy-shell lock isLocked 2>/dev/null) == \"true\" ]] || omarchy-launch-screensaver")
```

The service already reads `idle.screensaver` and `idle.lock` from `shell.json`.
Adding a third key follows the established pattern and is backward compatible:

```qml
readonly property string screensaverCommand:
  (idleConfig.screensaverCommand && String(idleConfig.screensaverCommand).length)
    ? String(idleConfig.screensaverCommand) : "omarchy-launch-screensaver"
```

It generalises well past us — anyone wanting a different screensaver needs the
same hook — which is the argument to lead with.

**Done when:** a discussion or PR is open on `basecamp/omarchy`. If accepted,
A3 becomes trivial and `install-omarchy-plugin.sh` can be deleted.

**Risk:** may be declined; the `isLocked` guard suggests upstream wants tight
control of this path. Cheap to ask, and A1/A4 do not depend on it.

---

### A3. Self-healing fork: re-apply the clone patch via a `post-update` hook
**Priority: high. Effort: S. Blocked by: nothing. Obsoleted by: A2.**

Our clone of `omarchy.idle` is a fork that silently goes stale — and the plugin
has already moved once (`shell/plugins/idle` → `shell/plugins/services/idle`),
so this is a live problem, not a theoretical one.

Omarchy has a hook system precisely for this: `omarchy hook install post-update <file>`
drops a script into `~/.config/omarchy/hooks/post-update.d/`, and `omarchy-hook`
runs every file in that directory after an update.

Install a hook that re-clones and re-patches after `omarchy update`, so the
integration repairs itself instead of quietly reverting to the stock
screensaver.

**Done when:** running `omarchy update` on a box with our integration leaves the
saver still wired; the hook is idempotent and no-ops when already correct.

---

### A4. Follow the active Omarchy theme
**Priority: high (this is the differentiator). Effort: M. Blocked by: nothing.**

Omarchy's identity is its themes — 22 first-party ones, each with a
`colors.toml` of named colours:

```toml
mode = "dark"
accent = "#7aa2f7"
background = "#1a1b26"
foreground = "#a9b1d6"
red = "#f7768e"   green = "#9ece6a"   blue = "#7aa2f7"   # …
```

Our scenes are palette-driven SaverSpec JSON, and channels are steerable live.
So: **change your Omarchy theme, and your screensaver changes with it.**

`omarchy hook install theme-set <file>` installs into `theme-set.d`, which fires
on every theme switch with the theme name as an argument. The hook reads
`colors.toml` and either re-publishes a themed scene or `setParam`s the palette
on the channel.

Nothing else in the screensaver space does this, and it is the single strongest
argument for why an Omarchy user should pick idle-screens.

**Done when:** switching theme in Omarchy visibly re-themes the saver within one
idle cycle; works offline (bundled mode) as well as on a channel.

**Open:** whether to map onto an existing scene's palette or generate a scene
per theme. Prototype against two contrasting themes (`tokyo-night`, `matte-black`).

---

### A5. Bar widget / menu entry for saver control
**Priority: medium. Effort: M. Blocked by: A1.**

`bar-widget` and `menu` are plugin kinds. A small widget showing saver state
with a click-to-toggle (mapping onto the existing `omarchy-shell idle
enable|disable|toggle` IPC and our tray actions) is what "native" looks like on
this desktop, and is more discoverable than an SNI tray icon.

**Done when:** the widget can be added from Omarchy's own bar configuration.

---

### A6. Document the two Omarchy behaviours that silently break things
**Priority: high. Effort: XS. Blocked by: nothing.**

Both were found by reading `Service.qml`, and neither is in our docs:

1. **A 3-second grace timer.** If no window of class `org.omarchy.screensaver`
   maps within 3 s of launch, `cancelIdleCycle("screensaver-not-running")` fires
   and **the screen never locks**. That presents as an Omarchy bug, not ours.
2. **The 300 s lock timer runs concurrently**, not after the screensaver. Kiosk
   users must address the lock timeout too — our kiosk docs cover hypridle and
   swayidle and say nothing about this.

Also advertise `omarchy-shell idle status`: it returns JSON naming the exact
failure (`screensaver-not-running`, `screensaver-dismissed`, `stay-awake`), and
is the right first debugging step.

---

### A7. Measure our window-map latency against the 3 s budget
**Priority: medium. Effort: S. Blocked by: A6.**

We believe we are safe — `windows.rs` calls `present()` at opacity 0 before the
page loads — but "believe" is doing the work. Time from process start to the
Hyprland `openwindow` event on the slowest target we support (Pi 5), and on a
cold page cache.

**Done when:** a measured number is in the README. If it is anywhere near 3 s,
map the surface before building the webview.

---

## §B Distro reach — the other direction

### B1. `workflow_dispatch` CI job: L2 build on Tier 2 distros
**Priority: high. Effort: S. Blocked by: nothing.**

Fedora, openSUSE Tumbleweed, Ubuntu 26.04 and Alpine all clear the dependency
gate on measurement. Fedora has since been built and passes. Add a manually
triggered job that runs `check-deps.sh`, the swayidle installer tests,
`cargo build --release --locked` and `cargo test --locked` on each, so it does
not slow every PR but can gate a release.

**Done when:** the job is green and the README can name those distros honestly.

---

### B2. Decide on Ubuntu 24.04 LTS
**Priority: medium. Effort: M (or XS to decline). Blocked by: nothing.**

24.04 has `gtk4` 4.14.5 and `webkitgtk-6.0` 2.52.6 — both above our floor — and
is missing only `libgtk4-layer-shell-dev`. It is the largest-install-base LTS
and is **one package** from working.

Options: a PPA; vendoring gtk4-layer-shell (a small C library) behind a cargo
feature; or declining and documenting it. Any is defensible; drifting is not.

**Done when:** a decision is recorded in the README, with the reason.

---

### B3. Document why Debian bookworm cannot work
**Priority: low. Effort: XS. Blocked by: nothing.**

Our docs cite only the missing `gtk4-layer-shell`. Bookworm's `gtk4` is **4.8.3**,
below our 4.12 floor — a more fundamental blocker that rules out backporting one
package. Say both, so nobody spends an evening on it.

---

### B4. L3 (actually runs) on KDE Plasma Wayland
**Priority: high. Effort: M. Blocked by: nothing.**

Plasma implements layer-shell, so the overlay *should* work, and Plasma is by
far the largest audience we have never tested. Unlike GNOME, a failure here
would be a bug we can fix. Also covers the SteamOS/Bazzite appliance shape.

**Done when:** a Plasma Wayland VM shows the overlay, dismisses on input, and
the result — pass or fail — is in the compositor table.

---

### B5. Alpine / musl: decide in or out
**Priority: low. Effort: M. Blocked by: B1.**

Alpine edge has all three libraries, but it is musl, and our release binaries
are glibc. Supporting it means a musl target and a separate artifact. Cheap to
determine (does it build?), and worth an explicit yes/no rather than silence.

---

### B6. Publish a `linux-v*` release
**Priority: high. Effort: S. Blocked by: nothing.**

No `linux-v*` tag has ever been cut, so every "download the release tarball"
instruction we have — including the quick start — currently points at nothing.
The aarch64 pipeline exists and is untested end-to-end precisely because it has
never run.

**Done when:** a tag produces both `x86_64` and `aarch64` tarballs plus per-arch
checksums, and the README's install path works as written.

---

## Suggested order

**Now:** A6 + B3 (documentation corrections, minutes), B6 (unblocks every
install instruction we ship), A2 (open the upstream conversation early — it has
the longest lead time and nothing depends on it).

**Next:** A1 (marketplace plugin — the front door), A3 (stop the fork rotting
while A2 is pending), B1 (make Tier 2 claims true).

**Then:** A4 (theme following — the differentiator worth doing properly, not
quickly), B4 (Plasma), A7, B2.

**Later / optional:** A5, B5.
