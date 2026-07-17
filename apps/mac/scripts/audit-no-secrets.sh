#!/usr/bin/env bash
# Fail if mac scripts appear to contain hardcoded secrets.
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
FAIL=0

echo "==> Auditing $SCRIPTS_DIR for hardcoded secrets"

# Literal secret patterns only — env var references like $APPLE_APP_PASSWORD are fine.
while IFS= read -r match; do
  [[ -z "$match" ]] && continue
  echo "$match" >&2
  FAIL=1
done < <(rg -n -i \
  --glob '*.sh' \
  --glob '!audit-no-secrets.sh' \
  '@(gmail|icloud|yahoo)\.com|cfat_[a-z0-9]|ghp_[a-zA-Z0-9]|gho_[a-zA-Z0-9]|github_pat_|-----BEGIN [A-Z ]*PRIVATE KEY|poti-[a-z]{4}-' \
  "$SCRIPTS_DIR" 2>/dev/null || true)

if [[ "$FAIL" -ne 0 ]]; then
  echo "==> Hardcoded secrets detected in mac scripts" >&2
  exit 1
fi

echo "==> No hardcoded secrets found in mac scripts"
