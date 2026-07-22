#!/usr/bin/env bash
# Install idle-screens-wayland from a release tarball (run inside extracted bundle).
set -euo pipefail
cd "$(dirname "$0")"
prefix="${PREFIX:-/usr/local}"
config_dir="${XDG_CONFIG_HOME:-$HOME/.config}/idle-screens"

echo "Installing to $prefix ..."
sudo install -Dm755 idle-screens-wayland "$prefix/bin/idle-screens-wayland"
sudo install -Dm755 packaging/omarchy/omarchy-idle-screens "$prefix/bin/omarchy-idle-screens"
sudo mkdir -p "$prefix/share/idle-screens/web"
sudo cp -r web/. "$prefix/share/idle-screens/web/"
sudo install -Dm644 packaging/config.toml.example "$prefix/share/doc/idle-screens/config.toml.example"
sudo install -Dm644 packaging/omarchy/idle-screens-tray.desktop \
  "$prefix/share/applications/idle-screens-tray.desktop"

mkdir -p "$config_dir"
if [ ! -f "$config_dir/config.toml" ]; then
  install -Dm644 packaging/config.toml.example "$config_dir/config.toml"
  echo "Created $config_dir/config.toml"
fi

autostart_dir="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
mkdir -p "$autostart_dir"
cp packaging/omarchy/idle-screens-tray.desktop "$autostart_dir/"

echo "Done. Optional next steps:"
echo "  • Omarchy hypridle: ./packaging/omarchy/install-hypridle.sh"
echo "  • Tray (if not autostarted): idle-screens-wayland tray"
echo "  • Test overlay: idle-screens-wayland"
