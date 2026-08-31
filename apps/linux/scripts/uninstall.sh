#!/usr/bin/env bash
# Remove an idle-screens-wayland install.
#
#   ./scripts/uninstall.sh          # remove from PREFIX (default ~/.local)
#   ./scripts/uninstall.sh --all    # also sweep known system prefixes
#
# Config (~/.config/idle-screens) and the per-machine device id are kept unless
# --purge is passed, so reinstalling does not re-pair the machine.
set -euo pipefail

prefix="${PREFIX:-$HOME/.local}"
all=0
purge=0
for arg in "$@"; do
  case "$arg" in
    --all) all=1 ;;
    --purge) purge=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

prefixes=("$prefix")
if [ "$all" = 1 ]; then
  prefixes+=(/usr/local /usr)
fi

rm_path() {
  local p="$1"
  [ -e "$p" ] || return 0
  if [ -w "$(dirname "$p")" ]; then
    rm -rf "$p"
  else
    sudo rm -rf "$p"
  fi
  echo "  removed $p"
}

for p in "${prefixes[@]}"; do
  echo "Sweeping $p ..."
  rm_path "$p/bin/idle-screens-wayland"
  rm_path "$p/bin/omarchy-idle-screens"
  # Only the bundle, not the whole share/idle-screens directory: under a
  # user-local prefix that directory is also the data dir, holding device-id
  # and the update cache that --purge (not a plain uninstall) is meant to drop.
  rm_path "$p/share/idle-screens/web"
  rmdir "$p/share/idle-screens" 2>/dev/null && echo "  removed $p/share/idle-screens (empty)" || true
  rm_path "$p/share/applications/idle-screens-tray.desktop"
  rm_path "$p/share/doc/idle-screens"
done

rm_path "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/idle-screens-tray.desktop"

if [ "$purge" = 1 ]; then
  rm_path "${XDG_CONFIG_HOME:-$HOME/.config}/idle-screens"
  rm_path "${XDG_DATA_HOME:-$HOME/.local/share}/idle-screens"
  echo "  (device id and update cache dropped; the machine re-pairs on next launch)"
else
  echo ""
  echo "Kept config and device id (pass --purge to remove):"
  echo "  ${XDG_CONFIG_HOME:-$HOME/.config}/idle-screens"
  echo "  ${XDG_DATA_HOME:-$HOME/.local/share}/idle-screens"
fi

echo ""
echo "Omarchy wiring is left in place. To revert it:"
echo "  omarchy plugin remove \"\${USER}.idle\" && omarchy plugin enable omarchy.idle"
