#!/usr/bin/env bash
# Kick off a release without leaving the terminal — this only asks GitHub to
# run .github/workflows/release.yml; the bump, tag, promotion, packing and
# publishing all happen there, on a clean checkout.
#
# Usage:
#   ./release.sh              # minor bump (1.1 -> 1.2)
#   ./release.sh patch        # 1.1 -> 1.1.1
#   ./release.sh major        # 1.1 -> 2.0
#   ./release.sh 2.0          # exact version
#
# Equivalent to clicking Actions > Release > "Run workflow" on GitHub.

set -euo pipefail
cd "$(dirname "$0")"

command -v gh >/dev/null || {
  echo "error: gh CLI not found — use the Run workflow button in the Actions tab" >&2
  exit 1
}

ARG="${1:-minor}"
if [[ "$ARG" =~ ^(major|minor|patch)$ ]]; then
  FLAGS=(-f "bump=$ARG")
  echo "Requesting a $ARG release…"
elif [[ "$ARG" =~ ^[0-9]+(\.[0-9]+){0,3}$ ]]; then
  FLAGS=(-f "bump=minor" -f "version=$ARG")
  echo "Requesting release $ARG…"
else
  echo "error: expected major|minor|patch or a version like 1.2 — got '$ARG'" >&2
  exit 1
fi

gh workflow run release.yml --ref main "${FLAGS[@]}"
echo "Started: https://github.com/wenhongg/daytab/actions/workflows/release.yml"
