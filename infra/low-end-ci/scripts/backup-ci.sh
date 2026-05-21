#!/usr/bin/env bash
# Backup Forgejo data, act config, and secrets to ~/storycraft-ci/backups/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="${STORYCRAFT_CI_HOME}/backups/${STAMP}"
mkdir -p "${DEST}"

log "Backing up to ${DEST}..."

if [[ -d "${STORYCRAFT_CI_HOME}/forgejo" ]]; then
  tar -czf "${DEST}/forgejo.tar.gz" -C "${STORYCRAFT_CI_HOME}" forgejo
fi

[[ -f "${HOME}/.actrc" ]] && cp "${HOME}/.actrc" "${DEST}/"
[[ -f "${STORYCRAFT_CI_HOME}/act.secrets" ]] && cp "${STORYCRAFT_CI_HOME}/act.secrets" "${DEST}/" && chmod 600 "${DEST}/act.secrets"

# pnpm store is reproducible — optional slim backup of config only
echo "${STORYCRAFT_CI_HOME}" >"${DEST}/storycraft-ci-home.txt"

# Prune old backups (keep 5)
ls -dt "${STORYCRAFT_CI_HOME}/backups/"*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf

log "Backup complete: ${DEST}"
