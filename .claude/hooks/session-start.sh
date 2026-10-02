#!/bin/bash
set -euo pipefail

# Web uniquement
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
# npm install (et non npm ci) pour profiter du cache du conteneur ; .npmrc impose legacy-peer-deps
npm install --no-audit --no-fund
