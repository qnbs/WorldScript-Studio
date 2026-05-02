# CI Reference — StoryCraft Studio

This document describes the **current** GitHub Actions pipeline (`/.github/workflows/ci.yml`) for StoryCraft Studio: job graph, tooling, and how to approximate runs locally.

For historical optimization notes (targets may predate the live workflow), see [`.github/ACTIONS-OPTIMIZATIONS.md`](../.github/ACTIONS-OPTIMIZATIONS.md).

---

## Toolchain (CI parity)

| Requirement | Source |
|-------------|--------|
| Node.js | [`.nvmrc`](../.nvmrc) (currently **22**) |
| Package manager | **pnpm** 10.x ([`package.json`](../package.json) `packageManager`) |
| Lint / format | **Biome** (`pnpm run lint`, `lint:fix`) |
| Types | **TypeScript** `pnpm run typecheck` |
| Unit tests | **Vitest** with V8 coverage (`pnpm exec vitest run --coverage`) |
| E2E | **Playwright** (`pnpm run test:e2e` with `CI=true`) |
| Performance budgets | **Lighthouse CI** via `@lhci/cli` (`.lighthouserc.cjs`) |

---

## Workflow triggers

- `push` to `main` and tags (`'*'`)
- `pull_request` to `main`
- `workflow_dispatch`

**Concurrency:** one run per workflow + branch/PR (`cancel-in-progress: true`).

---

## Job graph

```text
security ──► quality ──┬──► build ──► lighthouse
                       ├──► e2e
                       └──► storybook

build (main, non-PR) ──► upload-pages-artifact
deploy (main, non-PR) needs: build + e2e ──► GitHub Pages
```

| Job | Needs | Purpose |
|-----|--------|---------|
| `security` | — | `pnpm audit --audit-level=high`; on PRs: `dependency-review-action` |
| `quality` | `security` | Matrix **Node `lts/*`** and **`node` (current)** → Biome lint, `tsc`, Vitest + coverage, Codecov (optional token), coverage artifact |
| `build` | `quality` | Production `pnpm run build`, `dist` artifact; on `main` (non-PR): Pages artifact |
| `e2e` | `quality` | Playwright Chromium, `CI=true` |
| `lighthouse` | `build` | LHCI against downloaded `dist` (hard-fail: `assert.exitCode=0`) |
| `storybook` | `quality` | Static Storybook → artifact |
| `deploy` | `build`, `e2e` | **Only** `main` push (not PR): `deploy-pages` |

> **Note:** There is **no** separate `tauri` or `build-node` job in the checked-in workflow; desktop/release builds are documented in [`README.md`](../README.md) / [`CONTRIBUTING.md`](../CONTRIBUTING.md) for local or future automation.

---

## Permissions

- Global default: `contents: read`
- `deploy` job: `pages: write`, `id-token: write` (OIDC for Pages)

---

## Local checks (without Act)

```bash
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm exec vitest run --coverage
pnpm run build
CI=true pnpm run test:e2e
pnpm exec lhci autorun --assert.exitCode=0   # after build + serve/preview as configured in .lighthouserc.cjs
```

---

## Local simulation with Act

[Act](https://github.com/nektos/act) approximates runners; use **job ids from `ci.yml`**:

```bash
npm install -g act

# Typical PR-equivalent slice
act pull_request --job security --job quality

# Jobs that depend on artifacts may need extra setup inside Act
act push --job build --job e2e --job lighthouse --job storybook
```

Codecov (optional):

```bash
act pull_request --job quality -s CODECOV_TOKEN="$CODECOV_TOKEN"
```

---

## Related files

| File | Role |
|------|------|
| `.github/workflows/ci.yml` | Pipeline definition |
| `.nvmrc` | Node version for Actions and dev |
| `.lighthouserc.cjs` | Lighthouse assertions and collect URL |
| `vitest.config.ts` | Coverage thresholds, reporters |
| `playwright.config.ts` | E2E browser and reporter paths |

---

## Commit messages

Conventional Commits are encouraged, for example: `feat:`, `fix:`, `docs:`, `ci:`, `test:`.
