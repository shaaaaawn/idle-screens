# Which Linux distros to plan for, and how to smoke test them

Research date: 2026-08-31. The version numbers below are **measured**, not
looked up: each was read out of that distro's own package manager in a container
on this date. Re-run the probe in §6 to refresh them.

---

## 1. There are two gates, and they fail differently

A distro is only viable if it clears both. They are independent, and conflating
them is how "which distros do we support?" gets answered wrongly.

**Gate 1 — the three native libraries.** From `[package.metadata.system-deps]`
in the sys crates. These pkg-config module names are identical everywhere, which
is why `scripts/check-deps.sh` probes for modules rather than packages:

| module | minimum | why |
| --- | --- | --- |
| `gtk4` | 4.12 | the crate enables the `v4_12` feature |
| `webkitgtk-6.0` | 2.40 | webkit6 0.6 |
| `gtk4-layer-shell-0` | 1.0 | gtk4-layer-shell-sys 0.6 |

**Gate 2 — a compositor implementing `zwlr_layer_shell_v1`.** wlroots-family
(sway, Hyprland, river, labwc, wayfire) and KDE Plasma Wayland do. **GNOME/Mutter
and every X11 session do not**, and that is upstream's deliberate position.

Gate 1 is a packaging question and is fully testable in a container. Gate 2 is a
*desktop* question, is not testable in a container at all, and is the one that
actually decides whether a user sees a screensaver. **A distro can pass Gate 1
and still be useless to us** — Ubuntu Desktop and Fedora Workstation both ship
GNOME by default.

---

## 2. Measured availability (Gate 1)

| Distro | `gtk4` | `webkitgtk-6.0` | `gtk4-layer-shell-0` | Verdict |
| --- | --- | --- | --- | --- |
| **Debian trixie** | 4.18.6 | 2.52.6 | 1.0.4 | ✅ built in CI, both arches |
| **Arch** | current | current | current | ✅ built in CI |
| **Fedora latest** | 4.22.4 | 2.52.5 | 1.3.0 | ✅ all present |
| **openSUSE Tumbleweed** | 4.22.4 | 2.52.5 | 1.3.0 | ✅ module confirmed |
| **Ubuntu 26.04 (rolling)** | 4.22.4 | 2.52.6 | 1.3.0 | ✅ all present |
| **Alpine edge** | `gtk4.0-dev` | `webkit2gtk-6.0-dev` | `gtk4-layer-shell` | ✅ all present |
| **Ubuntu 24.04 LTS** | 4.14.5 | 2.52.6 | **ABSENT** | ⚠️ one package short |
| **Debian bookworm** | **4.8.3** | 2.50.6 | **ABSENT** | ❌ two blockers |

openSUSE names the GTK4 WebKit port `webkitgtk4-devel`, which reads ambiguously
against the GTK3 `webkit2gtk3-devel`. Confirmed by installing it and asking
pkg-config directly: it provides `webkitgtk-6.0` 2.52.5. Package name ≠ module
name is exactly the trap that had `check-deps.sh` probing `gtk4-layer-shell`
instead of `gtk4-layer-shell-0`.

Two results worth pulling out:

- **Debian bookworm fails on `gtk4` too, not just layer-shell.** 4.8.3 is below
  our 4.12 floor. Our README currently gives only the layer-shell reason; the
  gtk4 one is more fundamental and rules out backporting a single package.
- **Ubuntu 24.04 LTS is short exactly one package.** gtk4 and webkitgtk both
  clear the bar; only `libgtk4-layer-shell-dev` is missing. That makes it the
  one distro where a small action (a PPA, or vendoring the library, which is
  ~2k lines of C) converts a "no" into a "yes" — and 24.04 is the LTS most
  people are actually on until 26.04 settles.

---

## 3. Gate 2 in practice: distro ≠ desktop

The useful unit is **distro + session**, not distro:

| Target | Session | Layer shell? | Notes |
| --- | --- | --- | --- |
| Omarchy | Hyprland | ✅ | our reference desktop; hardware-tested |
| Raspberry Pi OS Trixie | labwc | ✅ | CI-built on arm64, not yet hardware-tested |
| Arch + sway/Hyprland/river | wlroots | ✅ | |
| Fedora Sway / Hyprland spins | wlroots | ✅ | Fedora's answer to Gate 2 |
| openSUSE + sway | wlroots | ✅ | |
| Any distro + KDE Plasma Wayland | KWin | ✅ untested | biggest untested surface; Plasma implements layer-shell |
| SteamOS / Bazzite | Plasma Wayland | ✅ untested | interesting: an appliance-shaped audience |
| Ubuntu Desktop, Fedora Workstation | GNOME | ❌ | build succeeds, overlay cannot. `--windowed` only |
| Anything on X11 | — | ❌ | out of scope, deliberately |

The GNOME row is why the app now checks `gtk4_layer_shell::is_supported()` and
exits with an explanation. Packaging effort spent on Ubuntu Desktop buys nothing
unless the user also switches session.

---

## 4. Proposed tiers

**Tier 1 — supported, gated in CI.** Arch (x86_64) and Debian trixie (x86_64 +
aarch64). Already true. Anything that breaks these blocks a PR.

