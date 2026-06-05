#!/usr/bin/env python3
"""
CI Log Preprocessor for StoryCraft-Studio.
QNBS-v3: Aggressively reduces token payload before LLM submission.
"""

import re
from typing import Optional


# ANSI escape code pattern
ANSI_PATTERN = re.compile(r'\x1b\[[0-9;]*m|\x1b\].*?\x07')

# Timestamp patterns (various CI formats)
TIMESTAMP_PATTERNS = [
    re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z?'),
    re.compile(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}'),
    re.compile(r'\d{2}:\d{2}:\d{2}'),
]

# Base64 pattern (long strings that waste tokens)
BASE64_PATTERN = re.compile(r'[A-Za-z0-9+/]{100,}={0,2}')

# NPM warning patterns
NPM_WARN_PATTERNS = [
    re.compile(r'npm WARN .*'),
    re.compile(r'pnpm WARN .*'),
    re.compile(r'created a lockfile.*'),
    re.compile(r'Done in \d+ms'),
]


def strip_ansi(text: str) -> str:
    """Remove ANSI escape codes from text."""
    return ANSI_PATTERN.sub('', text)


def strip_timestamps(text: str) -> str:
    """Remove timestamp strings from text."""
    for pattern in TIMESTAMP_PATTERNS:
        text = pattern.sub('[TIMESTAMP]', text)
    return text


def strip_base64(text: str) -> str:
    """Replace long base64 strings with placeholder."""
    return BASE64_PATTERN.sub('[BASE64_DATA]', text)


def strip_npm_warnings(text: str) -> str:
    """Remove NPM/pnpm warning lines."""
    for pattern in NPM_WARN_PATTERNS:
        text = pattern.sub('', text)
    return text


def strip_redundant_success(text: str) -> str:
    """Remove redundant success messages."""
    success_patterns = [
        re.compile(r'✓.*\n'),
        re.compile(r'PASS.*\n'),
        re.compile(r'passed.*\n'),
    ]
    for pattern in success_patterns:
        text = pattern.sub('', text)
    return text


def preprocess_log(log_text: str) -> str:
    """Apply all preprocessing steps to reduce token payload."""
    text = log_text
    text = strip_ansi(text)
    text = strip_timestamps(text)
    text = strip_base64(text)
    text = strip_npm_warnings(text)
    text = strip_redundant_success(text)
    # Normalize whitespace
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def extract_error_sections(text: str) -> list[str]:
    """Extract only error-related sections from log."""
    lines = text.split('\n')
    error_sections = []
    current_section = []
    in_error = False

    for line in lines:
        if any(kw in line.lower() for kw in ['error', 'fail', 'failed', 'exception', 'traceback']):
            in_error = True
            current_section = [line]
        elif in_error:
            current_section.append(line)
            # End section on blank line or next error
            if line.strip() == '' or any(kw in line.lower() for kw in ['error', 'fail', 'failed']):
                if current_section:
                    error_sections.append('\n'.join(current_section))
                    current_section = []
                    in_error = False

    if current_section:
        error_sections.append('\n'.join(current_section))

    return error_sections


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        with open(sys.argv[1]) as f:
            content = f.read()
        print(preprocess_log(content))
    else:
        print("Usage: preprocessor.py <log_file>")
        sys.exit(1)