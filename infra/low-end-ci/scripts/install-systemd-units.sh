#!/usr/bin/env bash
# Install user-specific systemd units (edit @HOME@ @USER@).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_DIR="${SCRIPT_DIR}/../systemd"
DEST="${HOME}/.config/systemd/user"

mkdir -p "${DEST}"
for unit in storycraft-forgejo.service storycraft-ci-prune.service storycraft-ci-prune.timer storycraft-mirror.service storycraft-mirror.timer; do
  sed -e "s|@HOME@|${HOME}|g" -e "s|@USER@|${USER}|g" \
    "${UNIT_DIR}/${unit}" >"${DEST}/${unit}"
done

systemctl --user daemon-reload
echo "Installed to ${DEST}"
echo "Enable timers: systemctl --user enable --now storycraft-ci-prune.timer"
echo "Optional mirror: systemctl --user enable --now storycraft-mirror.timer"
echo "Forgejo (manual): systemctl --user start storycraft-forgejo.service"
