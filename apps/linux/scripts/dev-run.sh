#!/usr/bin/env bash
# Build + run against the locally staged web bundle.
#
#   ./scripts/dev-run.sh --windowed --channel ballet   # in-session dev window
#   ./scripts/dev-run.sh --saver warp --seed 42        # bundled savers, overlay
#   SKIP_WEB=1 ./scripts/dev-run.sh ...                # skip the web rebuild
set -euo pipefail
cd "$(dirname "$0")/.."

[ "${SKIP_WEB:-}" ] || ./scripts/sync-web.sh
exec cargo run -- --web-root ./webroot --no-update-check "$@"
