# GitHub Actions — Optimization History

> **Note (2026-05):** The table and detail sections below describe an **optimization round and target values**. The **currently valid** job structure, triggers, and tooling are documented in [**`docs/CI.md`**](../docs/CI.md) and [`.github/workflows/ci.yml`](./workflows/ci.yml). Deviations (e.g. missing `tauri`/`build-node` jobs in the main workflow) are expected as the pipeline has been further simplified. This file is linked from the **[README § Documentation Hub](../README.md#-documentation-hub)**.

## Goal

Documentation of an audit round for `.github/workflows/ci.yml` and related components: permissions, caching, artifacts, timeouts, and secret usage.

## Overview table (historical target values)

| Job          | Direction                                            | Notes                                                                        |
| ------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| Quality gate | Lint + typecheck + tests in one job, Node matrix     | Today: job ID `quality` (Biome + `tsc` + Vitest)                             |
| `security`   | `pnpm audit` + dependency review (PRs)               | Runs before the quality gate                                                 |
| `build`      | Vite production + artifact                           | Pages upload on `main` only                                                  |
| `e2e`        | Playwright parallel with other jobs after quality    | Deploy depends on `build` + `e2e`                                            |
| `lighthouse` | Budgets after successful build                       | Config: `.lighthouserc.cjs`                                                  |
| `storybook`  | Static build as artifact                             |                                                                              |
| `deploy`     | GitHub Pages                                         | `pages: write` only in the deploy job                                        |

## Permissions (guiding principle)

- Default: minimal `contents: read`
- Deploy: additionally `pages: write` and `id-token` where needed for OIDC

## Secrets

- Codecov: optional via `CODECOV_TOKEN`
- Lighthouse GitHub App: optional `LHCI_GITHUB_APP_TOKEN` for extended integration

## Further reference

- [`docs/CI.md`](../docs/CI.md) — current pipeline description (English, CI-parity-focused)
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — local development and quality commands
- [`tests/e2e/helpers.ts`](../tests/e2e/helpers.ts) — Playwright helpers (SPA-ready waits; no `networkidle` under Vite)
