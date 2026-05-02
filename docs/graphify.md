# Graphify — Knowledge Graph Setup

StoryCraft Studio has a fully configured [graphify](https://github.com/safishamsi/graphify) knowledge graph.  
Graph lives at `graphify-out/` (not committed to git).

**Other docs:** CI and automation → [`CI.md`](CI.md); full documentation map → [`README.md`](../README.md#-documentation-hub) *Documentation Hub*.

---

## What's installed

| Component | Location | Purpose |
|-----------|----------|---------|
| `.graphifyignore` | repo root | Excludes `node_modules/`, `dist/`, `coverage/`, `graphify-out/`, binaries, `.env` |
| `graphify-out/` in `.gitignore` | `.gitignore` | Generated output not committed |
| Claude Code integration | `CLAUDE.md` + `~/.claude/settings.json` | PreToolUse hook + CLAUDE.md section |
| VS Code Copilot integration | `.github/copilot-instructions.md` | Copilot Chat reads the graph |
| Git hooks | `.git/hooks/post-commit`, `post-checkout` | Graph auto-rebuilt on every commit |

---

## Graph stats (last build: 2026-04-30)

- **178 files** · ~102,700 words
- **566 nodes** · **703 edges** · **20 communities**
- 87 % EXTRACTED · 13 % INFERRED (88 inferred edges, avg confidence 0.8)
- Build cost: **0 tokens** (AST-only)

### God Nodes (most connected abstractions)

| Rank | Node | Edges |
|------|------|-------|
| 1 | `IndexedDBService` | 38 |
| 2 | `FileSystemService` | 35 |
| 3 | `StorageManager` | 30 |
| 4 | `retryFs()` | 26 |
| 5 | `useTranslation()` | 18 |
| 6 | `sanitizePathSegment()` | 14 |
| 7 | `CollaborationService` | 14 |
| 8 | `useAppDispatch()` | 13 |
| 9 | `t()` | 13 |
| 10 | `useToast()` | 8 |

---

## Daily usage

### After code changes (no API cost)

```bash
graphify update .
```

Re-extracts all TypeScript/React files via tree-sitter AST. Preserves semantic nodes from any previous full run.

### Terminal queries

```bash
# BFS traversal for a question
graphify query "wie funktioniert der AI-Retry-Mechanismus?"

# Shortest path between two abstractions
graphify path "geminiService" "Redux store"
graphify path "ollamaService" "settingsSlice"

# Explain a node and its neighbors
graphify explain "aiThunkUtils"
graphify explain "StorageManager"
```

### Full semantic rebuild (uses LLM, costs tokens)

In Claude Code chat:
```
/graphify .
```

Or for Copilot Chat in VS Code:
```
/graphify .
```

This adds semantic edges between concepts, doc files, etc. on top of the AST graph.

### Interactive graph

Open `graphify-out/graph.html` in any browser — interactive D3 visualization of all nodes and communities.

---

## Automatic updates

The `post-commit` and `post-checkout` git hooks run `graphify update .` automatically. Nothing to do manually after committing.

To verify hooks are active:
```bash
graphify hook status
```

---

## Fine-tuning what gets indexed

Edit `.graphifyignore` (same syntax as `.gitignore`). Current exclusions:

```
dist/          src-tauri/target/    node_modules/
coverage/      reports/             test-results/
playwright-report/                  graphify-out/
pnpm-lock.yaml  *.lock              *.log
*.png *.jpg *.woff *.woff2 ...      (binary/media)
storybook-static/                   .vscode/  .idea/
.env  .env.*
```

---

## Optional: Obsidian vault

```bash
graphify . --obsidian
```

Generates a full Obsidian-compatible vault in `graphify-out/obsidian/` with wiki-links between nodes.

---

## Optional: extra file types

```bash
# For .docx / .xlsx parsing
pip install 'graphifyy[office]'

# For video transcription (Whisper)
pip install 'graphifyy[video]'
```

---

## Keeping the graph in sync with AI assistants

| Scenario | Action |
|----------|--------|
| You edited code | `graphify update .` (or auto via git hook) |
| You added docs/PDFs | `/graphify --update` in Claude Code or Copilot Chat |
| Cross-module question | `graphify query "..."` or `graphify path "A" "B"` |
| Architecture overview | Read `graphify-out/GRAPH_REPORT.md` |
| Detailed community | Read `graphify-out/graph.html` in browser |

---

## Integration with Claude Code

When `graphify-out/graph.json` exists, Claude Code's PreToolUse hook automatically injects:

> *"graphify: Knowledge graph exists. Read graphify-out/GRAPH_REPORT.md for god nodes and community structure before searching raw files."*

This fires before every `Glob` or `Grep` tool call, so Claude reads the graph summary first instead of scanning raw files.

The CLAUDE.md section also instructs Claude to:
- Read `graphify-out/GRAPH_REPORT.md` before architecture questions
- Use `graphify query/path/explain` for cross-module questions
- Run `graphify update .` after modifying code files

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `graphify: command not found` | `uv tool install graphifyy && graphify install` |
| Graph is stale | `graphify update .` |
| Hook not firing | `graphify hook install` |
| VS Code Copilot not reading graph | `graphify vscode install` |
| Claude Code hook missing | `graphify claude install` |
| Graph build fails | Check `.graphifyignore`; ensure Python 3.10+ |
