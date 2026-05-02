# Security Policy

## Supported Versions

The project currently supports security fixes for the following versions:

| Version | Supported |
| --- | --- |
| `main` (latest commit) | Yes |
| `1.1.x` | Yes |
| `< 1.1.0` | No |

## Reporting a Vulnerability

Please do not open public GitHub issues for security vulnerabilities.

Use one of these private channels instead:

1. Preferred: GitHub Private Vulnerability Reporting (Security Advisories)
   - URL: https://github.com/qnbs/StoryCraft-Studio/security/advisories/new
2. Encrypted email (fallback): maintainers may publish a dedicated address in organization docs; until then, **use GitHub Private Vulnerability Reporting only**.

If the email channel is not configured, use GitHub Private Vulnerability Reporting.

## Disclosure and Embargo Policy

- We target an initial maintainer response within 72 hours.
- We follow a default 90-day coordinated disclosure embargo, starting from first private report receipt.
- During the embargo, we work on triage, patching, validation, and release coordination.
- The embargo may be shortened for actively exploited issues or extended by mutual agreement when required for safe remediation.
- After a fix is released (or the embargo expires), we publish a public advisory with impact, affected versions, and mitigation details.

## Scope

This includes vulnerabilities involving:

- API key handling and storage
- Authentication/authorization bypass risks
- Data leakage or privacy violations
- Remote code execution, XSS, injection, or sandbox escape
- Supply-chain compromise in build/release workflows
