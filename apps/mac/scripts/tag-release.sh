#!/usr/bin/env bash
# Create and push a mac-v* tag to trigger the GitHub Actions Mac release.
# Usage: ./scripts/tag-release.sh [version]
# Default version comes from Info.plist CFBundleShortVersionString.
set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/lib.sh"

require_cmd git

cd "$REPO_ROOT"

VERSION="${1:-$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$MAC_DIR/Info.plist")}"
TAG="mac-v$VERSION"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag already exists: $TAG" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree has uncommitted changes. Commit or stash before tagging." >&2
  git status --short
  exit 1
fi

echo "==> Creating tag $TAG"
git tag "$TAG"
echo "==> Pushing $TAG to origin"
git push origin "$TAG"
REPO_URL="$(gh repo view --json url -q .url 2>/dev/null || true)"
if [[ -n "$REPO_URL" ]]; then
  echo "==> Done. Watch: ${REPO_URL}/actions/workflows/mac-release.yml"
else
  echo "==> Done. Tag pushed."
fi
