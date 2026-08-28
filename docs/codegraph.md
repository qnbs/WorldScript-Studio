# CodeGraph — Semantic Code Intelligence Setup

WorldScript Studio uses [CodeGraph](https://github.com/colbymchenry/codegraph) for fast, agent-optimized code exploration via MCP.

## Overview

CodeGraph builds a pre-indexed semantic knowledge graph of the codebase using Tree-sitter AST parsing and SQLite FTS5 full-text search. It exposes an MCP server that agents (Kimi Code CLI, Cursor, Claude Code) can query directly — eliminating expensive `Grep`/`ReadFile` exploration loops.

**Current index stats:** see the committed report's own header — [`.codegraph/CODEGRAPH_REPORT.md`](../.codegraph/CODEGRAPH_REPORT.md). A hardcoded snapshot here always drifts; check `pnpm run graphs:status` for FRESH/STALE at a glance.

**Privacy:** source/index data stays 100% local. **Telemetry is a separate concern** — current CodeGraph versions collect anonymous usage telemetry by default; disable it locally (never committed) with `codegraph telemetry off` (also `CODEGRAPH_TELEMETRY=0` / `DO_NOT_TRACK=1`), see [full disclosure](https://github.com/colbymchenry/codegraph/blob/main/TELEMETRY.md). Update checks are separate again — `CODEGRAPH_NO_UPDATE_CHECK=1` disables the background release check independently of telemetry.

**Version policy:** the single source of truth is [`config/graph-tools-versions.json`](../config/graph-tools-versions.json) — currently pinned to `@colbymchenry/codegraph@1.6.0` under a `controlled-upgrade` policy. Don't hardcode the version elsewhere.

## Installation

### One-time global install (pinned)

```bash
pnpm run codegraph:bootstrap   # installs the exact pinned version from config/graph-tools-versions.json
# equivalent manually: npm install -g @colbymchenry/codegraph@<pinned>
```

CodeGraph is optional local developer tooling — this never adds it as a `package.json` dependency, and it bundles its own Node runtime (nothing to compile).

### Per-project initialization

```bash
cd /path/to/WorldScript-Studio
codegraph init
```

This creates `.codegraph/` and builds the full index in one step (current versions no longer need a
separate `-i`/`--index` flag — indexing runs by default). It automatically respects `.gitignore`.

## pnpm Scripts

| Script | Purpose |
|--------|---------|
| `pnpm run codegraph:bootstrap` | Install the exact pinned version (see `config/graph-tools-versions.json`) |
| `pnpm run codegraph:status` | Show index statistics |
| `pnpm run codegraph:sync` | **Routine incremental update** (`codegraph sync`) — what `pnpm run graphs:update` runs |
| `pnpm run codegraph:update` | **Full rebuild** (`codegraph index --force`) — for large refactors or index corruption recovery, not routine use |
| `pnpm run codegraph:report` | Generate `.codegraph/CODEGRAPH_REPORT.md` (gated on a clean source tree) |
| `pnpm run codegraph:affected` | Show test files affected by uncommitted changes |
| `pnpm run graphs:doctor` / `graphs:status` / `graphs:update` / `graphs:report` / `graphs:refresh` / `graphs:bootstrap` | Combined dual-graph interface — see [`dual-graph-setup.md`](dual-graph-setup.md) |

## Daily Workflow

### Routine update (after normal edits)

```bash
pnpm run codegraph:sync    # incremental — this is what graphs:update runs for CodeGraph
```

### After large refactors or suspected index corruption

```bash
pnpm run codegraph:update  # full rebuild (codegraph index --force) -- not the routine path
# or refresh both graphs + regenerate committed reports, strict:
pnpm run graphs:refresh
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

Run once, without `--project` (registers a **user-level**, machine-personal MCP entry in
`~/.claude.json` rather than a repo-tracked `.mcp.json` — this is what's actually observed in
practice, so a fresh clone on a different machine needs to repeat this step, not inherit it from git):

```bash
codegraph install --target=claude
```

**Known display quirk:** `claude mcp list` / `/mcp` may show `codegraph: ⊘ Disabled for this project`
even when the config genuinely does *not* disable it (verify: `~/.claude.json` →
`projects["<repo-path>"].disabledMcpServers` should not contain `"codegraph"`) and the server itself
handshakes correctly (`codegraph serve --mcp` responds fine to a raw MCP `initialize` request). Treat
this as a stale health-check display issue, not a real disablement — if tools aren't available in a
session, re-check via `/mcp` in a fresh session before assuming a config problem.

## VS Code: Tasks

Four tasks are pre-defined in `.vscode/tasks.json`:

- **CodeGraph: status** — Index statistics
- **CodeGraph: update index** — Full re-index
- **CodeGraph: generate report** — Refresh `CODEGRAPH_REPORT.md`
- **Dual-Graph: update both** — Run Graphify + CodeGraph updates

## Monorepo Notes

CodeGraph indexes every file not excluded by `.gitignore`. For WorldScript Studio:

- **Indexed:** `app/`, `components/`, `features/`, `hooks/`, `services/`, `packages/`, `src-tauri/src/`, `workers/`, `tests/`, `locales/`
- **Excluded:** `node_modules/`, `dist/`, `src-tauri/target/`, `graphify-out/`, `.codegraph/`, `.claude/`, `.git/`, sibling worktree paths

Rust support is native — Tauri commands in `src-tauri/src/` are indexed alongside TypeScript.

## Solo-Repo Policy

Following the same policy as Graphify:

- **Committed:** `.codegraph/CODEGRAPH_REPORT.md` only — compact, deterministic, fingerprint-gated (see `scripts/codegraph-report.mjs`)
- **Gitignored:** `.codegraph/codegraph.db`, `.codegraph/codegraph.db-shm`, `.codegraph/codegraph.db-wal`
- **Regenerate report locally:** `pnpm run codegraph:report` or `pnpm run graphs:report` (requires a clean source tree — refuses on `DIRTY_UNTRACKED_INPUT`)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **"CodeGraph not initialized"** | Run `codegraph init` in repo root (current versions build the index in this one step) |
| **"database is locked"** | Ensure WAL mode is active (`codegraph status` → `Journal: wal`). If on a network share or WSL2 `/mnt/`, move the project to a local disk |
| **Missing symbols after save** | Wait for the auto-sync debounce (`CODEGRAPH_WATCH_DEBOUNCE_MS`, default well under a second) or run `codegraph sync` |
| **MCP server not connecting / `claude mcp list` shows "Disabled"** | Verify `codegraph serve --mcp` responds to a raw `initialize` request from the terminal — if it does, this is the known display quirk above, not a real disablement. Check `~/.claude.json`'s `disabledMcpServers` for the exact repo-path key to confirm the config itself is clean |
| **Index feels stale after a large refactor** | `pnpm run codegraph:update` (full rebuild) — routine edits should use `pnpm run codegraph:sync` instead |
| **Large `.codegraph/` folder** | Normal — SQLite + WAL scales with codebase size. It is gitignored |

## See Also

- [docs/graphify.md](graphify.md) — Graphify knowledge graph setup
- [docs/dual-graph-setup.md](dual-graph-setup.md) — Master guide for using both tools together
