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
UNIT_PATH=""
for arg in "$@"; do
  case "${arg}" in
    --coverage) WITH_COVERAGE=true; WITH_UNIT=true ;;
    --unit=*) WITH_UNIT=true; UNIT_PATH="${arg#--unit=}" ;;
    --unit) WITH_UNIT=true; UNIT_PATH="${VITEST_PATH:-}" ;;
  esac
done

if [[ "${WITH_UNIT}" == true && -z "${UNIT_PATH}" ]]; then
  log "A targeted test path is required: set VITEST_PATH or pass --unit=<path>."
  exit 2
fi

export PNPM_STORE_DIR
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"

log "Repo: ${REPO_ROOT}"
log "pnpm store: ${PNPM_STORE_DIR}"

pnpm install --frozen-lockfile
pnpm run lint
pnpm run guardrail:desktop-imports
pnpm run i18n:check
pnpm run typecheck
pnpm run build-storybook

if [[ "${WITH_UNIT}" == true ]]; then
  if [[ "${WITH_COVERAGE}" == true ]]; then
    # QNBS-v3: targeted coverage is diagnostic only, so it must not inherit full-suite gates.
    pnpm exec vitest run "${UNIT_PATH}" --coverage \
      --coverage.thresholds.lines=0 \
      --coverage.thresholds.functions=0 \
      --coverage.thresholds.branches=0 \
      --coverage.thresholds.statements=0
  else
    pnpm exec vitest run "${UNIT_PATH}"
  fi
fi

log "Quick tier passed."
