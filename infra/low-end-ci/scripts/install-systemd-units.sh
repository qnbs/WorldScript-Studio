#!/usr/bin/env bash
# Install user-specific systemd units (edit @HOME@ @USER@).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_DIR="${SCRIPT_DIR}/../systemd"
DEST="${HOME}/.config/systemd/user"

mkdir -p "${DEST}"
for unit in worldscript-forgejo.service worldscript-ci-prune.service worldscript-ci-prune.timer worldscript-mirror.service worldscript-mirror.timer; do
  sed -e "s|@HOME@|${HOME}|g" -e "s|@USER@|${USER}|g" \
    "${UNIT_DIR}/${unit}" >"${DEST}/${unit}"
done

systemctl --user daemon-reload
echo "Installed to ${DEST}"
echo "Enable timers: systemctl --user enable --now worldscript-ci-prune.timer"
echo "Optional mirror: systemctl --user enable --now worldscript-mirror.timer"
echo "Forgejo (manual): systemctl --user start worldscript-forgejo.service"
