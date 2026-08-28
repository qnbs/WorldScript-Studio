# Dual-Graph Setup: Graphify + CodeGraph

WorldScript Studio uses **two complementary knowledge-graph tools** to provide maximum codebase intelligence for AI agents and human developers.

## Philosophy: City Map + GPS

| | **Graphify** | **CodeGraph** |
|--|--------------|---------------|
| **Metaphor** | City map with districts & landmarks | GPS with real-time routing |
| **Scope** | Multi-modal (code + docs + media) | Code-only (symbol-level) |
| **Strength** | Architecture overview, communities, visual exploration | Caller/callee, impact analysis, auto-sync |
| **Agent interface** | Passive reports (`GRAPH_REPORT.md`) | Active MCP tools (`codegraph_context`) |
| **Visualization** | Interactive D3 (`graph.html`) | — |
| **Auto-sync** | Manual (`pnpm run graphify:update`) | File watcher (2s debounce) |
| **Output** | `graphify-out/` | `.codegraph/` |
| **Committed** | `GRAPH_REPORT.md` | `CODEGRAPH_REPORT.md` |

## Quick Start for New Machines

Both tools' tested versions live in [`config/graph-tools-versions.json`](../config/graph-tools-versions.json) — the bootstrap commands below read from it, never hardcode a version here.

```bash
# 1. Node dependencies
node scripts/dependency-state.mjs reconcile

# 2. Install both tools at their pinned versions (Graphify needs Python 3.10+; CodeGraph needs Node/npm)
pnpm run graphs:bootstrap

# 3. Read-only diagnostic: installed versions and any existing report freshness
pnpm run graphs:doctor

# 4. Optional privacy controls before the first CodeGraph invocation (local shell only)
export CODEGRAPH_TELEMETRY=0 CODEGRAPH_NO_UPDATE_CHECK=1

# 5. Initialize CodeGraph's local index for this worktree (one-time; builds the index in this step)
codegraph init

# 6. Update local runtime state + regenerate the two committed reports (requires a clean tree)
pnpm run graphs:refresh

# 7. Configure your agent's MCP client (local, machine-personal — not inherited from git)
# Claude Code → codegraph install --target=claude   (see docs/codegraph.md)
# Cursor      → codegraph install --target=cursor --yes
# Kimi Code CLI → add MCP server to ~/.kimi/settings.json (see docs/codegraph.md)

# 8. Choose Graphify (architecture/topology) vs. CodeGraph (symbol/impact) vs. raw grep —
#    see "Tool Selection Guide" below.
```

`graphs:doctor` is safe before initialization: missing reports and an uninitialized CodeGraph index
are reported diagnostically. When reports exist it also displays their shared freshness diagnosis,
but it remains non-blocking for onboarding. Use `graphs:status` after setup as the authoritative,
non-zero freshness check; it requires both committed reports to exist and match the current source
fingerprint and tested tool versions.

## Daily Workflow

### Session Start (Plan Mode / Composer / Agent)

Before planning or implementing:

1. **Read `graphify-out/GRAPH_REPORT.md`** — refresh high-level architecture (communities, god nodes)
2. **Read `.codegraph/CODEGRAPH_REPORT.md`** — verify index is up to date
3. **Use CodeGraph MCP tools** for concrete navigation — never start with `Grep`

### After Code Changes

```bash
# Small changes (< 5 files) — nothing needed
# CodeGraph auto-syncs via file watcher

# Large refactors / new modules — local runtime state only, doesn't touch committed reports:
pnpm run graphs:update

# Before opening a PR — regenerate the committed reports too (requires a clean tree):
pnpm run graphs:refresh
```

### Before Commits

```bash
# Optional: see which tests are affected
pnpm run codegraph:affected

# Required constrained-hardware gate (see docs/PR-CI-MERGE-WORKFLOW.md) — not the full
# lint/typecheck/i18n suite, which is CI-owned:
pnpm run ci:prepush
```

## Tool Selection Guide

| Question | Primary Tool | Secondary |
|----------|--------------|-----------|
| "How is the project structured?" | Graphify (`GRAPH_REPORT.md`) | CodeGraph (`codegraph files`) |
| "What breaks if I refactor X?" | CodeGraph (`codegraph_impact`) | Graphify (community boundaries) |
| "How does data flow from A to B?" | CodeGraph (`codegraph_trace`) | Graphify (`graphify path`) |
| "Which tests should I run?" | CodeGraph (`codegraph affected`) | — |
| "Explain this service to me" | CodeGraph (`codegraph_node`) | Graphify (`graphify explain`) |
| "Architecture of the Voice feature" | Graphify (community detection) | CodeGraph (callers/callees) |
| "Find all uses of `useAppDispatch`" | CodeGraph (`codegraph_search`) | — |
| "Cross-module impact of a new AI provider" | Both | — |

