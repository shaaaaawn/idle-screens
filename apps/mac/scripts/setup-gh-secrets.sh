#!/usr/bin/env bash
# Push macOS signing secrets to GitHub Actions (reads repo .env + Keychain / .secrets).
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

load_mac_env
require_cmd gh
trap 'unset_sensitive_env; rm -rf "${TMP:-}"' EXIT

P12_PASSWORD="${P12_PASSWORD:-${MACOS_CERTIFICATE_PWD:-}}"
: "${P12_PASSWORD:?Set P12_PASSWORD (or MACOS_CERTIFICATE_PWD) in $ENV_FILE}"
: "${APPLE_ID:?Set APPLE_ID in $ENV_FILE}"
: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID in $ENV_FILE}"
: "${APPLE_APP_PASSWORD:?Set APPLE_APP_PASSWORD in $ENV_FILE}"

DEVELOPER_ID="$(resolve_developer_id)"

TMP="$(mktemp -d)"
P12="$TMP/cert.p12"

if [[ -n "$DEVELOPER_ID" ]] && security find-identity -v -p codesigning | rg -qF "$DEVELOPER_ID"; then
  export_p12_from_keychain "$DEVELOPER_ID" "$P12" "$P12_PASSWORD"
else
  KEY="$SECRETS_DIR/developer-id.key"
  CER="$(find_developer_id_cer || true)"
  if [[ -z "$CER" || ! -f "$KEY" ]]; then
    echo "No Developer ID Application identity in Keychain." >&2
    echo "Download the Developer ID Application cert and either:" >&2
    echo "  - double-click to install, or" >&2
    echo "  - set DEVELOPER_ID_CER=/path/to/cert.cer and re-run" >&2
    exit 1
  fi
  DEVELOPER_ID="$(developer_id_from_cer "$CER")"
  export_p12_from_cer "$KEY" "$CER" "$P12" "$P12_PASSWORD"
fi

base64 < "$P12" | gh secret set MACOS_CERTIFICATE
gh secret set MACOS_CERTIFICATE_PWD --body "$P12_PASSWORD"
gh secret set MACOS_DEVELOPER_ID --body "$DEVELOPER_ID"
gh secret set APPLE_ID --body "$APPLE_ID"
gh secret set APPLE_TEAM_ID --body "$APPLE_TEAM_ID"
gh secret set APPLE_APP_PASSWORD --body "$APPLE_APP_PASSWORD"

echo "==> GitHub secrets updated (6 signing secrets)"
gh secret list | rg 'MACOS_|APPLE_'
