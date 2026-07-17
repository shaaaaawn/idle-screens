#!/usr/bin/env bash
# Shared helpers for macOS sign / notarize scripts.
# Secrets belong in repo-root .env (gitignored) or Keychain — never in this file.
set -euo pipefail

MAC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$MAC_DIR/../.." && pwd)"
SECRETS_DIR="$MAC_DIR/.secrets"
ENV_FILE="$REPO_ROOT/.env"
DEFAULT_NOTARY_PROFILE="idle-notary"

# Vars that may hold secrets after load_mac_env.
SENSITIVE_ENV_VARS=(
  APPLE_APP_PASSWORD
  P12_PASSWORD
  MACOS_CERTIFICATE_PWD
  MACOS_CERTIFICATE
  CLOUDFLARE_TOKEN
)

load_mac_env() {
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
  fi
}

unset_sensitive_env() {
  local var
  for var in "${SENSITIVE_ENV_VARS[@]}"; do
    unset "$var" 2>/dev/null || true
  done
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Missing required command: $cmd" >&2
    exit 1
  }
}

resolve_developer_id() {
  if [[ -n "${DEVELOPER_ID:-}" ]]; then
    printf '%s\n' "$DEVELOPER_ID"
    return 0
  fi
  if [[ -n "${MACOS_DEVELOPER_ID:-}" ]]; then
    printf '%s\n' "$MACOS_DEVELOPER_ID"
    return 0
  fi
  security find-identity -v -p codesigning \
    | awk -F'"' '/Developer ID Application/ { print $2; exit }'
}

resolve_notary_profile() {
  printf '%s\n' "${NOTARY_PROFILE:-$DEFAULT_NOTARY_PROFILE}"
}

notary_profile_exists() {
  local profile="$1"
  xcrun notarytool history --keychain-profile "$profile" >/dev/null 2>&1
}

ensure_notary_profile() {
  local profile
  profile="$(resolve_notary_profile)"
  if notary_profile_exists "$profile"; then
    echo "==> Notary profile '$profile' already in Keychain"
    return 0
  fi

  : "${APPLE_ID:?Set APPLE_ID in $ENV_FILE}"
  : "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID in $ENV_FILE}"

  echo "==> Storing notary credentials as '$profile'"
  if [[ -n "${APPLE_APP_PASSWORD:-}" ]]; then
    xcrun notarytool store-credentials "$profile" \
      --apple-id "$APPLE_ID" \
      --team-id "$APPLE_TEAM_ID" \
      --password "$APPLE_APP_PASSWORD"
  elif [[ -t 0 ]]; then
    # Avoid putting the app-specific password on the command line when possible.
    xcrun notarytool store-credentials "$profile" \
      --apple-id "$APPLE_ID" \
      --team-id "$APPLE_TEAM_ID"
  else
    echo "Set APPLE_APP_PASSWORD in $ENV_FILE or run interactively." >&2
    return 1
  fi
}

require_developer_id() {
  local id
  id="$(resolve_developer_id)"
  if [[ -z "$id" ]]; then
    echo "No Developer ID Application identity found." >&2
    echo "Install the cert from Apple Developer portal, or set DEVELOPER_ID in $ENV_FILE." >&2
    exit 1
  fi
  printf '%s\n' "$id"
}

find_developer_id_cer() {
  local explicit="${DEVELOPER_ID_CER:-}"
  if [[ -n "$explicit" && -f "$explicit" ]]; then
    printf '%s\n' "$explicit"
    return 0
  fi
  find "$HOME/Downloads" -maxdepth 1 -name '*.cer' -print0 2>/dev/null \
    | xargs -0 -I{} sh -c '
        openssl x509 -in "$1" -inform DER -noout -subject 2>/dev/null \
          | grep -q "Developer ID Application" && echo "$1"
      ' _ {} \
    | head -1
}

developer_id_from_cer() {
  openssl x509 -in "$1" -inform DER -noout -subject \
    | sed -n 's/.*CN=\([^,]*\).*/\1/p'
}

export_p12_from_keychain() {
  local identity="$1" out="$2" password="$3"
  security export -k login.keychain-db -t identities -f pkcs12 -P "$password" \
    -o "$out" "$identity"
}

export_p12_from_cer() {
  local key="$1" cer="$2" out="$3" password="$4"
  # Use env: so the password is not passed on the openssl command line.
  OPENSSL_P12_PASSWORD="$password" \
    openssl pkcs12 -export -out "$out" -inkey "$key" -in "$cer" -passout env:OPENSSL_P12_PASSWORD
  unset OPENSSL_P12_PASSWORD
}
