#!/usr/bin/env bash
# Native Quick-Tier CI (no Docker). Matches docs/CI.md low-resource tier.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

cd "${REPO_ROOT}"
require_cmd pnpm node

WITH_COVERAGE=false
WITH_UNIT=false
for arg in "$@"; do
  case "${arg}" in
    --coverage) WITH_COVERAGE=true; WITH_UNIT=true ;;
    --unit) WITH_UNIT=true ;;
  esac
done

export PNPM_STORE_DIR
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"

log "Repo: ${REPO_ROOT}"
log "pnpm store: ${PNPM_STORE_DIR}"

pnpm install --frozen-lockfile
pnpm run lint
pnpm run i18n:check
pnpm run typecheck
pnpm run build-storybook

if [[ "${WITH_UNIT}" == true ]]; then
  if [[ "${WITH_COVERAGE}" == true ]]; then
    pnpm exec vitest run --coverage
  else
    pnpm exec vitest run
  fi
fi

log "Quick tier passed."
