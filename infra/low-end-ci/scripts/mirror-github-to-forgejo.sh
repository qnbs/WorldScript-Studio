#!/usr/bin/env bash
# Mirror Git remotes: Forgejo (primary) <-> GitHub (backup).
# Usage:
#   mirror-github-to-forgejo.sh --direction pull-from-github   # update local from GitHub
#   mirror-github-to-forgejo.sh --direction push-to-github     # backup local main to GitHub
#   mirror-github-to-forgejo.sh --direction sync-forgejo       # push all refs to Forgejo
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

DIRECTION="${1:-}"
BRANCH="${BRANCH:-main}"

usage() {
  echo "Usage: $0 --direction pull-from-github|push-to-github|sync-forgejo"
  exit 1
}

[[ "${DIRECTION}" == --direction=* ]] && DIRECTION="${DIRECTION#--direction=}"
[[ -z "${DIRECTION}" ]] && usage

cd "${REPO_ROOT}"
require_cmd git

has_remote() { git remote get-url "$1" >/dev/null 2>&1; }

case "${DIRECTION}" in
  pull-from-github)
    has_remote github || {
      echo "Add remote: git remote add github git@github.com:qnbs/WorldScript-Studio.git"
      exit 1
    }
    log "Fetching github..."
    git fetch github
    git checkout "${BRANCH}"
    git merge --ff-only "github/${BRANCH}" || {
      log "FF-only failed; resolve manually or rebase"
      exit 1
    }
    ;;
  push-to-github)
    has_remote github || {
      echo "Add remote github first"
      exit 1
    }
    log "Pushing ${BRANCH} to github (backup)..."
    git push github "${BRANCH}"
    ;;
  sync-forgejo)
    has_remote forgejo || {
      echo "Add remote: git remote add forgejo http://127.0.0.1:3000/<user>/WorldScript-Studio.git"
      exit 1
    }
    "${SCRIPT_DIR}/ci-eco-start.sh"
    log "Pushing to forgejo..."
    git push forgejo "${BRANCH}" --follow-tags
    ;;
  *)
    usage
    ;;
esac

log "Mirror ${DIRECTION} done."
