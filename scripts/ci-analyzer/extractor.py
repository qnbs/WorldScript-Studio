#!/usr/bin/env python3
"""
CI Log Extractor for StoryCraft-Studio.
QNBS-v3: Fetches failed CI runs and artifacts via GitHub CLI/API.
"""

import json
import subprocess
import sys
from pathlib import Path
from typing import Optional


def run_gh_command(args: list[str]) -> dict:
    """Execute gh CLI command and return parsed JSON output."""
    result = subprocess.run(
        ["gh", *args],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        print(f"gh command failed: {' '.join(args)}", file=sys.stderr)
        print(f"stderr: {result.stderr}", file=sys.stderr)
        return {}
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {}


def get_latest_failed_run() -> Optional[str]:
    """Get the ID of the most recent failed CI run."""
    data = run_gh_command(["run", "list", "--status", "failure", "--limit", "1", "--json", "databaseId"])
    runs = data.get("workflowRuns", [])
    if not runs:
        runs = data.get("runs", [])
    if runs:
        return str(runs[0].get("databaseId", runs[0].get("id", "")))
    return None


def download_artifact(run_id: str, artifact_name: str, dest_dir: Path) -> bool:
    """Download a specific artifact from a workflow run."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["gh", "run", "download", run_id, "-n", artifact_name, "--dir", str(dest_dir)],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode == 0


def get_failed_logs(run_id: str) -> str:
    """Get raw logs from a failed workflow run."""
    result = subprocess.run(
        ["gh", "run", "view", run_id, "--log-failed"],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout


def parse_vitest_json(report_path: Path) -> dict:
    """Parse Vitest JSON report for failing tests."""
    if not report_path.exists():
        return {}
    with open(report_path) as f:
        return json.load(f)


def parse_stryker_json(report_path: Path) -> dict:
    """Parse Stryker JSON report for surviving mutants."""
    if not report_path.exists():
        return {}
    with open(report_path) as f:
        return json.load(f)


if __name__ == "__main__":
    run_id = get_latest_failed_run()
    if run_id:
        print(f"Latest failed run ID: {run_id}")
    else:
        print("No failed runs found")
        sys.exit(1)