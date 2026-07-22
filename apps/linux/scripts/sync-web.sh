#!/usr/bin/env bash
# Build the shared web bundle and stage it into apps/linux/webroot/.
set -euo pipefail
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
cd "$root"

pnpm install --frozen-lockfile
pnpm build
pnpm --filter @idle-screens/mac-web run build

rsync -a --delete apps/mac/web/dist/ apps/linux/webroot/
echo "staged web bundle → apps/linux/webroot/"
