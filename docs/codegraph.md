# CodeGraph — Semantic Code Intelligence Setup

WorldScript Studio uses [CodeGraph](https://github.com/colbymchenry/codegraph) for fast, agent-optimized code exploration via MCP.

## Overview

CodeGraph builds a pre-indexed semantic knowledge graph of the codebase using Tree-sitter AST parsing and SQLite FTS5 full-text search. It exposes an MCP server that agents (Kimi Code CLI, Cursor, Claude Code) can query directly — eliminating expensive `Grep`/`ReadFile` exploration loops.

**Current index:** 260 files · 2.754 nodes · 2.443 edges · 4.81 MB SQLite (WAL mode)

**Privacy:** 100% local. No data leaves the machine.

## Installation

### One-time global install

```bash
npm install -g @colbymchenry/codegraph
# or: pnpm add -g @colbymchenry/codegraph
```

CodeGraph bundles its own Node runtime — nothing to compile.

### Per-project initialization

```bash
cd /path/to/WorldScript-Studio
codegraph init -i
```

This creates `.codegraph/` and builds the full index. It automatically respects `.gitignore`.

## pnpm Scripts

| Script | Purpose |
|--------|---------|
| `pnpm run codegraph:status` | Show index statistics |
| `pnpm run codegraph:update` | Force full re-index (`codegraph index --force`) |
| `pnpm run codegraph:sync` | Incremental sync (`codegraph sync`) |
| `pnpm run codegraph:report` | Generate `.codegraph/CODEGRAPH_REPORT.md` |
| `pnpm run codegraph:affected` | Show test files affected by uncommitted changes |
| `pnpm run graphs:update` | Update **both** Graphify and CodeGraph sequentially |

## Daily Workflow

### After large refactors

```bash
pnpm run codegraph:update
# or update both graphs:
pnpm run graphs:update
```

### Find affected tests before committing

```bash
pnpm run codegraph:affected
# or manually:
git diff --name-only HEAD | codegraph affected --stdin
```

### Query from terminal

```bash
# Search symbols
codegraph query "useAppDispatch"

# Find callers
codegraph callers "dbService"

# Build context for an AI task
codegraph context "fix voice command latency"

# Trace a call path
codegraph trace "VoiceCommandService" "appStoreRef"
```

## MCP Integration

### Kimi Code CLI

Add to `~/.kimi/settings.json`:

```json
{
  "mcpServers": {
    "codegraph": {
      "command": "codegraph",
      "args": ["serve", "--mcp"]
    }
  }
}
```

Restart Kimi Code CLI after editing the config.

### Cursor

Run once in the project:

```bash
codegraph install --target=cursor --yes
```

This creates `.cursor/rules/codegraph.mdc` and configures the Cursor MCP client.

### Claude Code

Run once in the project:

```bash
codegraph install --target=claude --yes
```

## VS Code: Tasks

Four tasks are pre-defined in `.vscode/tasks.json`:

- **CodeGraph: status** — Index statistics
- **CodeGraph: update index** — Full re-index
- **CodeGraph: generate report** — Refresh `CODEGRAPH_REPORT.md`
- **Dual-Graph: update both** — Run Graphify + CodeGraph updates

## Monorepo Notes

CodeGraph indexes every file not excluded by `.gitignore`. For WorldScript Studio:

- **Indexed:** `app/`, `components/`, `features/`, `hooks/`, `services/`, `packages/`, `src-tauri/src/`, `workers/`, `tests/`, `locales/`
- **Excluded:** `node_modules/`, `dist/`, `src-tauri/target/`, `graphify-out/`, `.codegraph/`

Rust support is native — Tauri commands in `src-tauri/src/` are indexed alongside TypeScript.

## Solo-Repo Policy

Following the same policy as Graphify:

- **Committed:** `.codegraph/CODEGRAPH_REPORT.md` only
- **Gitignored:** `.codegraph/codegraph.db`, `.codegraph/codegraph.db-shm`, `.codegraph/codegraph.db-wal`
- **Regenerate locally:** `pnpm run codegraph:update` or `pnpm run graphs:update`

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **"CodeGraph not initialized"** | Run `codegraph init -i` in repo root |
| **"database is locked"** | Ensure WAL mode is active (`codegraph status` → `Journal: wal`). If on a network share or WSL2 `/mnt/`, move the project to a local disk |
| **Missing symbols after save** | Wait 2s (auto-sync debounce) or run `codegraph sync` |
| **MCP server not connecting** | Verify `codegraph serve --mcp` works from the terminal. Check the path in your MCP config |
| **Index is stale** | `pnpm run codegraph:update` |
| **Large `.codegraph/` folder** | Normal — SQLite + WAL can be 5–15 MB for this codebase. It is gitignored |

## See Also

- [docs/graphify.md](graphify.md) — Graphify knowledge graph setup
- [docs/dual-graph-setup.md](dual-graph-setup.md) — Master guide for using both tools together
