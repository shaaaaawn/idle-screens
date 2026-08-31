#!/usr/bin/env bash
# Install idle-screens-wayland from a release tarball (run inside extracted bundle).
set -euo pipefail
cd "$(dirname "$0")"
prefix="${PREFIX:-/usr/local}"
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/idle-screens"

# We just cd'd to install.sh's own directory, and distro.sh sits beside it in
# both layouts — the release bundle root (make-release.sh copies it there) and
# scripts/ in a source checkout.
. ./distro.sh

# Runtime capability check — distro-independent, and a far better error than a
# dynamic-linker failure on first launch.
if command -v ldd >/dev/null 2>&1; then
  # `|| true`: ldd exits non-zero on a non-dynamic binary, and under `set -e` a
  # failing command substitution in an assignment aborts the script with no
  # output whatsoever — the worst possible way for an installer to fail.
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

# Don't assume sudo: it is absent from minimal images, and pointless when this
# is already running as root — a normal case on an appliance box.
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  echo "Need root to install into $prefix, but sudo is not available." >&2
  echo "Re-run as root, or pick a writable prefix: PREFIX=\"\$HOME/.local\" $0" >&2
  exit 1
fi

echo "Installing to $prefix ..."
$SUDO install -Dm755 idle-screens-wayland "$prefix/bin/idle-screens-wayland"
$SUDO install -Dm755 packaging/omarchy/omarchy-idle-screens "$prefix/bin/omarchy-idle-screens"
$SUDO mkdir -p "$prefix/share/idle-screens/web"
$SUDO cp -r web/. "$prefix/share/idle-screens/web/"
$SUDO install -Dm644 packaging/config.toml.example "$prefix/share/doc/idle-screens/config.toml.example"
$SUDO install -Dm644 packaging/idle-screens-tray.desktop \
  "$prefix/share/applications/idle-screens-tray.desktop"

mkdir -p "$config_dir"
if [ ! -f "$config_dir/config.toml" ]; then
  install -Dm644 packaging/config.toml.example "$config_dir/config.toml"
  echo "Created $config_dir/config.toml"
fi

autostart_dir="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
mkdir -p "$autostart_dir"
cp packaging/idle-screens-tray.desktop "$autostart_dir/"

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
echo "  • kiosk:     idle-screens-wayland --kiosk"
echo "               (exit: pkill -TERM -f '[i]dle-screens-wayland')"
echo "  • tray:      idle-screens-wayland tray"
