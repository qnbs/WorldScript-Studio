#!/usr/bin/env bash
# Ubuntu 20.04 low-end tweaks: sysctl, Docker logs, tmpfs cache, post-build cleanup.
# Run once after install and after heavy act runs: ./low-end-optimization.sh [--tmpfs] [--prune]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "${SCRIPT_DIR}/common.sh"

ENABLE_TMPFS=false
ENABLE_PRUNE=false
for arg in "$@"; do
  case "${arg}" in
    --tmpfs) ENABLE_TMPFS=true ;;
    --prune) ENABLE_PRUNE=true ;;
    -h | --help)
      echo "Usage: $0 [--tmpfs] [--prune]"
      exit 0
      ;;
  esac
done

log "Applying sysctl (needs sudo)..."
if [[ -w /etc/sysctl.d ]] || sudo -n true 2>/dev/null; then
  sudo tee /etc/sysctl.d/99-storycraft-lowend.conf >/dev/null <<'EOF'
# StoryCraft low-end laptop
vm.swappiness=10
vm.vfs_cache_pressure=50
EOF
  sudo sysctl --system >/dev/null 2>&1 || sudo sysctl -p /etc/sysctl.d/99-storycraft-lowend.conf
else
  log "Skip sysctl (no sudo)"
fi

if command -v docker >/dev/null 2>&1; then
  log "Ensuring Docker log rotation in daemon.json (manual merge if file exists)"
  if [[ ! -f /etc/docker/daemon.json ]]; then
    echo 'Install /etc/docker/daemon.json from INSTALL.md if Docker logs grow large.'
  fi
  if [[ "${ENABLE_PRUNE}" == true ]]; then
    log "Docker system prune (dangling only)..."
    docker system prune -f
  fi
fi

# Stop Forgejo after builds to free RAM (eco-mode)
if systemctl is-active --quiet storycraft-forgejo.service 2>/dev/null; then
  log "Stopping storycraft-forgejo.service (eco)..."
  sudo systemctl stop storycraft-forgejo.service || true
fi

if [[ "${ENABLE_TMPFS}" == true ]]; then
  TMPFS_DIR="${STORYCRAFT_CI_HOME}/tmpfs-cache"
  mkdir -p "${TMPFS_DIR}"
  if ! mountpoint -q "${TMPFS_DIR}" 2>/dev/null; then
    mem_kb=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
    if [[ "${mem_kb}" -gt 2500000 ]]; then
      log "Mounting tmpfs at ${TMPFS_DIR} (512M)..."
      sudo mount -t tmpfs -o size=512M tmpfs "${TMPFS_DIR}" || log "tmpfs mount failed (OK on 2GB machines)"
    else
      log "Skip tmpfs: MemAvailable < ~2.5G"
    fi
  fi
fi

# Lower priority for leftover act runner processes (best-effort)
if pgrep -f 'act/' >/dev/null 2>&1; then
  log "Renicing act-related processes (+5)..."
  sudo renice +5 -p "$(pgrep -f 'act/' | tr '\n' ' ')" 2>/dev/null || true
fi

log "Done. swappiness=$(cat /proc/sys/vm/swappiness) Mem: $(free -h | awk '/^Mem:/ {print $3 "/" $2}')"
