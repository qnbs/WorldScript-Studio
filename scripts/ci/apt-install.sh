#!/usr/bin/env bash
# Installs apt packages on a GitHub-hosted Ubuntu runner without waiting out the job timeout on an
# unreachable mirror. On 2026-11-11 the runners could not resolve azure.archive.ubuntu.com,
# archive.ubuntu.com or security.ubuntu.com (actions/runner-images#15296), and `apt-get install`
# retried them until the 45-minute job timeout (tauri-build.yml dispatch 43037609935).
# The helper probes each candidate mirror's InRelease first and points this job's apt mirror list at
# the first one that answers. Only this job's ephemeral runner changes. apt still verifies every index
# against the Ubuntu archive keyring; no signature or transport setting is touched.
# Usage: bash scripts/ci/apt-install.sh <package>...
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: apt-install.sh <package>..." >&2
  exit 2
fi

APT_ETC="${APT_INSTALL_ETC:-/etc/apt}"
# The image default, Canonical's primary archive, then an official Ubuntu mirror outside ubuntu.com over HTTPS.
CANDIDATES=(http://azure.archive.ubuntu.com/ubuntu https://archive.ubuntu.com/ubuntu https://mirrors.edge.kernel.org/ubuntu)
# Worst case 3 x 20 s probes + 300 s update + 480 s install + 2 x 10 s kill grace = 860 s, inside the 15-minute step cap.
PROBE_SECONDS=20
UPDATE_SECONDS=300
INSTALL_SECONDS=480
KILL_SECONDS=10
APT_OPTIONS=(-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)
CODENAME="$(sed -n 's/^VERSION_CODENAME=//p' /etc/os-release)"
if [ -z "$CODENAME" ]; then
  echo "::error::cannot read VERSION_CODENAME from /etc/os-release"
  exit 1
fi

MIRROR=''
for candidate in "${CANDIDATES[@]}"; do
  status=0
  curl --silent --show-error --fail --max-time "$PROBE_SECONDS" --output /dev/null "$candidate/dists/$CODENAME/InRelease" || status=$?
  if [ "$status" -eq 0 ]; then
    MIRROR="$candidate"
    break
  fi
  echo "::warning::apt mirror $candidate did not answer (curl exit $status)"
done
if [ -z "$MIRROR" ]; then
  echo "::error::no apt mirror answered within ${PROBE_SECONDS}s each (${CANDIDATES[*]}); stopping instead of waiting for the job timeout"
  exit 1
fi
echo "apt mirror for this job: $MIRROR"

if [ "$MIRROR" != "${CANDIDATES[0]}" ]; then
  # Current images read their Ubuntu sources through mirror+file:/etc/apt/apt-mirrors.txt; older ones name the azure mirror directly.
  if [ -f "$APT_ETC/apt-mirrors.txt" ]; then
    printf '%s/\n' "$MIRROR" | sudo tee "$APT_ETC/apt-mirrors.txt" > /dev/null
  fi
  for file in "$APT_ETC/sources.list" "$APT_ETC"/sources.list.d/*.list "$APT_ETC"/sources.list.d/*.sources; do
    if [ -f "$file" ]; then
      sudo sed -i "s|${CANDIDATES[0]}|$MIRROR|g" "$file"
    fi
  done
fi

bounded_apt() {
  local seconds="$1"
  shift
  local status=0
  sudo timeout --kill-after="$KILL_SECONDS" "$seconds" apt-get "${APT_OPTIONS[@]}" "$@" || status=$?
  if [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
    echo "::error::apt-get $1 did not finish within ${seconds}s (mirror $MIRROR)"
    exit 1
  fi
  if [ "$status" -ne 0 ]; then
    echo "::error::apt-get $1 failed with exit code $status (mirror $MIRROR)"
    exit "$status"
  fi
}

# apt-get update exits 0 after a failed index fetch. A failed Ubuntu index stops here instead of installing from stale lists;
# a failed third-party list the image ships (packages.microsoft.com, for example) only warns, because the packages come from Ubuntu.
UBUNTU_INDEX='mirror\+file:|ubuntu\.com/ubuntu|mirrors\.edge\.kernel\.org/ubuntu'
UPDATE_LOG="$(mktemp)"
trap 'rm -f "$UPDATE_LOG"' EXIT
bounded_apt "$UPDATE_SECONDS" update 2>&1 | tee "$UPDATE_LOG"
failed_fetches="$(grep -E '^[WE]: Failed to fetch ' "$UPDATE_LOG" || true)"
if grep -qE "$UBUNTU_INDEX" <<< "$failed_fetches"; then
  echo "::error::apt-get update could not fetch an Ubuntu index (mirror $MIRROR); stopping instead of installing from stale lists"
  exit 1
fi
if [ -n "$failed_fetches" ]; then
  echo "::warning::apt-get update could not fetch a non-Ubuntu source; continuing on the current Ubuntu indexes: $(head -n 1 <<< "$failed_fetches")"
fi
bounded_apt "$INSTALL_SECONDS" install -y "$@"
