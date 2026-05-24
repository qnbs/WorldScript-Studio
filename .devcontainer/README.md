# StoryCraft Studio — Dev Container

## Overview

This dev container provides a **complete, reproducible development environment** for StoryCraft Studio. It includes every tool the project needs — Node.js, pnpm, Rust/Tauri, Playwright, Python/graphify — pre-installed and cached.

## What's Inside

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 22 LTS | Runtime for Vite, Vitest, React |
| pnpm | 10.33.0 | Package manager (matches `packageManager` field) |
| Rust | stable | Tauri desktop app builds |
| Playwright | Chromium | E2E testing |
| Python 3 | system | graphify knowledge graph tool |
| GitHub CLI | latest | PR/issue workflows |
| Starship | latest | Shell prompt |
| fzf | 0.56.3 | Fuzzy finder |
| zoxide | 0.9.6 | Smart directory jumping |

## Quick Start

1. **Open in Dev Container**: VS Code → `Dev Containers: Reopen in Container`
2. **Wait for setup**: The `postCreateCommand` installs dependencies, builds i18n, and sets up git hooks automatically
3. **Start developing**: `pnpm run dev` (Vite on port 3000)

## Ports

| Port | Service | Auto-forward |
|------|---------|-------------|
| 3000 | Vite Dev Server | Open browser once |
| 4173 | Vite Preview | Notify |
| 6006 | Storybook | Notify |
| 9323 | Playwright Report | Notify |

## Lifecycle Commands

| Phase | Command | Purpose |
|-------|---------|---------|
| `onCreateCommand` | `corepack enable && corepack prepare pnpm@10.33.0 --activate` | Activate pnpm for vscode user |
| `postCreateCommand` | `pnpm install --frozen-lockfile` | Install dependencies |
| `postCreateCommand` | `pnpm run i18n:bundle` | Build i18n bundles |
| `postCreateCommand` | `npx playwright install chromium` | Install Playwright browsers |
| `postCreateCommand` | `pnpm run prepare` | Set up git hooks |
| `postStartCommand` | `node --version && pnpm --version && rustc --version` | Verify toolchain |
| `postAttachCommand` | `echo '✅ StoryCraft Studio ready'` | Ready notification |

## Volumes (Persistent Cache)

| Volume | Mount Point | Purpose |
|--------|-------------|---------|
| `storycraft-pnpm-store` | `~/.local/share/pnpm/store` | pnpm dependency cache |
| `storycraft-cargo-cache` | `/usr/local/cargo/registry` | Rust crate cache |
| `storycraft-rustup-cache` | `/usr/local/rustup` | Rust toolchain cache |

These volumes survive container rebuilds, so you don't re-download everything.

## Environment Variables

See [`.env.example`](.env.example) for all available variables. Key defaults:

- `NODE_OPTIONS=--max-old-space-size=6144` — 6GB heap for Vite + TypeScript
- `CI=true` — Enables Playwright E2E tests
- `VITE_BASE=/` — Dev container serves at root (no GitHub Pages subpath)

## Design Decisions

### Why a Custom Dockerfile instead of a pre-built image?

The pre-built `javascript-node:24-bookworm` image had several issues:
1. **Node 24 is not LTS** — `package.json` requires `node >= 22`; Node 24 can have breaking changes
2. **No Rust toolchain** — Tauri builds require `rustc` + `cargo`
3. **No Playwright system deps** — Chromium needs `libnss3`, `libgbm1`, etc.
4. **No Python** — `graphify` requires Python 3 + pip
5. **No caching volumes** — Every rebuild re-downloads all dependencies

The custom Dockerfile installs everything in one layer for optimal caching.

### Why Node 22 LTS and not 24?

Node 22 is the **current LTS** (until October 2026). Node 24 is in `current` status and may have incompatible API changes. The project's `engines.node >= 22` field supports 22, and 22 LTS is the safest choice.

### Why 8GB RAM?

The project runs Vitest (single-threaded, `maxWorkers: 1`), Vite HMR, and the TypeScript language server simultaneously. 4GB was insufficient — the TypeScript server would OOM during type-checking. 8GB provides comfortable headroom.

### Why `CI=true` by default?

The project's `test:e2e` script requires `CI=true` to run. Setting it in the container env means E2E tests work out of the box without manual env var setup.

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

## Troubleshooting

### Container won't start
- Check Docker has ≥ 8GB RAM allocated (Docker Desktop → Settings → Resources)
- Check disk space ≥ 32GB available

### pnpm install fails
- Delete the `storycraft-pnpm-store` volume: `docker volume rm storycraft-pnpm-store`
- Rebuild the container

### Playwright tests fail
- Verify Chromium is installed: `npx playwright install chromium`
- Check `CI=true` is set: `echo $CI`

### Rust/Tauri build fails
- Verify Rust toolchain: `rustc --version && cargo --version`
- Clear Cargo cache: `cargo cache --autoclean` or delete the `storycraft-cargo-cache` volume

### TypeScript server OOM
- Increase `NODE_OPTIONS` → `--max-old-space-size=8192` in `.devcontainer/.env`