## Prompt Templates for Kimi K2.6 (optional reference — not required setup)

Claude Code's own graph-usage instructions live directly in `CLAUDE.md` and don't need a separate
template. The templates below are optional reference material if you're driving this repo through
Kimi K2.6 or a similarly prompted agent that needs the same guidance spelled out explicitly.

### Template A: Feature Development

```text
I want to implement [FEATURE] in WorldScript Studio.

Please:
1. Read graphify-out/GRAPH_REPORT.md for architecture context
2. Read .codegraph/CODEGRAPH_REPORT.md for index status
3. Use codegraph_context "implement [FEATURE]" to find entry points
4. Use codegraph_impact on key symbols to assess change radius
5. Provide an implementation plan

DO NOT start with Grep/ReadFile loops — use CodeGraph first.
```

### Template B: Refactoring

```text
I want to refactor [COMPONENT/SERVICE].

Please:
1. codegraph_impact "[SymbolName]" --depth 2 to find all affected callers
2. Read graphify-out/GRAPH_REPORT.md to check community boundaries
3. Provide a safe refactoring plan with file list
4. After implementation, remind me to run: pnpm run graphs:update
```

### Template C: Bug Fix

```text
Bug: [DESCRIPTION]

Please:
1. codegraph_trace "[EntryPoint]" "[ErrorLocation]" to trace the call path
2. codegraph_context "fix [BUG DESCRIPTION]" to gather relevant code
3. Propose a fix
4. pnpm run codegraph:affected to find tests to verify
```

## Monorepo Structure in the Graphs

```
app/                  → CodeGraph: store + middleware deps
                      → Graphify: app-state community

components/           → CodeGraph: component hierarchy
                      → Graphify: UI community

components/ui/        → CodeGraph: design-system primitives
                      → Graphify: design-system cluster

features/             → CodeGraph: slice relationships
                      → Graphify: domain communities

packages/ai-core/     → CodeGraph: WebLLM worker entrypoints
                      → Graphify: AI-Core community

packages/ui/          → CodeGraph: preset tokens
                      → Graphify: design-system cluster

services/ai/          → CodeGraph: provider call-graph
                      → Graphify: AI services community

services/voice/       → CodeGraph: engine interface implementations
                      → Graphify: voice full-support cluster

services/duckdb/      → CodeGraph: schema + migration deps
                      → Graphify: analytics community

src-tauri/src/        → CodeGraph: Rust commands + TS invoke sites
                      → Graphify: desktop community

workers/              → CodeGraph: worker entrypoints
                      → Graphify: off-main-thread community
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Graphify not found | `pnpm run graphify:bootstrap` (or `pnpm run graphs:bootstrap` for both tools) |
| CodeGraph not initialized | `codegraph init` (builds the index in this one step) |
| CodeGraph DB locked | Ensure project is on local disk (not WSL `/mnt/` or network share) |
| Both reports outdated | `pnpm run graphs:status` to confirm, then `pnpm run graphs:refresh` to regenerate (requires a clean tree) |
| Report generation refused (`DIRTY_UNTRACKED_INPUT`) | Commit or stash the listed paths first — reports are only generated from a stable, committable source state |
| Slow Graphify build | Check `.graphifyignore`; ensure `node_modules/` is excluded |
| Agent ignores CodeGraph | Add "Use CodeGraph first" to your session prompt |
| `claude mcp list` shows CodeGraph "Disabled" | Known display quirk — see `docs/codegraph.md`'s Claude Code section |

## Privacy & Security

- The source parsing and local index for the default AST/code-intelligence paths stay local, but CodeGraph's anonymous usage telemetry is enabled by default and can make network calls. Disable it with `codegraph telemetry off`, `CODEGRAPH_TELEMETRY=0`, or `DO_NOT_TRACK=1`; disable its separate update check with `CODEGRAPH_NO_UPDATE_CHECK=1` (full disclosure in [CodeGraph's TELEMETRY.md](https://github.com/colbymchenry/codegraph/blob/main/TELEMETRY.md)).
- Graphify's separate semantic/LLM rebuild mode (`/graphify .` in chat) is also networked and provider-dependent; the AST-only Graphify path does not require that mode.
- No API keys required for either tool's core functionality.
- Graphify can optionally log queries locally to `~/.cache/graphify-queries.log` — off by default since `graphifyy` v0.9.13 (see `docs/graphify.md`'s Privacy section for the exact env vars).
- `.codegraph/` and `graphify-out/` are gitignored (only `*_REPORT.md` committed).

---

*See also: [docs/graphify.md](graphify.md) · [docs/codegraph.md](codegraph.md)*
