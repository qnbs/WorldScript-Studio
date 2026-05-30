# StoryCraft Studio — Dev Container & GitHub Codespaces

## Overview

This dev container provides a **complete, reproducible development environment** for StoryCraft Studio. It includes every tool the project needs — Node.js, pnpm, Rust/Tauri, Playwright, Python/graphify, Claude Code CLI — pre-installed and cached.

Optimized for both **local Docker** and **GitHub Codespaces** (8-core / 16GB recommended).

## What's Inside

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 22 LTS | Runtime for Vite, Vitest, React |
| pnpm | 10.33.0 | Package manager (matches `packageManager` field) |
| Rust | stable | Tauri desktop app builds |
| Playwright | Chromium | E2E testing |
| Python 3 | system | graphify knowledge graph tool |
| Claude Code CLI | latest | AI-assisted development |
| GitHub CLI | latest | PR/issue workflows |
| Starship | latest | Shell prompt |
| fzf | 0.56.3 | Fuzzy finder |
| zoxide | 0.9.6 | Smart directory jumping |

---

## Quick Start — GitHub Codespaces

1. **Open in Codespaces**: Repo → Code → Codespaces → Create codespace on main
2. **Choose machine**: Use **8-core (16GB)** — the full test suite needs it
3. **Wait for setup**: `postCreateCommand` runs automatically (3–5 min on first build)
4. **Authenticate Claude Code**: `claude` → follow OAuth flow
5. **Run quality gate**: `pnpm run lint && pnpm run typecheck`
6. **Run tests**: `pnpm exec vitest run` (full suite, ~10 min on 8-core)
7. **Start developing**: `pnpm run dev` (Vite on port 3000, auto-forwarded)

### Current Session Context

See `docs/SPRINT-HANDOFF-2026-05-30-encryption-a11y.md` (auto-opened) for what was done and what's remaining. The CI correction loop may still have failing tests — run:

```bash
pnpm exec vitest run 2>&1 | grep "^FAIL " | sort -u
```

---

## Quick Start — Local Docker

1. **Open in Dev Container**: VS Code → `Dev Containers: Reopen in Container`
2. **Wait for setup**: The `postCreateCommand` installs dependencies, builds i18n, and sets up git hooks automatically
3. **Start developing**: `pnpm run dev` (Vite on port 3000)

---

## Ports

| Port | Service | Auto-forward |
|------|---------|-------------|
| 3000 | Vite Dev Server | Open browser once |
| 4173 | Vite Preview | Notify |
| 6006 | Storybook | Notify |
| 9323 | Playwright Report | Notify |

---

## Lifecycle Commands

| Phase | Command | Purpose |
|-------|---------|---------|
| `onCreateCommand` | `corepack enable && corepack prepare pnpm@10.33.0 --activate` | Activate pnpm for vscode user |
| `postCreateCommand` | `pnpm install --frozen-lockfile` | Install dependencies |
| `postCreateCommand` | `pnpm run i18n:bundle` | Build i18n bundles |
| `postCreateCommand` | `npx playwright install chromium` | Install Playwright browsers |
| `postCreateCommand` | `pnpm run prepare` | Set up git hooks |
| `postCreateCommand` | `npm install -g @anthropic-ai/claude-code` | Install Claude Code CLI |
| `postCreateCommand` | `pnpm run lint && pnpm run typecheck` | Quality gate smoke test |
| `postStartCommand` | `node --version && pnpm --version && rustc --version` | Verify toolchain |
| `postStartCommand` | `gh run list --limit 3` | Show CI status |
| `postAttachCommand` | `echo '✅ ready'` | Ready notification |

---

## Volumes (Persistent Cache)

| Volume | Mount Point | Purpose |
|--------|-------------|---------|
| `storycraft-pnpm-store` | `~/.local/share/pnpm/store` | pnpm dependency cache |
| `storycraft-cargo-cache` | `/usr/local/cargo/registry` | Rust crate cache |
| `storycraft-rustup-cache` | `/usr/local/rustup` | Rust toolchain cache |

These volumes survive container rebuilds, so you don't re-download everything.

---

## Environment Variables

Key defaults set in `containerEnv`:

| Variable | Value | Purpose |
|---|---|---|
| `NODE_OPTIONS` | `--max-old-space-size=8192` | 8GB heap for Vite + tsc + Vitest |
| `CI` | `true` | Enables Playwright E2E + parity check |
| `VITE_BASE` | `/` | Root-relative assets (no GitHub Pages subpath) |
| `RUN_MOBILE_E2E` | `0` | Mobile E2E off by default (enable manually) |
| `VITEST_MAX_WORKERS` | `1` | Serial tests (matches `vitest.config.ts`) |
| `PLAYWRIGHT_BROWSERS_PATH` | `/usr/local/playwright` | Pre-installed Chromium location |

---

## CI Correction Loop (Codespaces Workflow)

When the GitHub Quality Gate fails, use this workflow:

```bash
# 1. Find failing tests
pnpm exec vitest run 2>&1 | grep "^FAIL " | sort -u

# 2. Diagnose a specific file
pnpm exec vitest run tests/unit/THE_FILE.test.ts

# 3. Common fix patterns:
#    - "Cannot read properties of undefined (reading 'enableXxx')"
#      → Add all 20 featureFlags to useAppSelector mock state
#    - "Mock<Constructable | Procedure> not assignable"
#      → Use vi.fn<T>() with explicit type; declare vars as Mock<T>
#    - Wrong assertion values (iterations, paths, counts)
#      → Check actual implementation vs test expectation

# 4. After fixing, commit and push
git add tests/unit/...  &&  git commit -m "fix(tests): ..."  &&  git push

# 5. Monitor CI
gh run watch
```

