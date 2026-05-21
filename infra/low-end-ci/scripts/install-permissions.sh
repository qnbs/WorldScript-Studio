#!/usr/bin/env bash
# chmod +x all scripts in infra/low-end-ci/scripts
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
chmod +x "${SCRIPT_DIR}"/*.sh "${SCRIPT_DIR}/../eval-template.sh" 2>/dev/null || true
echo "Executable: ${SCRIPT_DIR}/*.sh"
