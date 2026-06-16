#!/usr/bin/env bash
# Start Forgejo only (eco-mode). Does not start act runners.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

export FORGEJO_DATA_DIR="${WORLDSCRIPT_CI_HOME}/forgejo/data"
export FORGEJO_CONFIG_DIR="${WORLDSCRIPT_CI_HOME}/forgejo/config"

if systemctl list-unit-files worldscript-forgejo.service >/dev/null 2>&1; then
  log "Starting worldscript-forgejo.service..."
  sudo systemctl start worldscript-forgejo.service
else
  log "Starting Forgejo via docker compose..."
  require_cmd docker
  docker compose -f "${FORGEJO_COMPOSE}" up -d
fi

log "Forgejo: http://127.0.0.1:3000 (localhost only)"