---

## Optimal Modus Operandi (Codespaces 8-Core / 16 GB)

### Session-Start Checklist

```bash
# 1. Sync with remote
git pull origin main

# 2. Install any new deps (fast — pnpm store volume is cached)
pnpm install --frozen-lockfile

# 3. Quick smoke test (lint + typecheck, ~60 s)
pnpm run lint && pnpm run typecheck

# 4. Check recent CI status
gh run list --limit 5
```

### Daily Workflow

- **Parallel Bash calls are safe** on 8-core Codespaces — fire independent lint + typecheck simultaneously.
- **`run_in_background`** is OK for `pnpm run build`, `pnpm run build:edge`, `pnpm exec vitest run --coverage`.
- Before every push: `pnpm run lint && pnpm run i18n:check && pnpm run typecheck && pnpm exec vitest run`
- Before opening a PR: `pnpm exec vitest run --coverage` — update README badge numbers.

### Full Quality Gate (~10–12 min on 8-core, matches CI `quality` job)

```bash
pnpm run lint && pnpm run i18n:check && pnpm run typecheck && pnpm exec vitest run --coverage
```

### Background Build Pattern

```bash
# Start edge build in background while continuing to edit tests
# In Claude Code: use run_in_background=true on the Bash tool call
pnpm run build:edge
# Notified when complete; check dist/index.html for correctness
```

### Test Failure Triage

```bash
# Find all failing test files
pnpm exec vitest run 2>&1 | grep "^FAIL " | sort -u

# Run a single failing file for diagnosis
pnpm exec vitest run tests/unit/THE_FILE.test.ts
```

Common root causes in this project:

| Symptom | Fix |
|---------|-----|
| `Cannot read 'enableIdbAtRestEncryption'` | Add all 20 featureFlags to mock state (B-series: `enableIdbAtRestEncryption: false`, `enableVoiceWasm: false`) |
| PBKDF2 assertion mismatch | Update assertion from `310_000` → `600_000` (OWASP 2024 standard) |
| `execute called before registry enabled` | Add `registry.setEnabled(true)` before execute/executeAsync |
| Context hook throws in tests | Use `vi.mock('../../../contexts/XxxContext', () => ({ useXxxViewContext: vi.fn(...) }))` |

### Timeout Prevention

- Active terminal activity keeps Codespace alive (Vite HMR, test runs, etc.).
- Run `pnpm run dev` in a persistent terminal during long planning or review phases.
- Codespace inactivity timeout: **240 min** (configured in GitHub account settings).

---

## Design Decisions

### Why 16GB RAM / 8-core?

The full test suite (Vitest serial, tsc, Biome, parity check) takes ~10 min on 8-core but crashes with OOM on 4-core/8GB machines. The TypeScript language server + Vite HMR together need ~6GB. Giving the full suite room avoids forced CI-cloud-first workflow.

### Why `VITEST_MAX_WORKERS=1`?

The project's `vitest.config.ts` has `maxWorkers: 1` because parallel test workers cause IDB/state leaks between test files. The env var ensures this applies even when running Vitest from the VS Code extension.

### Why a Custom Dockerfile?

The pre-built `javascript-node:24-bookworm` image lacked: Node 22 LTS, Rust, Playwright system deps, Python/graphify, pre-cached npm store. The custom Dockerfile installs everything in one layer for optimal layer caching.

### Why Node 22 LTS?

Node 22 is the current LTS (until October 2026). Node 24 is `current` status with potential breaking changes. `engines.node >= 22` supports both but 22 LTS is the safest default.

---

## Maintenance

### Updating pnpm version

1. Update `package.json` → `packageManager` field
2. Update `.devcontainer/Dockerfile` → `corepack prepare pnpm@X.Y.Z --activate`
3. Update `.devcontainer/devcontainer.json` → `onCreateCommand.enable-pnpm`
4. Rebuild the container

### Updating Node.js version

1. Update `.devcontainer/Dockerfile` → `nodesource/setup_XX.x`
2. Update `package.json` → `engines.node`
3. Rebuild the container

### Adding new system packages

Edit `.devcontainer/Dockerfile` → `apt-get install` section, then rebuild.

### Adding VS Code extensions

Edit `.devcontainer/devcontainer.json` → `customizations.vscode.extensions`, then rebuild.

---

## Troubleshooting

### Codespaces — wrong machine size

Use the machine picker to switch to 8-core / 16GB:
GitHub → Your Codespace → Machine type → 8-core.

### Container won't start (local Docker)

- Check Docker has ≥ 16GB RAM allocated (Docker Desktop → Settings → Resources)
- Check disk space ≥ 32GB available

### pnpm install fails

- Delete the `storycraft-pnpm-store` volume: `docker volume rm storycraft-pnpm-store`
- Rebuild the container

### Playwright tests fail

- Verify Chromium: `npx playwright install chromium`
- Check `CI=true`: `echo $CI`

### Rust/Tauri build fails

- Verify: `rustc --version && cargo --version`
- Clear cache: delete the `storycraft-cargo-cache` volume

### TypeScript server OOM

- Already set to 8GB in `containerEnv.NODE_OPTIONS`
- If still OOM, kill tsc server: `Ctrl+Shift+P` → "TypeScript: Restart TS Server"

### Claude Code not found after container create

```bash
npm install -g @anthropic-ai/claude-code
claude auth login
```
