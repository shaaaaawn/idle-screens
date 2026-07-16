#!/bin/bash
# Sign with Developer ID, build a DMG, notarize, and staple.
# Prereqs (env vars):
#   DEVELOPER_ID   e.g. "Developer ID Application: Your Name (TEAMID)"
#   NOTARY_PROFILE name of a notarytool keychain profile created via:
#     xcrun notarytool store-credentials NOTARY_PROFILE \
#       --apple-id you@example.com --team-id TEAMID --password app-specific-pw
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DEVELOPER_ID:?Set DEVELOPER_ID to your 'Developer ID Application' identity}"
: "${NOTARY_PROFILE:?Set NOTARY_PROFILE to your notarytool keychain profile name}"

./scripts/build-app.sh --release

APP="dist/IdleScreens.app"
DMG="dist/IdleScreens.dmg"

echo "==> Signing app with Developer ID (hardened runtime)"
codesign --force --options runtime --timestamp --sign "$DEVELOPER_ID" "$APP"
codesign --verify --strict --verbose=2 "$APP"

echo "==> Building DMG"
rm -f "$DMG"
hdiutil create -volname "idle-screens" -srcfolder "$APP" -ov -format UDZO "$DMG"
codesign --force --timestamp --sign "$DEVELOPER_ID" "$DMG"

echo "==> Notarizing (waits for Apple)"
xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait

echo "==> Stapling"
xcrun stapler staple "$APP"
xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

echo "==> Done: $DMG"
shasum -a 256 "$DMG"
