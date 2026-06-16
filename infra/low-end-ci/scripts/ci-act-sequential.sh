#!/usr/bin/env bash
# Run GitHub Actions workflow jobs sequentially via act (low RAM).
# Usage: ci-act-sequential.sh [pull_request|push] [--with-storybook] [--with-mutation] [--e2e-chromium-only]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

EVENT="${1:-pull_request}"
shift || true

WITH_STORYBOOK=false
WITH_MUTATION=false
E2E_CHROMIUM_ONLY=false
for arg in "$@"; do
  case "${arg}" in
    --with-storybook) WITH_STORYBOOK=true ;;
    --with-mutation) WITH_MUTATION=true ;;
    --e2e-chromium-only) E2E_CHROMIUM_ONLY=true ;;
    -h | --help)
      echo "Usage: $0 [pull_request|push] [--with-storybook] [--with-mutation] [--e2e-chromium-only]"
      exit 0
      ;;
    *)
      echo "Unknown arg: ${arg}" >&2
      exit 1
      ;;
  esac
done

require_cmd act docker
cd "${REPO_ROOT}"

if [[ ! -f "${HOME}/.actrc" ]]; then
  log "WARN: ~/.actrc missing — copy infra/low-end-ci/.actrc.example"
fi
if [[ ! -f "${WORLDSCRIPT_CI_HOME}/act.secrets" ]]; then
  log "WARN: ${WORLDSCRIPT_CI_HOME}/act.secrets missing — copy act.secrets.example"
  mkdir -p "${WORLDSCRIPT_CI_HOME}"
  cp "${INFRA_DIR}/act.secrets.example" "${WORLDSCRIPT_CI_HOME}/act.secrets"
  chmod 600 "${WORLDSCRIPT_CI_HOME}/act.secrets"
fi

LOG_FILE="${CI_LOG_DIR}/act-${EVENT}-$(date +%Y%m%d-%H%M%S).log"
WORKFLOW="${REPO_ROOT}/.github/workflows/ci.yml"

# Single matrix axis (lts/* matches .nvmrc 22 on act-22.04 image)
MATRIX_ARGS=(--matrix "node-version:lts/*")

JOBS=(
  -j security
  -j quality
  "${MATRIX_ARGS[@]}"
  -j build
  -j e2e
  -j lighthouse
)

if [[ "${WITH_STORYBOOK}" == true ]]; then
  JOBS+=(-j storybook)
fi
if [[ "${WITH_MUTATION}" == true ]]; then
  JOBS+=(-j mutation)
fi

export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=1536}"
export PNPM_STORE_DIR

# Optional: limit Playwright to chromium inside container (set env read by custom step — document in DAILY-DRIVER)
if [[ "${E2E_CHROMIUM_ONLY}" == true ]]; then
  export PLAYWRIGHT_PROJECTS="chromium"
fi

log "act ${EVENT} --sequential (log: ${LOG_FILE})"
log "Stop Forgejo first if RAM < 3G: ci-eco-stop.sh"

"${SCRIPT_DIR}/ci-eco-stop.sh" 2>/dev/null || true

set +e
act "${EVENT}" \
  --sequential \
  -W "${WORKFLOW}" \
  "${JOBS[@]}" \
  2>&1 | tee "${LOG_FILE}"
ACT_EXIT=${PIPESTATUS[0]}
set -e

"${SCRIPT_DIR}/low-end-optimization.sh" --prune 2>/dev/null || true

if [[ "${ACT_EXIT}" -ne 0 ]]; then
  log "act failed (exit ${ACT_EXIT}). See ${LOG_FILE}"
  exit "${ACT_EXIT}"
fi

log "act sequential run finished OK."
