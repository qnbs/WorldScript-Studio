#!/usr/bin/env bash
# Installs apt packages on a GitHub-hosted Ubuntu runner without waiting out the job timeout on an
# unreachable mirror. On 2026-11-11 azure.archive.ubuntu.com did not resolve on the runners, and
# `apt-get install` retried it until the 45-minute job timeout (tauri-build.yml dispatch 43037609935).
# Usage: bash scripts/ci/apt-install.sh <package>...
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: apt-install.sh <package>..." >&2
  exit 2
fi

MIRROR_HOST='azure.archive.ubuntu.com'
FALLBACK='http://archive.ubuntu.com/ubuntu'
APT_OPTIONS=(-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)

if ! getent hosts "$MIRROR_HOST" > /dev/null; then
  echo "::warning::$MIRROR_HOST does not resolve; using $FALLBACK for this job"
  for file in /etc/apt/apt-mirrors.txt /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
    if [ -f "$file" ]; then
      sudo sed -i "s|http://$MIRROR_HOST/ubuntu|$FALLBACK|g" "$file"
    fi
  done
fi

sudo apt-get "${APT_OPTIONS[@]}" update
sudo apt-get "${APT_OPTIONS[@]}" install -y "$@"
