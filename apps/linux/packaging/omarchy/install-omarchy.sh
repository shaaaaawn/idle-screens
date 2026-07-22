#!/usr/bin/env bash
# Full Omarchy setup: install binary + web bundle + hypridle patch + tray autostart.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ ! -f idle-screens-wayland ]; then
  echo "Run from an extracted release tarball root (needs idle-screens-wayland binary)." >&2
  exit 1
fi

./install.sh
./packaging/omarchy/install-hypridle.sh

echo ""
echo "Omarchy integration complete."
echo "  • hypridle launches omarchy-idle-screens at 150 s idle"
echo "  • tray autostarts on login (disable in ~/.config/autostart/)"
echo "  • config: ~/.config/idle-screens/config.toml"
