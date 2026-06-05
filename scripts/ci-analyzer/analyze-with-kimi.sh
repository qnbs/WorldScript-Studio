#!/bin/bash
# CI Analyzer wrapper for Kimi Code CLI
# QNBS-v3: Uses kimi CLI for analysis when available

set -e

WORKSPACE="${1:-${workspaceFolder}}"
ARTIFACTS_DIR="${WORKSPACE}/artifacts"

# Check for Kimi CLI
if ! command -v kimi &> /dev/null; then
    echo "Kimi CLI not found, falling back to Python analyzer"
    python3 "${WORKSPACE}/scripts/ci-analyzer/analyzer.py" --output vscode
    exit 0
fi

# Fetch failed run if not already present
if [ ! -f "${ARTIFACTS_DIR}/ci-logs.txt" ]; then
    RUN_ID=$(gh run list --status failure --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || echo "")
    if [ -n "$RUN_ID" ]; then
        mkdir -p "${ARTIFACTS_DIR}"
        gh run download "$RUN_ID" -n vitest-results-node22 --dir "${ARTIFACTS_DIR}" 2>/dev/null || true
        gh run download "$RUN_ID" -n stryker-report-json --dir "${ARTIFACTS_DIR}" 2>/dev/null || true
        gh run view "$RUN_ID" --log-failed > "${ARTIFACTS_DIR}/ci-logs.txt" 2>/dev/null || true
    fi
fi

# Run Kimi analysis
kimi --model kimi-k2 \
    --max-tokens 4096 \
    --temperature 0.1 \
    --format json \
    -p "Analyze the CI failure in ${ARTIFACTS_DIR}/ci-logs.txt. Extract file paths, line numbers, error messages. Output in format: AI-ANALYSIS: <file>:<line>:<col> <severity>: <message> Fix: <suggestion>" < "${ARTIFACTS_DIR}/ci-logs.txt"