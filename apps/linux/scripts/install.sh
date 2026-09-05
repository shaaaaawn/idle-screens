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

echo "Done. Optional next steps:"
echo "  • Omarchy (either version): ./packaging/omarchy/install-omarchy.sh"
echo "  • Tray (if not autostarted): idle-screens-wayland tray"
echo "  • Test overlay: idle-screens-wayland"
