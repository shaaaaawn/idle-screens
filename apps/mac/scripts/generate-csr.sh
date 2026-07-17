#!/usr/bin/env bash
# Generate a CSR + private key for a Developer ID Application certificate.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

load_mac_env
trap 'unset_sensitive_env' EXIT

: "${CSR_ORG:?Set CSR_ORG in $ENV_FILE (legal entity name, e.g. \"Your Org, LLC\")}"

CN="${CSR_CN:-Developer ID Application: $CSR_ORG}"

mkdir -p "$SECRETS_DIR"
KEY="$SECRETS_DIR/developer-id.key"
CSR="$SECRETS_DIR/developer-id.csr"

if [[ -f "$KEY" ]]; then
  echo "Private key already exists: $KEY"
  echo "Delete it first if you need a new CSR."
  exit 1
fi

echo "==> Generating CSR"
echo "    O=$CSR_ORG"
openssl req -new -newkey rsa:2048 -nodes \
  -keyout "$KEY" -out "$CSR" \
  -subj "/CN=$CN/O=$CSR_ORG/C=US"

echo "==> Done"
echo "    CSR:  $CSR  (upload this at developer.apple.com)"
echo "    Key:  $KEY  (keep local; never commit)"
echo
echo "Next:"
echo "  1. https://developer.apple.com/account/resources/certificates/add"
echo "  2. Choose Developer ID Application"
echo "  3. Upload $CSR"
echo "  4. Download the .cer and double-click to install"
echo "  5. Fill .env and run ./scripts/setup-notary.sh"
