#!/usr/bin/env bash
# Low-overhead status: RAM, swap, Docker, last act log.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

echo "=== WorldScript CI status ==="
date -Is
echo
echo "--- Memory ---"
free -h
swapon --show 2>/dev/null || echo "(no swap)"
echo
echo "--- Docker ---"
if command -v docker >/dev/null; then
  docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Size}}' 2>/dev/null || true
  docker system df 2>/dev/null || true
else
  echo "docker not installed"
fi
echo
echo "--- Forgejo ---"
if curl -fsS http://127.0.0.1:3000/api/healthz >/dev/null 2>&1; then
  echo "Forgejo: up http://127.0.0.1:3000"
else
  echo "Forgejo: down (eco-mode OK)"
fi
echo
echo "--- Last act log ---"
LAST_LOG="$(ls -t "${CI_LOG_DIR}"/act-*.log 2>/dev/null | head -1 || true)"
if [[ -n "${LAST_LOG}" ]]; then
  echo "${LAST_LOG}"
  tail -5 "${LAST_LOG}"
else
  echo "(no act logs yet)"
fi
