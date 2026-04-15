# CI Reference for StoryCraft Studio

This document summarizes the current GitHub Actions workflow for StoryCraft Studio, including local simulation with `act`, job behavior, and optimization details.

## Pipeline Overview

The repository uses a single main workflow:

- `.github/workflows/ci.yml`

It runs on:

- `push` to `main`
- `pull_request` against `main`
- `workflow_dispatch`
- `push` to tags for release-style jobs

## Included Jobs

The workflow is optimized for fast feedback and minimal redundancy.

### Main jobs

- `lint` — ESLint + Prettier
- `typecheck` — TypeScript `tsc --noEmit`
- `security` — GitHub dependency review plus `npm audit` on dependency changes only
- `test` — Vitest with coverage, JUnit output, Codecov upload if `CODECOV_TOKEN` is present, and visual regression baseline artifact upload
- `storybook` — static Storybook build artifact
- `build` — production `npm run build` on `lts/*`
- `build-node` — optional `node` compatibility build for tag/dispatch releases
- `lighthouse` — LHCI budget validation against the generated production `dist`
- `deploy` — GitHub Pages deployment on `main`
- `tauri` — optional Tauri desktop build on tags or manual dispatch with path-based filtering

## Local CI Simulation with Act

You can run the main pipeline locally with [Act](https://github.com/nektos/act). This is especially useful for validating workflow logic before pushing.

```bash
npm install -g act

# Simulate PR jobs locally
act pull_request --job lint --job typecheck --job test --job storybook --job build

# Simulate release-style jobs on tag/dispatch
act push --job build --job build-node --job lighthouse
```

### Secrets with Act

If you need to test Codecov locally, provide the token using `-s`:

```bash
export CODECOV_TOKEN="your_token_here"
act pull_request -s CODECOV_TOKEN=${CODECOV_TOKEN}
```

For repeated local runs, create a secret file and pass it with `--secret-file`.

## Optimization Notes

- `npm audit` runs only when dependency files change (`package.json`, `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`).
- The shared Node setup action caches npm, `node_modules`, and Playwright browsers.
- Artifact uploads include retention settings to avoid long-term storage growth.
- Most jobs use `contents: read` permission only; deploy uses `pages: write`.
- The Tauri job only runs on relevant file changes and on explicit tag or manual dispatch triggers.

## Workflow File Location

- Workflow: `.github/workflows/ci.yml`
- Shared Node setup action: `.github/actions/setup-node/action.yml`
- Lighthouse config: `.lighthouserc.json`
- Optimization summary: `.github/ACTIONS-OPTIMIZATIONS.md`

## Commit message guidance

The repository follows Conventional Commits. Use commit messages like:

- `feat: add X`
- `fix: resolve Y`
- `ci: update workflow`
- `docs: add CI reference`
