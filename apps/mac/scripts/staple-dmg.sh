#!/usr/bin/env bash
# Staple a notarized DMG (and dist/IdleScreens.app) after async notarization.
# Usage: ./scripts/staple-dmg.sh [path/to/IdleScreens.dmg]
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

cd "$MAC_DIR"

DMG="${1:-dist/IdleScreens.dmg}"
APP="dist/IdleScreens.app"

if [[ ! -f "$DMG" ]]; then
  echo "DMG not found: $DMG" >&2
  exit 1
fi
if [[ ! -d "$APP" ]]; then
  echo "App bundle not found: $APP" >&2
  exit 1
fi

echo "==> Stapling $APP"
xcrun stapler staple "$APP"
echo "==> Stapling $DMG"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

echo "==> Done: $DMG"
shasum -a 256 "$DMG"
