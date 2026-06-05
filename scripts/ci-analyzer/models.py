"""
Pydantic models for CI Analyzer structured output.
QNBS-v3: These models enforce strict JSON schema for AI output parsing.
"""

from typing import Optional
from pydantic import BaseModel, Field


class CiError(BaseModel):
    """Structured CI error for VS Code problem matcher integration."""

    file_path: str = Field(..., description="Relative file path from workspace root")
    line: int = Field(..., ge=1, description="Line number where error occurs")
    column: int = Field(default=1, ge=1, description="Column number where error occurs")
    severity: str = Field(default="error", description="Error severity: error, warn, or info")
    root_cause: str = Field(..., description="Brief explanation of the root cause")
    suggested_fix: str = Field(..., description="Concrete code fix suggestion")


class VitestTestResult(BaseModel):
    """Vitest JSON test result structure."""

    name: str
    type: str
    result: Optional[dict] = None
    errors: Optional[list] = None


class VitestJsonReport(BaseModel):
    """Full Vitest JSON report structure."""

    testResults: list[VitestTestResult] = Field(default_factory=list)


class StrykerFileReport(BaseModel):
    """Stryker per-file mutation report."""

    language: str
    mutants: Optional[dict] = None
    metrics: Optional[dict] = None


class StrykerJsonReport(BaseModel):
    """Full Stryker JSON report structure."""

    schemaVersion: str
    files: dict[str, StrykerFileReport] = Field(default_factory=dict)
    metrics: Optional[dict] = None