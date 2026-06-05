# CI Analyzer for StoryCraft-Studio

QNBS-v3: Cloud-CI-First workflow with multi-LLM support.

## Supported AI Backends

1. **OpenRouter/Poolside Laguna** (default) - Set `OPENROUTER_API_KEY`
2. **Claude Code CLI** - Install `claude` CLI and set `ANTHROPIC_API_KEY`
3. **Kimi Code CLI** - Install `kimi` CLI and set `KIMI_API_KEY`

## Usage

```bash
# Basic usage - auto-detects available backend
python3 scripts/ci-analyzer/analyzer.py --output vscode

# With Vitest JSON report
python3 scripts/ci-analyzer/analyzer.py --vitest-json test-results.json --output vscode

# With Stryker JSON report
python3 scripts/ci-analyzer/analyzer.py --stryker-json mutation.json --output vscode

# With raw logs
python3 scripts/ci-analyzer/analyzer.py --logs ci-logs.txt --output vscode
```

## VS Code Integration

The analyzer integrates with VS Code via:
- `.vscode/tasks.json` - CI Analyzer tasks
- `.vscode/problemMatchers.json` - Custom problem matcher for AI-ANALYSIS output
- `.vscode/settings.json` - AI backend configuration

Run via Command Palette: "Tasks: Run Task" → "CI Analyzer: Fetch and Analyze Failed Run"

## Environment Variables

- `OPENROUTER_API_KEY` - For Poolside Laguna model
- `ANTHROPIC_API_KEY` - For Claude Code CLI
- `KIMI_API_KEY` - For Kimi Code CLI
- `GITHUB_TOKEN` - For GitHub CLI operations

## Architecture Constraints

The analyzer is aware of StoryCraft-Studio specific constraints:
- TypeScript strict mode (no `any` types)
- Tailwind CSS custom properties (`--sc-*`)
- 8 MiB Service Worker cache limit
- Vitest maxWorkers: 1
- Redux Toolkit + redux-undo patterns
- Tauri 2 desktop packaging