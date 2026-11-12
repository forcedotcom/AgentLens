#!/bin/bash
# Shared eval scaffold: lays down a Salesforce DX project whose .sfdx/agents
# holds real `sf agent preview` sessions, and seeds the AgentLens app cache in
# the run's temp HOME (runs have no network, as for an offline user).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
test -f "$REPO/index.html" || { echo "AgentLens index.html not found at $REPO" >&2; exit 1; }
if [ "${1:-}" != "--empty" ]; then
  cp -R "$HERE/project/." .
  mv sfdx .sfdx
else
  cp "$HERE/project/sfdx-project.json" .
fi
mkdir -p "$HOME/.cache/agentlens"
cp "$REPO/index.html" "$HOME/.cache/agentlens/index.html"
