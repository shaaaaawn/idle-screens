#!/usr/bin/env bash
# Full local release: ensure notary creds, then sign + notarize + staple.
# Reads signing values from repo .env when present.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

load_mac_env

export DEVELOPER_ID="$(require_developer_id)"
export NOTARY_PROFILE="$(resolve_notary_profile)"

ensure_notary_profile
trap 'unset_sensitive_env' EXIT

exec "$MAC_DIR/scripts/notarize.sh" "$@"
