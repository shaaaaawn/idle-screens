#!/usr/bin/env bash
# Produce a release source tarball containing the crate + prebuilt webroot,
# so the AUR build needs no node/pnpm toolchain.
#
#   SKIP_WEB=1 ./scripts/make-src-tarball.sh   # reuse an already-staged webroot/
set -euo pipefail
cd "$(dirname "$0")/.."

version="$(grep -m1 '^version' Cargo.toml | sed 's/.*"\(.*\)".*/\1/')"
name="idle-screens-wayland-$version"
out="dist/$name-src.tar.gz"

[ "${SKIP_WEB:-}" ] || ./scripts/sync-web.sh
[ -f webroot/index.html ] || { echo "webroot missing after sync"; exit 1; }

mkdir -p dist
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
mkdir "$staging/$name"
cp -R Cargo.toml Cargo.lock rustfmt.toml src packaging webroot "$staging/$name/"
cp ../../LICENSE "$staging/$name/LICENSE" 2>/dev/null || true
tar -czf "$out" -C "$staging" "$name"
shasum -a 256 "$out" 2>/dev/null || sha256sum "$out"
echo "wrote $out"
