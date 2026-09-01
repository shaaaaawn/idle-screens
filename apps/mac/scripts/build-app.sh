#!/bin/bash
# Assemble IdleScreens.app from the SPM build + web bundle.
# Usage: ./scripts/build-app.sh [--release]
set -euo pipefail
cd "$(dirname "$0")/.."

CONFIG=debug
if [[ "${1:-}" == "--release" ]]; then CONFIG=release; fi

echo "==> Building web bundle"
(cd web && node build.mjs)

# Release builds are universal (arm64 + x86_64) so one DMG runs on Apple silicon
# and Intel alike; a plain `swift build` only produces the host architecture, so
# a release cut on an Apple-silicon runner would silently exclude every Intel
# Mac. Dev builds stay host-only — the second slice doubles compile time and
# buys nothing locally. Override with UNIVERSAL=0 (or =1 to force it on).
UNIVERSAL="${UNIVERSAL:-$([[ "$CONFIG" == release ]] && echo 1 || echo 0)}"

label="$CONFIG"; [[ "$UNIVERSAL" == "1" ]] && label="$label, universal"
echo "==> Building Swift ($label)"
if [[ "$CONFIG" == "release" && "$UNIVERSAL" == "1" ]]; then
  swift build -c release --arch arm64 --arch x86_64
  # A multi-arch build lands somewhere else entirely, not .build/release/.
  BIN=".build/apple/Products/Release/IdleScreens"
elif [[ "$CONFIG" == "release" ]]; then
  swift build -c release
  BIN=".build/release/IdleScreens"
else
  swift build
  BIN=".build/debug/IdleScreens"
fi

[[ -f "$BIN" ]] || { echo "swift build produced no binary at $BIN" >&2; exit 1; }
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

echo "==> Done: $APP ($(lipo -archs "$APP/Contents/MacOS/IdleScreens" 2>/dev/null || echo "unknown arch"))"
