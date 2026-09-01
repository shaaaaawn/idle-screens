#!/usr/bin/env bash
# Full Omarchy setup: binary + web bundle + screensaver wiring + tray autostart.
#
# Omarchy ships two different idle mechanisms depending on version, and the
# wiring differs for each. Rather than guess, install whichever apply:
#
#   Quickshell idle service (current)  -> clone the first-party omarchy.idle
#       plugin and point its screensaver command at our launcher. PATH
#       shadowing does NOT work here: Omarchy appends ~/.local/bin "so system
#       binaries keep precedence", so the packaged omarchy-launch-screensaver
#       always wins. See install-omarchy-plugin.sh for the trade-off.
#
#   hypridle (older)                   -> patch ~/.config/hypr/hypridle.conf.
#
# Both are safe to install together: each is inert when its mechanism is not
# the one driving the session.
set -euo pipefail
cd "$(dirname "$0")/../.."

# Two entry points: an extracted release tarball (binary sitting right here, so
# install it first), or an already-installed copy -- the packaged scripts land
# in /usr/share/idle-screens/omarchy/, where there is no tarball to install
# from and the binary is already on PATH. Only the wiring below applies then.
if [ -f idle-screens-wayland ]; then
  ./install.sh
elif command -v idle-screens-wayland &>/dev/null; then
  echo "Using the installed idle-screens-wayland ($(command -v idle-screens-wayland)); wiring only."
else
  echo "No idle-screens-wayland found: run this from an extracted release tarball," >&2
  echo "or install the package first (pacman -S idle-screens-wayland)." >&2
  exit 1
fi

# Per-user tray autostart -- a package cannot write to $HOME, so do it here.
autostart_dir="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
tray_desktop=""
for candidate in \
  packaging/omarchy/idle-screens-tray.desktop \
  /usr/share/applications/idle-screens-tray.desktop \
  "$HOME/.local/share/applications/idle-screens-tray.desktop"; do
  [ -f "$candidate" ] && { tray_desktop="$candidate"; break; }
done
if [ -n "$tray_desktop" ]; then
  mkdir -p "$autostart_dir"
  cp "$tray_desktop" "$autostart_dir/"
fi

quickshell=0
hypridle=0

if command -v omarchy-plugin-clone &>/dev/null; then
  quickshell=1
fi
if [ -f "$HOME/.config/hypr/hypridle.conf" ]; then
  hypridle=1
fi

if [ "$quickshell" = 1 ]; then
  ./packaging/omarchy/install-omarchy-plugin.sh
fi

if [ "$hypridle" = 1 ]; then
  ./packaging/omarchy/install-hypridle.sh
fi

if [ "$quickshell" = 0 ] && [ "$hypridle" = 0 ]; then
  echo ""
  echo "No Omarchy idle mechanism detected; installed the binary only."
  echo "Wire it up yourself with: omarchy-idle-screens"
fi

echo ""
echo "Omarchy integration complete."
[ "$quickshell" = 1 ] && echo "  • cloned idle plugin launches idle-screens"
[ "$hypridle" = 1 ] && echo "  • hypridle listener launches omarchy-idle-screens"
echo "  • tray autostarts on login (disable in ~/.config/autostart/)"
echo "  • config: ~/.config/idle-screens/config.toml  (mode / channel live here)"
echo "  • revert: omarchy plugin remove <user>.idle && omarchy plugin enable omarchy.idle"
