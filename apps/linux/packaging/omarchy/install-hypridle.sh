#!/usr/bin/env bash
# Patch ~/.config/hypr/hypridle.conf to use idle-screens instead of the TTE
# screensaver. Only relevant on older, hypridle-driven Omarchy; current Omarchy
# runs the Quickshell idle service and ignores hypridle entirely.
set -euo pipefail

hypridle_conf="${HYPRIDLE_CONF:-$HOME/.config/hypr/hypridle.conf}"

# The correct dismissal command. `pkill -x idle-screens-wayland` — what older
# versions of this script wrote — can never match, because the kernel truncates
# the process name to 15 chars ("idle-screens-wa"). Match the command line; the
# [i] bracket stops pkill's own shell from matching itself.
kill_cmd="pkill -TERM -f '[i]dle-screens-wayland'"
old_kill='pkill -TERM -x idle-screens-wayland'

if [ ! -f "$hypridle_conf" ]; then
  echo "hypridle.conf not found at $hypridle_conf — nothing to patch." >&2
  exit 0
fi

backup="${hypridle_conf}.bak.$(date +%s)"
cp "$hypridle_conf" "$backup"

# Repair the broken kill from any earlier install, even if already switched over.
if grep -qF "$old_kill" "$hypridle_conf"; then
  sed -i "s|${old_kill}|${kill_cmd}|g" "$hypridle_conf"
  echo "Fixed the never-matching pkill in $hypridle_conf"
fi

if grep -q 'omarchy-idle-screens' "$hypridle_conf"; then
  echo "hypridle already points at idle-screens"
else
  sed -i 's/omarchy-launch-screensaver/omarchy-idle-screens/g' "$hypridle_conf"
  if ! grep -qF "$kill_cmd" "$hypridle_conf"; then
    # Omarchy's default screensaver listener has no on-resume; add one.
    sed -i "/omarchy-idle-screens/a\\    on-resume = ${kill_cmd}" "$hypridle_conf"
  fi
  echo "Patched $hypridle_conf"
fi

if cmp -s "$hypridle_conf" "$backup"; then
  rm -f "$backup"
else
  echo "Backup saved to $backup"
fi

if command -v omarchy-restart-hypridle &>/dev/null; then
  omarchy-restart-hypridle || true
fi
