#!/usr/bin/env bash
# Build + run against the locally staged web bundle.
#
#   ./scripts/dev-run.sh --windowed --saver warp      # dev window (no exit-on-input)
#   ./scripts/dev-run.sh --windowed --channel ballet  # in-session channel preview
#   ./scripts/dev-run.sh --saver warp --seed 42       # bundled savers, real overlay
#   SKIP_WEB=1 ./scripts/dev-run.sh ...               # skip the web rebuild
set -euo pipefail
cd "$(dirname "$0")/.."

[ "${SKIP_WEB:-}" ] || ./scripts/sync-web.sh
exec cargo run -- --web-root ./webroot --no-update-check "$@"
