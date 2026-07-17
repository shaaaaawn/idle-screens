#!/usr/bin/env bash
# Sign with Developer ID, build a DMG, notarize, and staple.
#
# Usage:
#   ./scripts/release-local.sh          # recommended (loads .env + notary setup)
#   ./scripts/notarize.sh               # if DEVELOPER_ID + NOTARY_PROFILE are set
#   ./scripts/notarize.sh --skip-build  # re-notarize an existing signed DMG
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

cd "$MAC_DIR"

SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

load_mac_env
export DEVELOPER_ID="$(require_developer_id)"
export NOTARY_PROFILE="$(resolve_notary_profile)"

APP="dist/IdleScreens.app"
DMG="dist/IdleScreens.dmg"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  ./scripts/build-app.sh --release
fi

if [[ ! -d "$APP" ]]; then
  echo "App bundle missing: $APP (run without --skip-build)" >&2
  exit 1
fi

echo "==> Signing app with Developer ID (hardened runtime)"
codesign --force --options runtime --timestamp --sign "$DEVELOPER_ID" "$APP"
codesign --verify --strict --verbose=2 "$APP"

echo "==> Building DMG"
rm -f "$DMG"
hdiutil create -volname "idle-screens" -srcfolder "$APP" -ov -format UDZO "$DMG"
codesign --force --timestamp --sign "$DEVELOPER_ID" "$DMG"

if ! notary_profile_exists "$NOTARY_PROFILE"; then
  echo "Notary profile '$NOTARY_PROFILE' not found. Run ./scripts/setup-notary.sh" >&2
  exit 1
fi

echo "==> Notarizing (waits for Apple)"
xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait

echo "==> Stapling"
xcrun stapler staple "$APP"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

echo "==> Done: $DMG"
shasum -a 256 "$DMG"
