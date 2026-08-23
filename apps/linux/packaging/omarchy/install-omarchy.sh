#!/usr/bin/env bash
# Full Omarchy setup: binary + web bundle + screensaver wiring + tray autostart.
#
# Omarchy ships two different idle mechanisms depending on version, and the
# wiring differs for each. Rather than guess, install whichever apply:
#
#   Quickshell idle service (current)  -> shadow `omarchy-launch-screensaver`
#       with a shim in ~/.local/bin. The service runs the command through
#       `bash -lc`, and a login shell puts ~/.local/bin ahead of
#       /usr/share/omarchy/bin, so the shim wins. The packaged copy in
#       /usr/share/omarchy/ is never touched (omarchy update would revert it).
#
#   hypridle (older)                   -> patch ~/.config/hypr/hypridle.conf.
#
# Both are safe to install together: each is inert when its mechanism is not
# the one driving the session.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ ! -f idle-screens-wayland ]; then
  echo "Run from an extracted release tarball root (needs idle-screens-wayland binary)." >&2
  exit 1
fi

./install.sh

local_bin="$HOME/.local/bin"
shim="$local_bin/omarchy-launch-screensaver"
quickshell=0
hypridle=0

if [ -d /usr/share/omarchy/shell ] || command -v omarchy-shell &>/dev/null; then
  quickshell=1
fi
if [ -f "$HOME/.config/hypr/hypridle.conf" ]; then
  hypridle=1
fi

if [ "$quickshell" = 1 ]; then
  mkdir -p "$local_bin"
  install -Dm755 packaging/omarchy/omarchy-launch-screensaver "$shim"
  echo "Installed screensaver shim -> $shim"

  # The shim only works if it actually wins PATH lookup in a login shell,
  # which is how the idle service invokes it. Verify rather than assume.
  resolved="$(bash -lc 'command -v omarchy-launch-screensaver' 2>/dev/null || true)"
  if [ "$resolved" != "$shim" ]; then
    echo ""
    echo "WARNING: in a login shell 'omarchy-launch-screensaver' resolves to:"
    echo "    ${resolved:-<not found>}"
    echo "  ...not the shim. Omarchy will keep using its stock screensaver."
    echo "  Put $local_bin ahead of /usr/share/omarchy/bin on PATH, then re-run."
  fi
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
[ "$quickshell" = 1 ] && echo "  • Quickshell idle service launches idle-screens via the shim"
[ "$hypridle" = 1 ] && echo "  • hypridle listener launches omarchy-idle-screens"
echo "  • tray autostarts on login (disable in ~/.config/autostart/)"
echo "  • config: ~/.config/idle-screens/config.toml  (mode / channel live here)"
echo "  • revert: rm -f $shim"
