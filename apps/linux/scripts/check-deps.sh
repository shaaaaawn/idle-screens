#!/usr/bin/env bash
# Verify native build dependencies before building idle-screens-wayland.
#
# Probes pkg-config modules rather than asking a package manager: the module
# names are identical on every distro, so this works unchanged on distros we
# have never seen. The capability probe fails HARD (a missing module means the
# build cannot succeed); the distro map in distro.sh is advisory and never fails.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/distro.sh
. ./scripts/distro.sh

if ! command -v pkg-config >/dev/null 2>&1; then
  echo "pkg-config not found — it is required to locate the native libraries." >&2
  echo "Detected distro family: $(idle_distro_family)" >&2
  idle_install_hint >&2
  exit 1
fi

missing=()
for entry in "${IDLE_PC_MODULES[@]}"; do
  mod="${entry%%:*}"
  min="${entry##*:}"
  have="$(pkg-config --modversion "$mod" 2>/dev/null || echo 'not installed')"
  pkg-config --exists "$mod >= $min" 2>/dev/null || missing+=("$mod >= $min — $have")
done

if ! command -v cargo >/dev/null 2>&1; then
  rust_version="$(grep -m1 '^rust-version' Cargo.toml | sed 's/.*"\(.*\)".*/\1/')"
  missing+=("cargo — install via rustup; this crate needs rustc >= ${rust_version:-1.92}")
fi

if ((${#missing[@]})); then
  echo "Missing build dependencies:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  echo >&2
  echo "Detected distro family: $(idle_distro_family)" >&2
  echo "Install with:" >&2
  idle_install_hint >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1 \
  && [ ! -x "$(git rev-parse --show-toplevel 2>/dev/null)/node_modules/.bin/pnpm" ]; then
  echo "pnpm not found — sync-web.sh will fall back to npx pnpm@9" >&2
fi

echo "All native build dependencies present ($(idle_distro_family))."
