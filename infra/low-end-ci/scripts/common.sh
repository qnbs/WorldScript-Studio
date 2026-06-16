#!/usr/bin/env bash
# Shared paths for WorldScript low-end CI scripts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${INFRA_DIR}/../.." && pwd)"

export WORLDSCRIPT_CI_HOME="${WORLDSCRIPT_CI_HOME:-${HOME}/worldscript-ci}"
export PNPM_STORE_DIR="${PNPM_STORE_DIR:-${WORLDSCRIPT_CI_HOME}/cache/pnpm-store}"
export ACT_CACHE_DIR="${ACT_CACHE_DIR:-${WORLDSCRIPT_CI_HOME}/cache/act}"
export FORGEJO_COMPOSE="${FORGEJO_COMPOSE:-${INFRA_DIR}/docker-compose.forgejo.yml}"
export CI_LOG_DIR="${CI_LOG_DIR:-${WORLDSCRIPT_CI_HOME}/logs}"

mkdir -p "${WORLDSCRIPT_CI_HOME}" "${PNPM_STORE_DIR}" "${ACT_CACHE_DIR}/artifacts" "${CI_LOG_DIR}" \
  "${WORLDSCRIPT_CI_HOME}/backups" "${WORLDSCRIPT_CI_HOME}/forgejo/data" "${WORLDSCRIPT_CI_HOME}/forgejo/config"

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

require_cmd() {
  local c
  for c in "$@"; do
    command -v "${c}" >/dev/null 2>&1 || {
      echo "Missing command: ${c}" >&2
      exit 1
    }
  done
}
