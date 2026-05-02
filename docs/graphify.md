# Graphify — Knowledge Graph Setup

StoryCraft Studio has a fully configured [graphify](https://github.com/safishamsi/graphify) knowledge graph.  
Graph output lives at `graphify-out/` (not committed to git).

**Other docs:** CI and automation → [`CI.md`](CI.md); full documentation map → [`README.md`](../README.md#-documentation-hub) *Documentation Hub*.

**Official PyPI name:** `graphifyy` (double **y**). The CLI is still `graphify`. `pip install graphify` can pull an **unrelated** package — always use `graphifyy`.

---

## Installation (Python)

Pick **one** install path; all provide the `graphify` command (or `python -m graphify`).

| Method | Command | Notes |
|--------|---------|--------|
| **pip** (common) | `pip install graphifyy` | On Windows, `graphify.exe` may land in `%APPDATA%\Python\Python3xx\Scripts` — often **not** on `PATH` until you add it. |
| **pipx** | `pipx install graphifyy` | Isolated env; run `pipx ensurepath` if the CLI is missing. |
| **uv** | `uv tool install graphifyy` | Often keeps tools on `PATH` without extra setup. |

### One-time setup in this repo

From the repository root (after Node deps: `pnpm install`):

```bash
pnpm run graphify:install   # registers Claude / VS Code / Copilot integrations (upstream `graphify install`)
pnpm run graphify:hooks     # optional: install post-commit / post-checkout hooks that run `graphify update .`
pnpm run graphify:update    # generate AST graph under graphify-out/ (no API cost)
```

**pnpm wrappers:** [`scripts/graphify-cli.mjs`](../scripts/graphify-cli.mjs) tries `graphify` on `PATH`, then `py -m graphify` / `python -m graphify`, so **`pnpm run graphify:*` works even when Windows did not add pip’s `Scripts` folder to `PATH`**.

### VS Code

Tasks are pre-defined in [`.vscode/tasks.json`](../.vscode/tasks.json) (e.g. **Graphify: update graph (AST)**).

---

## What's in the repo

| Component | Location | Purpose |
|-----------|----------|---------|
| `.graphifyignore` | repo root | Excludes `node_modules/`, `dist/`, `coverage/`, `graphify-out/`, binaries, `.env` |
| `graphify-out/` in `.gitignore` | `.gitignore` | Generated output not committed |
| `graphify-cli.mjs` | `scripts/` | PATH-independent launcher used by `pnpm run graphify:*` |
| Claude Code integration | `CLAUDE.md` + `graphify install` | PreToolUse hook + instructions |
| VS Code Copilot integration | `.github/copilot-instructions.md` | Copilot Chat reads the graph |
| Git hooks | optional, via `pnpm run graphify:hooks` | Auto `graphify update .` after commit/checkout |

### npm/pnpm scripts

| Script | Purpose |
|--------|---------|
| `pnpm run graphify:install` | `graphify install` (skills / editor hooks) |
| `pnpm run graphify:update` | `graphify update .` — refresh AST graph |
| `pnpm run graphify:hooks` | `graphify hook install` — git hooks for auto-update |
| `pnpm run graphify:status` | `graphify hook status` |

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
pnpm run graphify:update
# or, if `graphify` is on your PATH:
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

If `graphify` is not on `PATH`, prefix with `pnpm run graphify --` (e.g. `pnpm run graphify -- query "…"`).

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

After **`pnpm run graphify:hooks`**, Graphify can refresh the graph on **post-commit** and **post-checkout** (see `graphify hook status`). Without hooks, run **`pnpm run graphify:update`** after larger refactors.

```bash
pnpm run graphify:status
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
pnpm run graphify -- . --obsidian
# or: graphify . --obsidian
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
| You edited code | `pnpm run graphify:update` or `graphify update .` (or auto via `pnpm run graphify:hooks`) |
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
| **Windows:** `graphify` not recognized after `pip install graphifyy` | Pip installs `graphify.exe` under **`%APPDATA%\Python\Python3xx\Scripts`** (see pip’s warning). Add that folder to your **user PATH**, open a new terminal, **or** use `pnpm run graphify:*` / `py -m graphify …` (see [`scripts/graphify-cli.mjs`](../scripts/graphify-cli.mjs)). |
| **`graphify` / `uv` not on PATH** (uv/pipx) | Add uv’s bin (`uv tool dir` / `%USERPROFILE%\.local\bin`) or run `pipx ensurepath`; restart the terminal. |
| `graphify: command not found` | Prefer **`pnpm run graphify:update`** / **`pnpm run graphify:install`**, or install via **`pipx install graphifyy`** / **`uv tool install graphifyy`**. |
| Graph is stale | `graphify update .` |
| Hook not firing | `graphify hook install` |
| VS Code Copilot not reading graph | `graphify vscode install` |
| Claude Code hook missing | `graphify claude install` |
| Graph build fails | Check `.graphifyignore`; ensure Python 3.10+ |
