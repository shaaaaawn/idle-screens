#!/usr/bin/env bash
# Sourced by check-deps.sh and install.sh — never executed directly.
#
# Design rule: DETECTION is distro-independent, only the REMEDIATION HINT is
# distro-mapped. Callers probe capabilities with pkg-config (build) or ldd
# (runtime), which behave identically everywhere; this file only turns a distro
# id into a human-readable install command. Nothing here gates anything, so an
# unrecognized distro degrades to "here are the modules you need", never to a
# false negative.

# The pkg-config modules the crate actually links against. Authoritative source
# is [package.metadata.system-deps] in gtk4-sys / webkit6-sys /
# gtk4-layer-shell-sys — NOT distro package names. gtk4's own floor is 4.0, but
# Cargo.toml enables the v4_12 feature, so 4.12 is the real minimum.
#
# NB the layer-shell module is "gtk4-layer-shell-0", not "gtk4-layer-shell";
# the latter is the Arch *package* name and does not exist as a .pc module.
IDLE_PC_MODULES=(
  "gtk4:4.12"
  "webkitgtk-6.0:2.40"
  "gtk4-layer-shell-0:1"
)

# ID first, then the first recognized ID_LIKE token. Prints a family:
#   arch | debian | fedora | suse | alpine | <raw id> | unknown
idle_distro_family() {
  local ids=""
  if [ -r /etc/os-release ]; then
    ids="$(. /etc/os-release; printf '%s %s' "${ID:-}" "${ID_LIKE:-}")"
  fi
  case " $ids " in
    *" arch "*|*" archlinux "*)               echo arch ;;
    *" debian "*|*" ubuntu "*|*" raspbian "*) echo debian ;;
    *" fedora "*|*" rhel "*)                  echo fedora ;;
    *" suse "*|*" opensuse "*)                echo suse ;;
    *" alpine "*)                             echo alpine ;;
    *) set -- $ids; echo "${1:-unknown}" ;;
  esac
}

# Runtime libraries only — what a downloaded binary needs, with no toolchain.
# Verified sufficient on a bare debian:trixie: these three take `ldd` from six
# missing libraries to zero. Arch does not split -dev packages, so its list is
# the same one the build uses.
idle_runtime_hint() {
  case "$(idle_distro_family)" in
    arch)
      echo "  sudo pacman -S --needed gtk4 webkitgtk-6.0 gtk4-layer-shell"
      ;;
    debian)
      echo "  sudo apt update && sudo apt install -y \\"
      echo "    libgtk-4-1 libwebkitgtk-6.0-4 libgtk4-layer-shell0"
      ;;
    fedora)
      echo "  sudo dnf install -y gtk4 webkitgtk6.0 gtk4-layer-shell   # untested"
      ;;
    *)
      echo "  (no package list for this distro yet — install the runtime"
      echo "   libraries providing these pkg-config modules:)"
      printf '     %s\n' "${IDLE_PC_MODULES[@]%%:*}"
      ;;
  esac
}

# Build dependencies — toolchain plus the -dev headers. Advisory only.
idle_install_hint() {
  case "$(idle_distro_family)" in
    arch)
      echo "  sudo pacman -S --needed base-devel rustup pkgconf git rsync \\"
      echo "    gtk4 webkitgtk-6.0 gtk4-layer-shell"
      echo "  rustup default stable"
      ;;
    debian)
      echo "  sudo apt update && sudo apt install -y --no-install-recommends \\"
      echo "    build-essential pkg-config git rsync curl ca-certificates wayland-utils \\"
      echo "    libgtk-4-dev libwebkitgtk-6.0-dev libgtk4-layer-shell-dev"
      echo "  # Debian trixie's apt rustc is older than Cargo.toml's rust-version:"
      echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y"
      ;;
    fedora)
      echo "  sudo dnf install -y gcc pkgconf-pkg-config git rsync \\"
      echo "    gtk4-devel webkitgtk6.0-devel gtk4-layer-shell-devel   # untested"
      ;;
    *)
      echo "  (no package list for this distro yet — install the development"
      echo "   packages providing these pkg-config modules:)"
      printf '     %s\n' "${IDLE_PC_MODULES[@]%%:*}"
      ;;
  esac
}

# Which idle daemon drives this session? Prints a space-separated subset of
# "quickshell hypridle swayidle" — empty when none is detected. Several can be
# present at once; each is inert when it is not the one running the session.
idle_detect_idle_mechanism() {
  local found=""
  command -v omarchy-plugin-clone >/dev/null 2>&1 && found="$found quickshell"
  { pgrep -x hypridle >/dev/null 2>&1 || [ -f "$HOME/.config/hypr/hypridle.conf" ]; } \
    && found="$found hypridle"
  { pgrep -x swayidle >/dev/null 2>&1 || command -v swayidle >/dev/null 2>&1; } \
    && found="$found swayidle"
  echo "${found# }"
}
