#!/usr/bin/env bash
# Install idle-screens-wayland from a release tarball (run inside extracted bundle).
#
# Defaults to a rootless user-local install under ~/.local, which needs no sudo.
# Override with PREFIX=/usr/local (or /usr) for a system-wide install; the
# binary searches the user-local bundle first, then /usr/local, then /usr.
set -euo pipefail
cd "$(dirname "$0")"

prefix="${PREFIX:-$HOME/.local}"
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/idle-screens"
web_dir="$prefix/share/idle-screens/web"

# sudo only when the destination is not writable, so the default path stays
# rootless and a PREFIX=/usr install still works.
as_root() {
  if mkdir -p "$prefix" 2>/dev/null && [ -w "$prefix" ]; then
    "$@"
  else
    sudo "$@"
  fi
}

# shellcheck source=scripts/distro.sh
. ./distro.sh

# Verify the shared libraries before touching anything — a far better error than
# a dynamic-linker failure on first launch.
# `|| true`: ldd exits non-zero on a non-dynamic binary, and under `set -e` a
# failing command substitution in an assignment aborts with no output at all.
if command -v ldd >/dev/null 2>&1; then
  missing="$(ldd ./idle-screens-wayland 2>/dev/null | awk '/not found/{print $1}' || true)"
  if [ -n "$missing" ]; then
    echo "This binary needs shared libraries this system doesn't have:" >&2
    printf '  - %s\n' $missing >&2
    echo >&2
    echo "Detected distro family: $(idle_distro_family)" >&2
    # Runtime hint, not the build one: this is a prebuilt binary, so there is no
    # reason to send someone installing it after a compiler and -dev headers.
    idle_runtime_hint >&2
    exit 1
  fi
fi

echo "Installing to $prefix ..."
as_root install -Dm755 idle-screens-wayland "$prefix/bin/idle-screens-wayland"
as_root install -Dm755 packaging/omarchy/omarchy-idle-screens "$prefix/bin/omarchy-idle-screens"

# Replace the bundle wholesale: a partial overwrite leaves an older build's
# orphaned assets behind, and the loader trusts whatever sits in this directory.
as_root rm -rf "$web_dir"
as_root mkdir -p "$web_dir"
as_root cp -r web/. "$web_dir/"

as_root install -Dm644 packaging/config.toml.example "$prefix/share/doc/idle-screens/config.toml.example"
as_root install -Dm644 packaging/omarchy/idle-screens-tray.desktop \
  "$prefix/share/applications/idle-screens-tray.desktop"

mkdir -p "$config_dir"
if [ ! -f "$config_dir/config.toml" ]; then
  install -Dm644 packaging/config.toml.example "$config_dir/config.toml"
  echo "Created $config_dir/config.toml"
fi

# Autostart entry, with an ABSOLUTE Exec. systemd's xdg-autostart-generator
# resolves Exec when it generates the unit, early enough that ~/.local/bin is
# not reliably on its PATH -- a bare name silently yields no unit at all (or
# binds to a stale /usr/bin copy), so the tray never starts at login.
autostart_dir="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
mkdir -p "$autostart_dir"
sed "s|^Exec=idle-screens-wayland |Exec=$prefix/bin/idle-screens-wayland |" \
  packaging/omarchy/idle-screens-tray.desktop > "$autostart_dir/idle-screens-tray.desktop"

# A leftover copy elsewhere on PATH silently wins on some setups -- Omarchy
# appends ~/.local/bin "so system binaries keep precedence" -- and would run an
# older binary against the bundle we just installed.
shadow="$(command -v idle-screens-wayland 2>/dev/null || true)"
if [ -n "$shadow" ] && [ "$shadow" != "$prefix/bin/idle-screens-wayland" ]; then
  echo ""
  echo "WARNING: $shadow shadows the copy just installed at $prefix/bin/."
  echo "         Remove the other install first: ./uninstall.sh --all"
fi

echo
echo "Done. Next: wire idle-triggered launch for your session."
mechanisms="$(idle_detect_idle_mechanism)"
for m in $mechanisms; do
  case "$m" in
    quickshell) echo "  • Omarchy 4.x detected:   ./packaging/omarchy/install-omarchy.sh" ;;
    hypridle)   echo "  • hypridle detected:      ./packaging/omarchy/install-hypridle.sh" ;;
    swayidle)   echo "  • swayidle detected:      ./packaging/swayidle/install-swayidle.sh" ;;
  esac
done
if [ -z "$mechanisms" ]; then
  echo "  • no idle daemon detected — launch it from your own idle hook, and"
  echo "    dismiss with: pkill -TERM -f '[i]dle-screens-wayland'"
  echo "    See the 'Idle integration' section of the README."
fi
echo
echo "  • test now:  idle-screens-wayland --windowed --saver warp"
echo "  • kiosk:     idle-screens-wayland --kiosk    (Escape, or pkill -TERM -f '[i]dle-screens-wayland')"
echo "  • tray:      idle-screens-wayland tray"
