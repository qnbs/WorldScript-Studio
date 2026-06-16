# CI Audit — WorldScript Studio

**As of:** 2026-05-21; **last updated:** 2026-06-01 · **Workflow files:** `ci.yml`, `tauri-build.yml`, `prune-deployments.yml`, `storybook-debug.yml`, `scorecard.yml`, `codeql.yml`, `docker.yml`

This document summarizes the **current inventory** and **stabilization measures** for the GitHub pipeline. Full job descriptions: [`docs/CI.md`](../docs/CI.md).

---

## Workflow inventory

| File | Trigger | Core jobs |
|------|---------|-----------|
| [`workflows/ci.yml`](workflows/ci.yml) | `push`/`pull_request` **main**, tags, `workflow_dispatch` | `security` → `quality` (matrix) → `build` \| `e2e` \| `storybook` \| `mutation` → `lighthouse` \| `vrt` → `deploy` (main) |
| [`workflows/tauri-build.yml`](workflows/tauri-build.yml) | `workflow_dispatch`, tags `v*` | Desktop bundles (Linux/Win/macOS) |
| [`workflows/prune-deployments.yml`](workflows/prune-deployments.yml) | `workflow_run` (after CI/CD), weekly cron, `workflow_dispatch` | Prune ALL environments (Production/Preview/github-pages); keeps latest 3 per env |
| [`workflows/storybook-debug.yml`](workflows/storybook-debug.yml) | `workflow_dispatch` only | Cloud-first Storybook debug: configurable workers/retries, PWDEBUG output |
| [`workflows/scorecard.yml`](workflows/scorecard.yml) | weekly cron, `workflow_dispatch` | OpenSSF Scorecard → GitHub Code Scanning SARIF (publish_results=false; api.scorecard.dev timed out on push runs) |
| [`workflows/codeql.yml`](workflows/codeql.yml) | `push`/`pull_request` main, weekly cron | CodeQL JS/TS SAST |
| [`workflows/docker.yml`](workflows/docker.yml) | `push` main | Docker image build + push to GHCR |

**All actions on node24** — node20 actions were upgraded 2026-06-01: `actions/cache` v4.2.3→v5.0.5, `actions/github-script` v7→v9.0.0.

---

## Toolchain (local ↔ CI parity)

| Topic | Source | Value |
|-------|--------|-------|
| Node (recommended) | [`.nvmrc`](../.nvmrc) | **22** |
| Node (CI matrix) | `ci.yml` `quality` | **22** and **24** (explicit, no `node` = "current") |
| pnpm | `package.json` `packageManager` | **11.5.2** |
| Lint | Biome | `pnpm run lint` |
| i18n | `scripts/check-i18n-keys.mjs` | `pnpm run i18n:check` |
| Unit | Vitest + V8 | `pnpm exec vitest run --coverage` |
| E2E | Playwright | `CI=true pnpm run test:e2e` |
| Bundle | `scripts/check-bundle-budget.mjs` | max **7000 KB** per chunk, max **4500 KB** entry (`index-*.js`) |
| Lighthouse | `.lighthouserc.cjs` | Accessibility **error** ≥ 0.95; CLS **error** ≤ 0.1; Performance **warn** |

---

## Stabilizations applied (Audit 2026-05)

| Problem | Fix |
|---------|-----|
| Matrix `node-version: ['lts/*', 'node']` breaks on new Node release without code changes | Pinned to **`['22', '24']`** |
| Entry chunk grows with Plot-Board splits | Separate budget **`--max-entry-kb 4500`** in `bundle:budget` |
| Vendor chunks (ML, DuckDB) | `manualChunks` + PWA `resolveDependencies` filter for `plot-board`, `vendor-duckdb`, `vendor-ai-onnx` |

---

## Local reproduction (quick vs heavy)

**Quick (laptop, 2–4 GB RAM):**

```bash
pnpm run lint && pnpm run i18n:check && pnpm run typecheck
# optional: pnpm exec vitest run   # without --coverage
```

**Heavy (CI parity):**

```bash
pnpm install --frozen-lockfile
pnpm run lint && pnpm run i18n:check && pnpm run typecheck
pnpm exec vitest run --coverage
pnpm run build && pnpm run bundle:budget
CI=true pnpm run test:e2e
# optional after build: pnpm exec lhci autorun
```

**Low-end scripts:** [`infra/low-end-ci/`](../infra/low-end-ci/) (`pnpm run ci:quick`, `pnpm run ci:act`).

---

## Risk register (open / monitor)

| Risk | Mitigation |
|------|------------|
| Lighthouse Performance `warn` — mobile emulation unstable | Only **warn**; CLS + a11y as **error** |
| E2E flakes (SPA + mobile project) | Retries 2, 1 worker; on flake: fix spec/helper, do not globally skip |
| Tauri `ubuntu-22.04` vs 24.04 | Separate PR after package check |
| Dynamic Vite `base` for custom domains | Product decision — not part of baseline CI fix |

---

## Security jobs (already in `ci.yml`)

- `pnpm audit --audit-level=high`
- OSV scanner (`pnpm-lock.yaml` + `src-tauri/Cargo.lock`)
- gitleaks (history scan, `fetch-depth: 0`)
- PR: dependency-review-action
- OpenSSF Scorecard (separate job, weekly + main)

**Optional (on explicit request only):** dedicated CodeQL workflow, SBOM attestation via release tags.

---

## Next steps (maintainer)

1. After major features: `pnpm run graphs:update` (repo policy, not in CI). Updates Graphify + CodeGraph.
2. After a green CI run: update README badges and `AUDIT.md` metrics from Codecov/logs.
3. On bundle regression: `pnpm run analyze` → artifact `bundle-analysis.html` in the CI run view.
