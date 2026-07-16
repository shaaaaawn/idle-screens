#!/usr/bin/env bash
# Push remaining macOS signing secrets to GitHub.
# Reads apps/mac/.secrets/ + repo .env when present.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MAC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS_DIR="$MAC_DIR/.secrets"
ENV_FILE="$ROOT/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

P12_PASSWORD="${P12_PASSWORD:-${MACOS_CERTIFICATE_PWD:-}}"
: "${P12_PASSWORD:?Set P12_PASSWORD (or MACOS_CERTIFICATE_PWD) in .env}"
: "${APPLE_APP_PASSWORD:?Set APPLE_APP_PASSWORD in .env}"

DEVELOPER_ID="$(security find-identity -v -p codesigning \
  | awk -F'"' '/Developer ID Application/ { print $2; exit }')"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
P12="$TMP/cert.p12"

if [[ -n "$DEVELOPER_ID" ]]; then
  security export -k login.keychain-db -t identities -f pkcs12 -P "$P12_PASSWORD" \
    -o "$P12" "$DEVELOPER_ID"
else
  KEY="$SECRETS_DIR/developer-id.key"
  CER="${DEVELOPER_ID_CER:-}"
  if [[ -z "$CER" ]]; then
    CER="$(find "$HOME/Downloads" -maxdepth 1 -name '*.cer' -print0 2>/dev/null \
      | xargs -0 -I{} sh -c 'openssl x509 -in "$1" -inform DER -noout -subject 2>/dev/null | rg -q "Developer ID Application" && echo "$1"' _ {} \
      | head -1 || true)"
  fi
  if [[ -z "$CER" || ! -f "$KEY" ]]; then
    echo "No 'Developer ID Application' identity in Keychain." >&2
    echo "Download the Developer ID Application cert (not Apple Distribution) and either:" >&2
    echo "  - double-click to install, or" >&2
    echo "  - set DEVELOPER_ID_CER=/path/to/cert.cer and re-run" >&2
    exit 1
  fi
  DEVELOPER_ID="$(openssl x509 -in "$CER" -inform DER -noout -subject \
    | sed -n 's/.*CN=\([^,]*\).*/\1/p')"
  openssl pkcs12 -export -out "$P12" -inkey "$KEY" -in "$CER" -passout "pass:$P12_PASSWORD"
fi

base64 < "$P12" | gh secret set MACOS_CERTIFICATE
gh secret set MACOS_CERTIFICATE_PWD --body "$P12_PASSWORD"
gh secret set MACOS_DEVELOPER_ID --body "$DEVELOPER_ID"
gh secret set APPLE_APP_PASSWORD --body "$APPLE_APP_PASSWORD"

echo "Set MACOS_CERTIFICATE, MACOS_CERTIFICATE_PWD, MACOS_DEVELOPER_ID, APPLE_APP_PASSWORD"
echo "DEVELOPER_ID=$DEVELOPER_ID"
gh secret list | rg 'MACOS_|APPLE_'
