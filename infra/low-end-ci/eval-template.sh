#!/usr/bin/env bash
# WorldScript Studio — baseline hardware eval (read-only). Save output before installing local CI.
set -euo pipefail

OUT="${HOME}/worldscript-ci/eval-$(date +%F).txt"
mkdir -p "${HOME}/worldscript-ci"
{
  echo "=== WorldScript low-end CI eval ==="
  date -Is
  echo
  echo "--- Memory & swap ---"
  free -h
  swapon --show 2>/dev/null || true
  echo "swappiness=$(cat /proc/sys/vm/swappiness)"
  echo "vfs_cache_pressure=$(cat /proc/sys/vm/vfs_cache_pressure 2>/dev/null || echo n/a)"
  echo
  echo "--- CPU ---"
  nproc
  lscpu 2>/dev/null | grep -E 'Model name|MHz|CPU\(s\)' || true
  echo
  echo "--- Disk ---"
  df -h / /home 2>/dev/null || df -h
  if command -v hdparm >/dev/null 2>&1; then
    sudo hdparm -t /dev/sda 2>/dev/null || true
  fi
  echo
  echo "--- Kernel / cgroup ---"
  uname -r
  grep -E 'systemd_cgroup| cgroup' /proc/filesystems 2>/dev/null || true
  echo
  echo "--- Docker ---"
  docker --version 2>/dev/null || echo "docker: not installed"
  docker info 2>/dev/null | grep -E 'Cgroup|Memory|Swap|Storage Driver' || true
  echo
  echo "--- Node / pnpm (host) ---"
  command -v node >/dev/null && node -v || echo "node: not installed"
  command -v pnpm >/dev/null && pnpm -v || echo "pnpm: not installed"
  command -v act >/dev/null && act --version || echo "act: not installed"
} | tee "${OUT}"

echo "Saved: ${OUT}"
