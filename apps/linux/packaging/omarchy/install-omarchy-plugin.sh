#!/usr/bin/env bash
# Wire idle-screens into current Omarchy (4.x), whose Quickshell idle service
# launches the screensaver.
#
# Why a plugin clone and not a PATH shim: the idle service runs
# `omarchy-launch-screensaver` and offers no config key for which screensaver
# to use. Shadowing that command on PATH does not work — Omarchy's
# env-bootstrap deliberately *appends* ~/.local/bin "so system binaries keep
# precedence", so the packaged copy always wins. Editing the packaged plugin
# is also out (omarchy update reverts it). The supported override is
# `omarchy plugin clone`, which copies a first-party plugin into
# ~/.config/omarchy/plugins/<user>.<id> and switches the shell to it.
#
# TRADE-OFF: the clone is a fork. It stops receiving upstream fixes to the
# idle service until you re-clone. Revert with:
#   omarchy plugin remove <user>.idle && omarchy plugin enable omarchy.idle
set -euo pipefail

launcher="${LAUNCHER:-$HOME/.local/bin/omarchy-idle-screens}"

command -v omarchy-plugin-clone &>/dev/null || {
  echo "This Omarchy has no 'omarchy plugin' command; use install-hypridle.sh instead." >&2
  exit 1
}
[ -x "$launcher" ] || { echo "launcher not found: $launcher" >&2; exit 1; }

clone_id="$(omarchy plugin list 2>/dev/null | awk '$3 == "third-party" && $1 ~ /\.idle$/ {print $1; exit}')"
if [ -z "$clone_id" ]; then
  omarchy plugin clone omarchy.idle
  clone_id="$(omarchy plugin list 2>/dev/null | awk '$3 == "third-party" && $1 ~ /\.idle$/ {print $1; exit}')"
fi
[ -n "$clone_id" ] || { echo "could not determine the cloned idle plugin id" >&2; exit 1; }

service="$HOME/.config/omarchy/plugins/$clone_id/Service.qml"
[ -f "$service" ] || { echo "cloned plugin has no Service.qml: $service" >&2; exit 1; }

if grep -q 'omarchy-idle-screens' "$service"; then
  echo "$clone_id already launches idle-screens"
else
  cp "$service" "$service.bak.$(date +%s)"
  # Absolute path on purpose: PATH order in the shell's session would
  # otherwise resolve an older /usr/bin copy that rejects the newer flags.
  sed -i "s|omarchy-launch-screensaver|$launcher|g" "$service"
  grep -q "$launcher" "$service" || { echo "patch did not apply to $service" >&2; exit 1; }
  echo "Patched $service -> $launcher"
fi

omarchy plugin validate "$HOME/.config/omarchy/plugins/$clone_id" >/dev/null
omarchy restart shell || true

echo ""
echo "Done. Verify with:  omarchy-shell idle status"
echo "Revert with:        omarchy plugin remove $clone_id && omarchy plugin enable omarchy.idle"
