# Graphify — Knowledge Graph Setup

WorldScript Studio has a fully configured [graphify](https://github.com/Graphify-Labs/graphify) knowledge graph (repo moved from `safishamsi/graphify`; the old URL still resolves).
Graph output lives at `graphify-out/`. **Solo-repo policy (this project):** only `graphify-out/GRAPH_REPORT.md` is committed; `graph.json`, `graph.html`, and `cache/` stay local and are regenerated with `pnpm run graphify:update`.

**Other docs:** CI and automation → [`CI.md`](CI.md); full documentation map → [`README.md`](../README.md#-documentation-hub) *Documentation Hub*; inventory of all maintainer `.md` files → [`AUDIT.md`](../AUDIT.md). **Dual-Graph master guide:** [`docs/dual-graph-setup.md`](dual-graph-setup.md) — how Graphify and CodeGraph work together.

**Official PyPI name:** `graphifyy` (double **y**). The CLI is still `graphify`. `pip install graphify` can pull an **unrelated** package — always use `graphifyy`.
**Version policy:** the single source of truth is [`config/graph-tools-versions.json`](../config/graph-tools-versions.json) — currently pinned to `graphifyy==0.9.51` under a `controlled-upgrade` policy (see that file's `notes` for the evaluated 0.8.26→0.9.51 changes, including a self-migrating node-ID format change in v0.9.0). Don't hardcode the version elsewhere; `pnpm run graphify:bootstrap` reads it from there.

---

## Installation (Python)

`pnpm run graphify:bootstrap` installs the exact pinned version automatically, trying these in order —
whichever is available on your machine — and never falling back to an unpinned "latest" install:

| Priority | Method | Command it runs |
|----------|--------|--------|
| 1 | **uv** | `uv tool install --force graphifyy==<pinned>` — replaces an older exact-pinned tool on `PATH` |
| 2 | **pipx** | `pipx install --force graphifyy==<pinned>` — replaces an older isolated tool; run `pipx ensurepath` if the CLI is missing |
| 3 | **pip** | `python -m pip install graphifyy==<pinned>` — on Windows, `graphify.exe` may land in `%APPDATA%\Python\Python3xx\Scripts`, often **not** on `PATH` until added |

All three provide the same `graphify` command (or `python -m graphify`). Which one actually runs on a
given machine is local evidence of what's installed there, not a portability requirement — a fresh
clone on a different machine may resolve through a different one of the three, and that's fine.

### One-time setup in this repo

From the repository root (after Node deps: `node scripts/dependency-state.mjs reconcile`):

```bash
pnpm run graphify:bootstrap # installs the exact pinned version (see config/graph-tools-versions.json)
pnpm run graphify:update    # generate AST graph under graphify-out/ (no API cost)
pnpm run graphs:doctor      # read-only: confirm installed version matches policy, check report freshness
```

`pnpm run graphify:install` (registers Claude/VS Code/Copilot editor integrations) and
`pnpm run graphify:hooks` (git post-commit/post-checkout auto-update) are **optional, not part of the
one-time setup** — see the caution under [Automatic updates](#automatic-updates) below before running
either.

**Windows:** If `python` opens the Microsoft Store or `graphify` is “not found”, install Python from **python.org** (tick **Add to PATH**), then run `pnpm run graphify:bootstrap` again.

**pnpm wrappers:** [`scripts/graphify-cli.mjs`](../scripts/graphify-cli.mjs) tries `graphify` on `PATH`, then `py -m graphify` / `python -m graphify`, so **`pnpm run graphify:*` works even when Windows did not add pip’s `Scripts` folder to `PATH`**.

### VS Code

Tasks are pre-defined in [`.vscode/tasks.json`](../.vscode/tasks.json) (e.g. **Graphify: update graph (AST)**).

---

## What's in the repo

| Component | Location | Purpose |
|-----------|----------|---------|
| `config/graph-tools-versions.json` | repo root `config/` | Sole version-policy source for both Graphify and CodeGraph |
| `.graphifyignore` | repo root | Excludes `node_modules/`, `dist/`, `coverage/`, `graphify-out/`, `.codegraph/`, `.claude/`, `.git/`, worktrees, binaries, `.env` |
| Solo git policy | `.gitignore` | `graphify-out/*` ignored except `GRAPH_REPORT.md` (no multi-MB HTML/JSON history in git) |
| `graphify-update.mjs` | `scripts/` | Cleans ephemeral outputs, then `graphify update .` (local runtime state only) |
| `graphify-report.mjs` | `scripts/` | Regenerates the committed compact `GRAPH_REPORT.md`, gated on a clean source tree |
| `graphify-bootstrap.mjs` | `scripts/` | Portable pinned install (uv → pipx → pip), reads `config/graph-tools-versions.json` |
| `graphify-cli.mjs` | `scripts/` | PATH-independent launcher used by `pnpm run graphify:*` |
| `graphSourceFingerprint.mjs` | `scripts/` | Shared worktree-aware fingerprint module (freshness, both tools) |
| `graphs-cli.mjs` | `scripts/` | Combined dual-graph orchestrator — `pnpm run graphs:*` |
| Claude Code integration | `CLAUDE.md` + `graphify install` | PreToolUse hook + instructions |
| VS Code Copilot integration | `.github/copilot-instructions.md` | Copilot Chat reads the graph |
| Git hooks | optional, via `pnpm run graphify:hooks` | Not recommended by default — see [Automatic updates](#automatic-updates) |

### npm/pnpm scripts

| Script | Purpose |
|--------|---------|
| `pnpm run graphify:bootstrap` | Installs the exact pinned version (uv → pipx → pip) |
| `pnpm run graphify:install` | `graphify install` (skills / editor hooks) — inspect before running with `--project` |
| `pnpm run graphify:update` | `graphify update .` — refresh AST graph (CPU/RAM heavy; not in pre-commit) |
| `GRAPHIFY_SKIP=1 pnpm run graphify:update` | Skip update (no-op) |
| `pnpm run graphify:hooks` | `graphify hook install` — not recommended by default, see above |
| `pnpm run graphify:status` | `graphify hook status` |
| `pnpm run graphs:doctor` / `graphs:status` / `graphs:update` / `graphs:report` / `graphs:refresh` / `graphs:bootstrap` | Combined dual-graph interface — see [`dual-graph-setup.md`](dual-graph-setup.md) |

---

## Current graph stats

Hardcoding a stats snapshot here always drifts out of sync with the real graph on the next build —
this is exactly what happened to this section previously (it showed a build from months earlier).
**Current stats, God Nodes, and freshness live in the committed report's own header:**
[`graphify-out/GRAPH_REPORT.md`](../graphify-out/GRAPH_REPORT.md). Check `pnpm run graphs:status` to
see at a glance whether that report is `FRESH` or `STALE` relative to the current source tree.

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

`pnpm run graphify:hooks` (`graphify hook install`) can refresh the graph automatically on
**post-commit**/**post-checkout** via Graphify's *own* hook-installer — a separate mechanism from this
repo's `simple-git-hooks` setup. **Not recommended by default:** it appends to whatever hook file
already exists there rather than replacing it, so two independent hook-installing systems would
coexist unpredictably, and it adds latency to every commit on constrained hardware. Prefer explicit,
on-demand refresh instead:

```bash
pnpm run graphs:update    # local runtime state only (graph.json/graph.html), fast
pnpm run graphs:refresh   # update + regenerate the committed report, strict — run before a PR
pnpm run graphs:status    # fast read-only freshness check (FRESH/STALE), no mutation
```

If you've measured a real, compelling benefit from the hooks on your own machine and understand the
dual-installer risk, `pnpm run graphify:hooks` remains available — but it's an opt-in exception, not
the default workflow this repo recommends.

---

## Privacy — query logging

Graphify can optionally log every `query`/`path`/`explain`/MCP query to `~/.cache/graphify-queries.log`
(JSON Lines: timestamp, question, corpus, nodes returned, duration). **This is OFF by default** as of
`graphifyy` v0.9.13 (the pinned `0.9.51` postdates that fix). If you ever want a hard guarantee it stays
off regardless of future config, set `GRAPHIFY_QUERY_LOG_DISABLE=1`; `GRAPHIFY_QUERY_LOG_ENABLE=1` /
`GRAPHIFY_QUERY_LOG=<path>` opt back in if you ever want it. This is a local, per-machine preference —
never committed to the repo. The default AST-only build/update path (`graphify update .`, everything
`graphs:update` runs) does not require network access; only the separate semantic/LLM rebuild mode
(`/graphify .` in chat, see [Full semantic rebuild](#full-semantic-rebuild-uses-llm-costs-tokens) above)
and this query log touch anything outside the local build.

---

## Fine-tuning what gets indexed

Edit `.graphifyignore` (same syntax as `.gitignore`) — see the file itself for the current, authoritative exclusion list (build outputs, `node_modules/`, test artifacts, `graphify-out/` self-exclusion, `.codegraph/`'s own local index, `.claude/`, `.git/`, sibling git worktrees, binaries/media, secrets). Don't duplicate that list here where it can drift out of sync.

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
| `graphify: command not found` | Prefer **`pnpm run graphify:update`** / **`pnpm run graphify:install`**, or install the pinned package via **`pipx install --force graphifyy==<pinned>`** / **`uv tool install --force graphifyy==<pinned>`**. |
| Graph is stale | `graphify update .` |
| Hook not firing | `graphify hook install` |
| VS Code Copilot not reading graph | `graphify vscode install` |
| Claude Code hook missing | `graphify claude install` |
| Graph build fails | Check `.graphifyignore`; ensure Python 3.10+ |
