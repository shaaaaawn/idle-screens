#!/usr/bin/env bash
# Store notarytool credentials in Keychain (reads repo .env).
# Safe to re-run; skips if the profile already exists.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

load_mac_env
ensure_notary_profile
trap 'unset_sensitive_env' EXIT
echo "==> Done. Use NOTARY_PROFILE=$(resolve_notary_profile) when notarizing."
