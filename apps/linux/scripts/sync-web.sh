#!/usr/bin/env bash
# Build the shared web bundle and stage it into apps/linux/webroot/.
set -euo pipefail
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$root"

run_pnpm() {
  if [ -x "$root/node_modules/.bin/pnpm" ]; then
    "$root/node_modules/.bin/pnpm" "$@"
  elif pnpm_bin="$(type -P pnpm 2>/dev/null)"; then
    "$pnpm_bin" "$@"
  else
    npx --yes pnpm@9 "$@"
  fi
}

run_pnpm install --frozen-lockfile
run_pnpm build
run_pnpm --filter @idle-screens/mac-web run build

rsync -a --delete apps/mac/web/dist/ apps/linux/webroot/
echo "staged web bundle → apps/linux/webroot/"
