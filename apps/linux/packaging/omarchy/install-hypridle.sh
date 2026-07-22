#!/usr/bin/env bash
# Patch ~/.config/hypr/hypridle.conf to use idle-screens instead of TTE screensaver.
set -euo pipefail

hypridle_conf="${HYPRIDLE_CONF:-$HOME/.config/hypr/hypridle.conf}"
snippet="$(dirname "$0")/hypridle.listener.snippet"

if [ ! -f "$hypridle_conf" ]; then
  echo "hypridle.conf not found at $hypridle_conf" >&2
  exit 1
fi

if grep -q 'omarchy-idle-screens' "$hypridle_conf"; then
  echo "hypridle already configured for idle-screens"
  exit 0
fi

cp "$hypridle_conf" "${hypridle_conf}.bak.$(date +%s)"
sed -i 's/omarchy-launch-screensaver/omarchy-idle-screens/g' "$hypridle_conf"

if ! grep -q 'pkill -TERM -x idle-screens-wayland' "$hypridle_conf"; then
  # Insert on-resume after the screensaver on-timeout line (Omarchy default lacks it).
  sed -i '/omarchy-idle-screens/a\    on-resume = pkill -TERM -x idle-screens-wayland' "$hypridle_conf"
fi

echo "Patched $hypridle_conf (backup saved)"
echo "Restart hypridle: omarchy-restart-hypridle  (or log out/in)"

if command -v omarchy-restart-hypridle &>/dev/null; then
  omarchy-restart-hypridle
fi
