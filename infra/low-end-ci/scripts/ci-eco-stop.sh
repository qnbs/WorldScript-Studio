#!/usr/bin/env bash
# Stop Forgejo and optionally prune dangling Docker data to free RAM/disk.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

PRUNE=false
[[ "${1:-}" == "--prune" ]] && PRUNE=true

if systemctl is-active --quiet worldscript-forgejo.service 2>/dev/null; then
  log "Stopping worldscript-forgejo.service..."
  sudo systemctl stop worldscript-forgejo.service
fi

if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q '^worldscript-forgejo$'; then
  log "Stopping Forgejo container..."
  docker compose -f "${FORGEJO_COMPOSE}" down
fi

# Kill stray act containers
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -E 'act-|GITHUB' >/dev/null; then
  log "Removing act containers..."
  docker ps -a --format '{{.Names}}' | grep -E 'act-|GITHUB' | xargs -r docker rm -f
fi

if [[ "${PRUNE}" == true ]] && command -v docker >/dev/null; then
  docker system prune -f
fi

log "Eco stop complete."