**Tier 2 — smoke test before claiming support.** Fedora, openSUSE Tumbleweed,
Ubuntu 26.04, Alpine edge. All clear Gate 1 on measurement; none has ever been
built or run. A container build is cheap and would let us name them in the
README with a straight face.

**Tier 3 — known-blocked, documented.** Debian bookworm and Ubuntu 24.04 LTS.
Both deserve a one-line README entry saying *why*, since "it doesn't work" plus
a reason stops a bug report.

**Not a tier — GNOME and X11.** Not "unsupported pending work"; structurally
impossible without a second, non-layer-shell window backend. Say so once and
stop revisiting it.

Deliberately excluded for now: NixOS (packaging model differs enough to deserve
its own study), Void, postmarketOS. None is hard; none has a known user.

---

## 5. What "smoke test" should mean

Three levels, increasing cost and increasing truth:

**L1 — deps resolve** (container, seconds). Do the three modules exist at the
required versions? This is §6's probe, and it is all we have run so far.

**L2 — it builds and tests** (container, ~2 min each). `check-deps.sh`, then
`cargo build --release --locked && cargo test --locked`. Catches
distro-specific header/soname breakage that L1 cannot see. On an Apple-silicon
Mac the container is arm64, so this doubles as Pi-target coverage.

**L3 — it runs** (VM or hardware, manual). Launch the overlay in a real session
and confirm a surface appears on the right layer, dismisses on input, and that
the compositor advertises `zwlr_layer_shell_v1` / `ext_idle_notifier_v1`
(`wayland-info | grep -iE 'layer_shell|idle'`). **Only L3 tests Gate 2**, and no
amount of container work substitutes for it.

Honest current state: **L1 for the table in §2, L2 for Debian trixie and Arch,
L3 for Omarchy only.** The Pi is L2, not L3, and the README now says so.

Cheapest real win: extend L2 to Tier 2 as a manually-triggered CI job
(`workflow_dispatch`), so it does not slow every PR but can be run before a
release. Fedora, openSUSE, Ubuntu and Alpine all publish official images.

---

## 6. The probe, so this table can be refreshed

Run from anywhere with Docker. Each line prints the candidate version or
`ABSENT`; no build, no install.

```bash
for img in debian:trixie debian:bookworm ubuntu:24.04 ubuntu:rolling; do
  echo "### $img"
  docker run --rm "$img" sh -c '
    apt-get update -qq >/dev/null 2>&1
    for p in libgtk-4-dev libwebkitgtk-6.0-dev libgtk4-layer-shell-dev; do
      v=$(apt-cache policy $p 2>/dev/null | sed -n "s/ *Candidate: //p")
      echo "  $p = ${v:-ABSENT}"; done'
done

echo "### fedora"
# repoquery prints one row per repo, and the format string has no newline —
# hence the explicit \n and sort -V | tail -1 to pick the highest.
docker run --rm fedora:latest sh -c '
  for p in gtk4-devel webkitgtk6.0-devel gtk4-layer-shell-devel; do
    v=$(dnf -q --refresh repoquery --qf "%{version}\n" "$p" 2>/dev/null | sort -V | tail -1)
    echo "  $p = ${v:-ABSENT}"
  done'

echo "### opensuse tumbleweed"
docker run --rm opensuse/tumbleweed sh -c '
  zypper -nq --no-refresh se -s gtk4-devel webkitgtk gtk4-layer-shell 2>/dev/null \
    | grep -iE "gtk4-devel|webkitgtk4-devel|gtk4-layer-shell-devel"'

echo "### alpine edge"
docker run --rm alpine:edge sh -c '
  apk update -q >/dev/null 2>&1
  apk search -qx gtk4.0-dev webkit2gtk-6.0-dev gtk4-layer-shell'
```

Two traps this probe already hit, kept so the next person does not:

- **macOS has no `timeout`** (GNU coreutils). A `timeout 600 docker run …`
  wrapper fails with `command not found` and every probe silently reports
  nothing useful.
- **`archlinux` publishes no arm64 image.** On Apple silicon it must be run with
  `--platform linux/amd64`, and that is the same reason `linux-ci.yml` pairs
  runner and container in an explicit `include:` list instead of a matrix
  cross-product.

---

## 7. Recommendation

1. Extend L2 to Fedora, openSUSE, Ubuntu 26.04 and Alpine as a
   `workflow_dispatch` CI job. Cheap, and it is the difference between listing a
   distro and supporting one.
2. Add the Tier 3 rows to the README with reasons: bookworm's gtk4 4.8.3 as well
   as its missing layer-shell, and 24.04's single missing package.
3. Decide on Ubuntu 24.04 LTS deliberately. It is one package from working, on
   the LTS with the largest install base. A PPA or a vendored gtk4-layer-shell
   is a real option; doing nothing is also fine, but it should be a choice.
4. Prioritise a **KDE Plasma Wayland** L3 test above any further packaging work.
   It is the largest audience that should already work and that nobody has ever
   verified — and unlike GNOME, a failure there would be a bug we could fix.
