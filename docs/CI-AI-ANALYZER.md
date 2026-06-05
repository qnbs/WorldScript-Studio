# CI AI Analyzer — Cloud-CI-First Workflow

QNBS-v3: AI-powered CI failure analysis for low-end hardware development.

## Overview

The CI AI Analyzer bridges the gap between cloud-based CI runs and local development on resource-constrained machines. It automatically fetches failed CI logs, analyzes them using AI models, and presents structured error information directly in VS Code's Problems panel.

## Supported AI Backends

| Backend | Model | Environment Variable | CLI Tool |
|---------|-------|---------------------|----------|
| OpenRouter/Poolside Laguna | `poolside/laguna` | `OPENROUTER_API_KEY` | Python SDK |
| Claude Code CLI | `claude-3-7-sonnet-20250219` | `ANTHROPIC_API_KEY` | `claude` |
| Kimi Code CLI | `kimi-k2` | `KIMI_API_KEY` | `kimi` |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    VS Code (Local Thin Client)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Problem Panel  │  │ Tasks Runner   │  │ AI Analyzer Output   │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              GitHub Actions (Cloud Compute)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Vitest JSON   │  │ Stryker JSON   │  │ Raw CI Logs          │   │
│  │ Reporter      │  │ Reporter       │  │ (ANSI filtered)      │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              AI Analyzer (Python/OpenRouter)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Preprocessor   │  │ LLM Engine     │  │ VS Code Formatter    │   │
│  │ (70% token    │  │ (Poolside       │  │ (AI-ANALYSIS:       │   │
│  │ reduction)     │  │ Laguna)         │  │ format)              │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Setup

### 1. Install Python Dependencies

```bash
cd scripts/ci-analyzer
pip install -r requirements.txt
```

### 2. Configure Environment Variables

Add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
# OpenRouter (default)
export OPENROUTER_API_KEY="your-openrouter-key"

# Or use Claude Code CLI
export ANTHROPIC_API_KEY="your-anthropic-key"

# Or use Kimi Code CLI
export KIMI_API_KEY="your-kimi-key"

# GitHub token for artifact downloads
export GITHUB_TOKEN="your-github-token"
```

### 3. VS Code Configuration

The `.vscode/settings.json` includes:

```json
{
  "github.copilot.advanced": {
    "model": "poolside/laguna",
    "endpoint": "https://openrouter.ai/api/v1"
  },
  "claude.code.enabled": true,
  "kimi.code.enabled": true,
  "aiAnalyzer.ciPollingInterval": 30,
  "aiAnalyzer.artifactRetentionDays": 7
}
```

## Usage

### Manual Analysis

Run via Command Palette: **Tasks: Run Task** → **CI Analyzer: Fetch and Analyze Failed Run**

Or from terminal:

```bash
# Using default Python/OpenRouter backend
pnpm run ci:analyze

# Using Claude Code CLI (if installed)
pnpm run ci:analyze:claude

# Using Kimi Code CLI (if installed)
pnpm run ci:analyze:kimi
```

### Continuous Monitoring

The **CI Analyzer: Watch for Failed Runs** task runs in the background and automatically triggers analysis when a CI run fails.

## Output Format

The analyzer outputs errors in a VS Code problem matcher compatible format:

```
AI-ANALYSIS: services/voice/voiceCommandService.ts:42:15 error: State update on unmounted component. Fix: Implement cleanup function in useEffect to prevent memory leaks.
```

This appears in:
- VS Code Problems panel with red squiggly underlines
- Hover tooltips showing the suggested fix
- Clickable links to the exact source location

## Artifact Structure

CI artifacts are downloaded to `artifacts/` directory:

```
artifacts/
├── vitest-results-node22/
│   └── test-results.json
├── vitest-results-node24/
│   └── test-results.json
├── stryker-report-json/
│   └── mutation.json
└── ci-logs.txt
```

## AI Model Context

The analyzer is aware of StoryCraft-Studio specific constraints:

- **TypeScript strict mode**: No `any` types, explicit `undefined` for optional props
- **Tailwind CSS**: Uses `--sc-*` CSS custom properties, never `dark:` prefix
- **Service Worker**: 8 MiB cache limit, large chunks excluded
- **Vitest**: `maxWorkers: 1` for serial execution
- **Redux**: Toolkit + redux-undo patterns
- **Tauri**: Rust backend integration

## Troubleshooting

### No failed runs found

```bash
gh run list --status failure --limit 5
```

### Artifact download fails

Ensure `GITHUB_TOKEN` has `repo` scope for private repositories.

### AI analysis returns no results

1. Check that the API key is valid
2. Verify the artifact contains actual failures
3. Try the preprocessor directly: `python3 scripts/ci-analyzer/preprocessor.py <log_file>`

## Security Considerations

- API keys are never logged or committed
- Artifacts are excluded from git via `.gitignore`
- LLM output is advisory-only — no automatic code changes
- Base64 data and sensitive strings are filtered before LLM submission