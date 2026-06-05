#!/usr/bin/env python3
"""
CI Analyzer with OpenRouter/Poolside Laguna integration.
QNBS-v3: Analyzes CI failures and outputs structured VS Code problem format.
"""

import json
import os
import sys
from pathlib import Path
from typing import Optional

from openai import OpenAI

from models import CiError, VitestJsonReport, StrykerJsonReport
from preprocessor import preprocess_log, extract_error_sections


# System prompt with StoryCraft-Studio architecture context
SYSTEM_PROMPT = """You are a Senior TypeScript/Rust Engineer analyzing CI failures for StoryCraft-Studio.

ARCHITECTURE CONTEXT:
- React 19 + TypeScript (strict mode) + Vite 8
- Redux Toolkit 2.x with redux-undo (project slice only)
- Tailwind CSS 4.x with --sc-* CSS custom properties (NEVER use dark: prefix)
- IndexedDB dual-store with LZ-String compression + AES-256-GCM encryption
- Tauri 2 desktop packaging (Rust backend)
- Vitest maxWorkers: 1 (serial execution)
- 8 MiB Service Worker cache limit — large chunks excluded from precache

CONSTRAINTS:
- TypeScript strict: true, exactOptionalPropertyTypes: true
- No 'any' types — use unknown + type guards
- All interactive elements require role, aria-label, aria-expanded
- Modals must trap focus and restore on close
- File size target: 200-700 lines (split if over 700)
- Never skip failing tests — fix root cause

OUTPUT FORMAT:
Return ONLY a JSON array of error objects with these fields:
- file_path: relative path from workspace root (e.g., "services/voice/voiceCommandService.ts")
- line: line number (integer)
- column: column number (integer, default 1)
- severity: "error", "warn", or "info"
- root_cause: brief explanation of the logical error
- suggested_fix: concrete code fix

Example:
[{"file_path": "features/project/projectSlice.ts", "line": 42, "column": 5, "severity": "error", "root_cause": "Type mismatch in payload", "suggested_fix": "Add explicit type assertion or fix the reducer logic"}]
"""


def get_openrouter_client() -> OpenAI:
    """Initialize OpenRouter client for Poolside Laguna model."""
    api_key = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY or OPENAI_API_KEY environment variable required")

    return OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=api_key,
    )


def analyze_vitest_failure(vitest_report: dict, raw_logs: str) -> list[CiError]:
    """Analyze Vitest JSON report and raw logs for errors."""
    errors = []

    # Parse Vitest JSON for test failures
    if vitest_report and "testResults" in vitest_report:
        for result in vitest_report["testResults"]:
            if result.get("result") and "errors" in result.get("result", {}):
                for error in result["result"]["errors"]:
                    # Extract file path from test name
                    name = result.get("name", "")
                    # Vitest paths are relative to project root
                    file_path = name.replace(process.cwd(), "").lstrip("/")

                    # Parse error message for line info
                    msg = error.get("message", "")
                    line_match = __import__("re").search(r"at (\w+\.tsx?):(\d+):(\d+)", msg)

                    if line_match:
                        errors.append(CiError(
                            file_path=line_match.group(1),
                            line=int(line_match.group(2)),
                            column=int(line_match.group(3)),
                            severity="error",
                            root_cause=msg[:200],
                            suggested_fix="Review test assertion and fix the underlying code logic"
                        ))

    return errors


def analyze_stryker_failure(stryker_report: dict) -> list[CiError]:
    """Analyze Stryker JSON report for surviving mutants."""
    errors = []

    if stryker_report and "files" in stryker_report:
        for file_path, file_report in stryker_report["files"].items():
            mutants = file_report.get("mutants", {})
            for mutant_id, mutant in mutants.items():
                if mutant.get("status") == "survived":
                    # Extract location from mutant
                    location = mutant.get("location", {})
                    errors.append(CiError(
                        file_path=file_path,
                        line=location.get("start", {}).get("line", 1),
                        column=location.get("start", {}).get("column", 1),
                        severity="warn",
                        root_cause=f"Mutant survived: {mutant.get('mutatorName', 'unknown')} mutation not covered by tests",
                        suggested_fix="Add test case to cover this mutation scenario"
                    ))

    return errors


def analyze_with_llm(error_text: str, context: str = "") -> list[CiError]:
    """Send preprocessed errors to LLM for analysis."""
    client = get_openrouter_client()

    # Build prompt with context
    prompt = f"""Analyze this CI failure for StoryCraft-Studio:

{context}

Error details:
{error_text[:8000]}  # Truncate to fit context window

Return JSON array of CiError objects with file_path, line, column, severity, root_cause, suggested_fix.
"""

    try:
        response = client.chat.completions.create(
            model="poolside/laguna",  # Poolside Laguna model
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=2000,
            response_format={"type": "json_object"},
        )

        content = response.choices[0].message.content
        if content:
            data = json.loads(content)
            return [CiError(**e) for e in data if isinstance(data, list)]
    except Exception as e:
        print(f"LLM analysis failed: {e}", file=sys.stderr)

    return []


def format_for_vscode(errors: list[CiError]) -> str:
    """Format errors for VS Code problem matcher."""
    lines = []
    for error in errors:
        lines.append(
            f"AI-ANALYSIS: {error.file_path}:{error.line}:{error.column} "
            f"{error.severity}: {error.root_cause}. Fix: {error.suggested_fix}"
        )
    return "\n".join(lines)


def main():
    """Main entry point for CI analyzer."""
    import argparse

    parser = argparse.ArgumentParser(description="Analyze CI failures")
    parser.add_argument("--vitest-json", help="Path to Vitest JSON report")
    parser.add_argument("--stryker-json", help="Path to Stryker JSON report")
    parser.add_argument("--logs", help="Path to raw CI logs")
    parser.add_argument("--output", help="Output format: vscode or json", default="vscode")
    args = parser.parse_args()

    all_errors = []

    # Analyze Vitest failures
    if args.vitest_json and Path(args.vitest_json).exists():
        with open(args.vitest_json) as f:
            vitest_report = json.load(f)
        all_errors.extend(analyze_vitest_failure(vitest_report, ""))

    # Analyze Stryker failures
    if args.stryker_json and Path(args.stryker_json).exists():
        with open(args.stryker_json) as f:
            stryker_report = json.load(f)
        all_errors.extend(analyze_stryker_failure(stryker_report))

    # If we have raw logs and no structured errors, use LLM
    if args.logs and Path(args.logs).exists() and not all_errors:
        with open(args.logs) as f:
            raw_logs = f.read()
        preprocessed = preprocess_log(raw_logs)
        all_errors.extend(analyze_with_llm(preprocessed))

    # Output in requested format
    if args.output == "vscode":
        print(format_for_vscode(all_errors))
    else:
        print(json.dumps([e.model_dump() for e in all_errors], indent=2))


if __name__ == "__main__":
    main()