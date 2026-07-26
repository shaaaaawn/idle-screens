#!/bin/bash
# Assemble IdleScreens.app from the SPM build + web bundle.
# Usage: ./scripts/build-app.sh [--release]
set -euo pipefail
cd "$(dirname "$0")/.."

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

# Build provenance for the About panel: local dev builds vs CI releases.
# CI (notarize.sh) sets IDLE_BUILD_KIND=release; everything else is "local".
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  COMMIT="$COMMIT-dirty"
fi
cat > "$APP/Contents/Resources/build-info.json" <<EOF
{"kind":"${IDLE_BUILD_KIND:-local}","commit":"$COMMIT","date":"$(date -u +"%Y-%m-%d %H:%MZ")"}
EOF

# Ad-hoc sign so TCC/AppKit treat it as a proper app bundle.
codesign --force --sign - "$APP"

echo "==> Done: $APP"
