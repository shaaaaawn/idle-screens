#!/usr/bin/env bash
# Build a release tarball: binary + web bundle + install scripts + idle hooks.
#
# Artifact names are per-arch because CI builds this on more than one machine and
# collects the results into one release. Anything NOT arch-specific (the AUR src
# tarball) must be emitted by exactly one leg — set SKIP_SRC=1 on the others, or
# the legs overwrite each other silently.
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
# install.sh sources distro.sh from beside itself in the extracted bundle.
cp scripts/install.sh scripts/uninstall.sh scripts/distro.sh "$root/"
chmod +x "$root/install.sh" "$root/uninstall.sh" "$root/distro.sh" \
  "$root/packaging/omarchy/"*.sh "$root/packaging/swayidle/"*.sh 2>/dev/null || true

tar -czf "$out" -C "$staging" "$bundle"
sums="dist/SHA256SUMS-${arch}"
( cd dist && sha256sum "$(basename "$out")" ) | tee "$sums"

# Source tarball for AUR (reuse existing script output name). Reuses the
# webroot/ staged above instead of rebuilding it a second time. It is
# arch-independent, so a multi-arch CI run emits it from one leg only.
if [ -z "${SKIP_SRC:-}" ]; then
  SKIP_WEB=1 ./scripts/make-src-tarball.sh
  ( cd dist && sha256sum "idle-screens-wayland-${version}-src.tar.gz" ) | tee -a "$sums"
fi

echo "release artifacts:"
ls -la dist/*.tar.gz "$sums" 2>/dev/null || ls -la dist/
