#!/bin/bash
set -euo pipefail

# Web uniquement
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
# npm install (et non npm ci) pour profiter du cache du conteneur ; .npmrc impose legacy-peer-deps.
# --no-save : le npm du conteneur réécrit package-lock.json à chaque installation (il retire les
# champs "libc" des paquets optionnels), ce qui laissait le dépôt "modifié" à chaque session.
# L'option n'écrit ni package.json ni package-lock.json mais respecte le lockfile existant.
npm install --no-save --no-audit --no-fund
