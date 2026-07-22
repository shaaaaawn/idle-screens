#!/usr/bin/env bash
# Verify native build/runtime dependencies before building idle-screens-wayland.
set -euo pipefail

missing=()
for pkg in gtk4 webkitgtk-6.0 gtk4-layer-shell libadwaita; do
  if ! pacman -Q "$pkg" >/dev/null 2>&1; then
    missing+=("$pkg")
  fi
done

if ! command -v cargo >/dev/null 2>&1; then
  missing+=("rust (cargo)")
fi

if ((${#missing[@]})); then
  echo "Missing dependencies:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
  echo >&2
  echo "Install on Arch/Omarchy:" >&2
  echo "  sudo pacman -S --needed base-devel rustup gtk4 webkitgtk-6.0 gtk4-layer-shell libadwaita" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1 \
  && [ ! -x "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)/node_modules/.bin/pnpm" ]; then
  echo "pnpm not found — sync-web.sh will fall back to npx pnpm@9" >&2
fi

echo "All native dependencies present."
