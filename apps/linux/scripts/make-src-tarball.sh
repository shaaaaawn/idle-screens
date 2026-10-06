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
# build.rs is not optional: it defines IDLE_GIT_COMMIT / IDLE_BUILD_DATE /
# IDLE_BUILD_KIND, which about.rs reads with env!() at compile time. Omitting
# it made `makepkg` fail outright with "environment variable not defined".
cp -R Cargo.toml Cargo.lock rustfmt.toml build.rs src packaging webroot "$staging/$name/"
cp ../../LICENSE "$staging/$name/LICENSE" 2>/dev/null || true
tar -czf "$out" -C "$staging" "$name"
shasum -a 256 "$out" 2>/dev/null || sha256sum "$out"
echo "wrote $out"
