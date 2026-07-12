#!/bin/bash
# Assemble IdleScreens.app from the SPM build + web bundle.
# Usage: ./build-app.sh [--release]
set -euo pipefail
cd "$(dirname "$0")"

CONFIG=debug
if [[ "${1:-}" == "--release" ]]; then CONFIG=release; fi

echo "==> Building web bundle"
(cd web && node build.mjs)

echo "==> Building Swift ($CONFIG)"
if [[ "$CONFIG" == "release" ]]; then
  swift build -c release
else
  swift build
fi

BIN=".build/$CONFIG/IdleScreens"
APP="dist/IdleScreens.app"

echo "==> Assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
cp "$BIN" "$APP/Contents/MacOS/IdleScreens"
cp Info.plist "$APP/Contents/Info.plist"
cp -R web/dist/ "$APP/Contents/Resources/web/"

# Ad-hoc sign so TCC/AppKit treat it as a proper app bundle.
codesign --force --sign - "$APP"

echo "==> Done: $APP"
