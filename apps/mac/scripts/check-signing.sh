#!/usr/bin/env bash
# Verify local signing + notary prerequisites before a release.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

load_mac_env
OK=1

check() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  ok  $label"
  else
    echo "  FAIL $label" >&2
    OK=0
  fi
}

echo "==> Checking macOS release prerequisites"
echo

if [[ -f "$ENV_FILE" ]]; then
  echo "  ok  .env found at $ENV_FILE"
else
  echo "  warn .env missing (copy fields from README Release section)" >&2
fi

DEVELOPER_ID="$(resolve_developer_id || true)"
if [[ -n "$DEVELOPER_ID" ]]; then
  echo "  ok  Developer ID Application cert found"
else
  echo "  FAIL Developer ID Application cert not in Keychain" >&2
  OK=0
fi

PROFILE="$(resolve_notary_profile)"
if notary_profile_exists "$PROFILE"; then
  echo "  ok  Notary profile: $PROFILE"
else
  echo "  FAIL Notary profile '$PROFILE' (run ./scripts/setup-notary.sh)" >&2
  OK=0
fi

for var in APPLE_ID APPLE_TEAM_ID APPLE_APP_PASSWORD; do
  if [[ -n "${!var:-}" ]]; then
    echo "  ok  $var set"
  else
    echo "  FAIL $var not set in .env" >&2
    OK=0
  fi
done

for var in P12_PASSWORD MACOS_CERTIFICATE_PWD; do
  if [[ -n "${P12_PASSWORD:-}" || -n "${MACOS_CERTIFICATE_PWD:-}" ]]; then
    echo "  ok  P12 export password set"
    break
  fi
done
if [[ -z "${P12_PASSWORD:-}" && -z "${MACOS_CERTIFICATE_PWD:-}" ]]; then
  echo "  warn P12_PASSWORD not set (needed for setup-gh-secrets.sh only)" >&2
fi

check "codesign available" command -v codesign
check "notarytool available" command -v xcrun
check "gh CLI available" command -v gh

echo
if [[ "$OK" -eq 1 ]]; then
  echo "==> Ready for ./scripts/release-local.sh"
else
  echo "==> Fix the failures above before releasing" >&2
  exit 1
fi
