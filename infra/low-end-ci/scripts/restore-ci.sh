#!/usr/bin/env bash
# Restore Forgejo + act config from a backup folder.
# Usage: restore-ci.sh /path/to/backups/20260101-120000
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

SRC="${1:-}"
if [[ -z "${SRC}" || ! -d "${SRC}" ]]; then
  echo "Usage: $0 <backup-directory>" >&2
  exit 1
fi

"${SCRIPT_DIR}/ci-eco-stop.sh" || true

if [[ -f "${SRC}/forgejo.tar.gz" ]]; then
  log "Restoring forgejo..."
  rm -rf "${WORLDSCRIPT_CI_HOME}/forgejo"
  tar -xzf "${SRC}/forgejo.tar.gz" -C "${WORLDSCRIPT_CI_HOME}"
fi

[[ -f "${SRC}/.actrc" ]] && cp "${SRC}/.actrc" "${HOME}/.actrc"
[[ -f "${SRC}/act.secrets" ]] && cp "${SRC}/act.secrets" "${WORLDSCRIPT_CI_HOME}/act.secrets" && chmod 600 "${WORLDSCRIPT_CI_HOME}/act.secrets"

log "Restore done from ${SRC}. Start Forgejo: ci-eco-start.sh"
