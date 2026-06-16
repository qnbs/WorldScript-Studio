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

```bash
# 1. Node dependencies
pnpm install

# 2. Graphify (requires Python 3.10+)
pnpm run graphify:bootstrap   # pip install graphifyy
pnpm run graphify:update      # build AST graph

# 3. CodeGraph (requires Node/npm)
npm install -g @colbymchenry/codegraph
codegraph init -i

# 4. Configure your agent
# Kimi Code CLI → add MCP server to ~/.kimi/settings.json (see docs/codegraph.md)
# Cursor → run: codegraph install --target=cursor --yes
```

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

# Large refactors / new modules:
pnpm run graphs:update   # updates both Graphify and CodeGraph
```

### Before Commits

```bash
# Optional: see which tests are affected
pnpm run codegraph:affected

# Full quality gate
pnpm run lint && pnpm run typecheck && pnpm run i18n:check
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

## Prompt Templates for Kimi K2.6

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
| Graphify not found | `pnpm run graphify:bootstrap` |
| CodeGraph not initialized | `codegraph init -i` |
| CodeGraph DB locked | Ensure project is on local disk (not WSL `/mnt/` or network share) |
| Both reports outdated | `pnpm run graphs:update` |
| Slow Graphify build | Check `.graphifyignore`; ensure `node_modules/` is excluded |
| Agent ignores CodeGraph | Add "Use CodeGraph first" to your session prompt |

## Privacy & Security

- Both tools are **100% offline**
- No API keys required
- No data leaves the machine
- `.codegraph/` and `graphify-out/` are gitignored (only `*_REPORT.md` committed)
- Safe to use on proprietary code

---

*See also: [docs/graphify.md](graphify.md) · [docs/codegraph.md](codegraph.md)*
