#!/usr/bin/env bash
# Build a release tarball: binary + web bundle + install scripts + Omarchy hooks.
set -euo pipefail
cd "$(dirname "$0")/.."

version="$(grep -m1 '^version' Cargo.toml | sed 's/.*"\(.*\)".*/\1/')"
arch="$(uname -m)"
bundle="idle-screens-wayland-${version}-${arch}"
out="dist/${bundle}.tar.gz"

./scripts/sync-web.sh
cargo build --release --locked
[ -f webroot/index.html ] || { echo "webroot missing"; exit 1; }

mkdir -p dist
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
root="$staging/$bundle"
mkdir -p "$root"

cp target/release/idle-screens-wayland "$root/"
cp -r webroot "$root/web"
cp -r packaging "$root/"
cp ../../LICENSE "$root/LICENSE" 2>/dev/null || true
cp scripts/install.sh "$root/"
chmod +x "$root/install.sh" "$root/packaging/omarchy/"*.sh 2>/dev/null || true

tar -czf "$out" -C "$staging" "$bundle"
( cd dist && sha256sum "$(basename "$out")" ) | tee dist/SHA256SUMS

# Source tarball for AUR (reuse existing script output name). Reuses the
# webroot/ staged above instead of rebuilding it a second time.
SKIP_WEB=1 ./scripts/make-src-tarball.sh
( cd dist && sha256sum "idle-screens-wayland-${version}-src.tar.gz" ) | tee -a dist/SHA256SUMS

echo "release artifacts:"
ls -la dist/*.tar.gz dist/SHA256SUMS 2>/dev/null || ls -la dist/
