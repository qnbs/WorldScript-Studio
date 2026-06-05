# CI Reference — StoryCraft Studio

This document describes the **current** GitHub Actions pipeline (`/.github/workflows/ci.yml`) for StoryCraft Studio: job graph, tooling, and how to approximate runs locally.

For historical optimization notes (targets may predate the live workflow), see [`.github/ACTIONS-OPTIMIZATIONS.md`](../.github/ACTIONS-OPTIMIZATIONS.md).

**Audit snapshot (inventory, risks, stabilization log):** [`.github/CI-AUDIT.md`](../.github/CI-AUDIT.md).

---

## Cloud CI-first vs local development

**Canonical quality gate:** GitHub Actions. Low-end local machines should **not** be expected to run the full heavy stack.

| Tier | Where | Commands / scope |
|------|--------|------------------|
| **Quick (local)** | Developer laptop | `pnpm run lint`, `pnpm run typecheck`, `pnpm run i18n:check`; optional `pnpm exec vitest run` **without** `--coverage` for a fast smoke |
| **Heavy (CI)** | `ci.yml` | Vitest **with** `--coverage` and thresholds, Playwright E2E (`CI=true`) including **mobile emulation** (Pixel 5 / Chromium), Lighthouse CI, Stryker (informational), Storybook static build, bundle budget + analyze |

**Merge readiness:** A green workflow run on the PR/branch matters more than reproducing every E2E or LHCI step locally. Use CI **artifacts** (Playwright HTML report, coverage, Lighthouse output) to debug failures.

**Optional local deep dive:** `CI=true pnpm run test:e2e`, `pnpm exec vitest run --coverage`, `pnpm exec lhci autorun` — only when the machine has enough CPU/RAM and time. Mobile Playwright project locally: set `RUN_MOBILE_E2E=1` (see [`playwright.config.ts`](../playwright.config.ts)).

**Post-merge doc update workflow:**
1. Push the commit → CI starts automatically.
2. `gh run watch $(gh run list --limit 1 --json databaseId -q '.[0].databaseId')` — stream the live run.
3. When `quality` job completes, read the coverage summary from the CI logs or Codecov badge.
4. Update `README.md` badges (`Tests-NNN_%2F_NNN_files`, `Coverage-XX.XX%25_Lines`), `AUDIT.md` quality-gate line, and `CLAUDE.md` v1.x Patterns if the test count changed significantly.
5. Commit the doc update: `chore(docs): update metrics from CI vX.Y.Z`.

---

## Toolchain (CI parity)

| Requirement | Source |
|-------------|--------|
| Node.js | [`.nvmrc`](../.nvmrc) (currently **22**) |
| Package manager | **pnpm** 10.x ([`package.json`](../package.json) `packageManager`) |
| Lint / format | **Biome** (`pnpm run lint`, `lint:fix`) |
| i18n parity | **`pnpm run i18n:check`** — every locale must expose the same keys as `locales/en/*.json` (see [`scripts/check-i18n-keys.mjs`](../scripts/check-i18n-keys.mjs); optional `--fix` copies missing strings from EN) |
| Types | **TypeScript 7** (`tsgo`) `pnpm run typecheck` |
| Unit tests | **Vitest** with V8 coverage (`pnpm exec vitest run --coverage`) |
| E2E | **Playwright** (`pnpm run test:e2e` with `CI=true`) |
| Performance budgets | **Lighthouse CI** via `@lhci/cli` (`.lighthouserc.cjs`) — **accessibility** asserted at **`error`** level `minScore: 0.95` (blocks CI); performance `warn` ≥ 0.4; SEO `warn` ≥ 0.8; CLS `error` ≤ 0.1; FCP `warn` ≤ 5 s; LCP `warn` ≤ 7 s |
| Bundle guardrails | **`pnpm run bundle:budget`** (max chunk KB) + **`pnpm run analyze`** (rollup visualizer → `dist/bundle-analysis.html`, artifact in CI) |

---

## Composite setup action

`.github/actions/setup/action.yml` centralises pnpm + Node.js bootstrap into one reusable step used by every job:

```
pnpm/action-setup → actions/setup-node (cache: pnpm) → pnpm install --frozen-lockfile
```

Each job that uses the composite must call `actions/checkout@v6` first (local composite actions are resolved from the workspace, so the repo must be checked out before `uses: ./.github/actions/setup` can be used). The `quality` job additionally passes `node-version: ${{ matrix.node-version }}` to cover the LTS matrix.

---

## Workflow triggers

- `push` to `main` and tags (`'*'`)
- `pull_request` to `main`
- `workflow_dispatch`

**Concurrency:** one run per workflow + branch/PR; `cancel-in-progress: true` **for PRs only** (main branch pushes are never cancelled — each push builds its own run so deploy history is clean).

---

## Job graph

```text
security ──► quality ──┬──► build ──┬──► lighthouse
                       ├──► e2e     └──► vrt
                       ├──► storybook
                       └──► mutation (Stryker; informational score gate)

build (main, non-PR) ──► upload-pages-artifact
deploy (main, non-PR) needs: build + e2e ──► GitHub Pages
```

| Job | Needs | Purpose |
|-----|--------|---------|
| `security` | — | `pnpm audit --audit-level=high`; **OSV scanner** (`google/osv-scanner-action`) for npm + Rust lockfiles; `gitleaks` secrets scan; on PRs: `dependency-review-action` |
| `quality` | `security` | Matrix **Node 22** and **24** → Biome lint, **`pnpm run i18n:check`**, **`pnpm run parity:check`**, `tsc`, Vitest + coverage, Codecov (optional token), coverage artifact |
| `build` | `quality` | Production `pnpm run build`, **`bundle:budget`**, **`analyze`** (upload `bundle-analysis.html`), `dist` artifact; on `main` (non-PR): Pages artifact + **SLSA build provenance attestation** |
| `e2e` | `quality` | Playwright **Chromium** + **Mobile Chrome** (Pixel 5) — `CI=true`, 2× retries, 50 min timeout; browser cache via `actions/cache@v5`. Firefox optional locally. `PLAYWRIGHT_SKIP_VRT=true` (VRT is its own job). |
| `mutation` | `quality` | **`pnpm run mutation`** if `stryker.conf.json` exists; **`break: 75`** → score <75% fails the job (timeout at 20 min is expected on shared runners — not a blocker for deploy) |
| `lighthouse` | `build` | LHCI (mobile): **accessibility error gate** `minScore: 0.95`; **CLS error** ≤ 0.1; performance/SEO warn. Desktop run: `continue-on-error: true` until baselines stabilise. Timeout 25 min. |
| `storybook` | `quality` | Cloud-first — Storybook build + test-runner only run in CI (not locally); Playwright browser cache `v5`; `--max-workers=2 --retries=3 --screenshot-on-failure`; artifacts uploaded always. Debug: manual `storybook-debug.yml` workflow. |
| `vrt` | `build` | Visual regression against production `dist`; `toHaveScreenshot()` with committed PNG baselines (4 views × Chromium); artifacts uploaded always |
| `deploy` | `build`, `e2e` | **Only** `main` push (not PR): `deploy-pages` |

> **Desktop:** On-demand / tag-driven Tauri bundles live in [`tauri-build.yml`](../.github/workflows/tauri-build.yml); **`v*` tags** additionally publish installers on a **GitHub Release**. See [`docs/TAURI-CI.md`](TAURI-CI.md). Desktop CI does not block the web deploy graph above.

---

## Supply-chain security

| Tool | Trigger | Output |
|------|---------|--------|
| **gitleaks** (`gitleaks/gitleaks-action`) | Every CI run (security job) | Fails on leaked secrets/tokens in source or git history |
| **SLSA build provenance** (`actions/attest-build-provenance`) | `main` push only (build job) | `.intoto.jsonl` attestation attached to the run |
| **OpenSSF Scorecard** (`ossf/scorecard-action`) | Weekly cron + `main` push | SARIF → GitHub Code Scanning; separate `scorecard.yml` workflow |
| **CodeQL** (`github/codeql-action`) | Every push/PR + weekly | JS/TS SAST → GitHub Code Scanning; `codeql.yml` workflow |
| **SHA-pinned actions** | Every job | All `uses:` references pinned to commit SHA (`# vN` comment) — immune to tag-mutable supply-chain attacks; Dependabot updates SHAs automatically |
| **Dependabot** | Weekly (Monday) | PRs for npm deps (dev-tooling grouped) + GitHub Actions SHA bumps (max 5 open PRs) |
| **`dependency-review-action`** | PRs only (security job) | Blocks PRs that introduce new high/critical vulnerabilities |
| **Branch protection** | Always | `main` requires 1 approved review, required status checks (security, quality ×2, build), no force-push |

---

## Permissions

- Global default: `contents: read`
- `security` job (PR dependency review): additional `pull-requests: read` so `dependency-review-action` can read changed manifests.
- `build` job (main, non-PR): `attestations: write` + `id-token: write` for SLSA provenance signing.
- `deploy` job: `pages: write`, `id-token: write` (OIDC for Pages)

**Upload artifacts:** Coverage, Playwright, and Lighthouse reports use `if-no-files-found: warn`, so missing folders after aborts do not turn the workflow additionally red — logs of the failing steps remain the source of truth.

---

## Local checks (without Act)

On **low-resource** machines, stop at the **Quick** tier (see [Cloud CI-first vs local development](#cloud-ci-first-vs-local-development)): **`pnpm run lint`**, **`pnpm run typecheck`**, **`pnpm run i18n:check`**, and optionally **`pnpm exec vitest run`** without `--coverage`. Treat **`CI=true pnpm run test:e2e`** (desktop + mobile projects in CI), **Lighthouse**, and **coverage threshold enforcement** as **CI-owned** unless you have a powerful workstation.

```bash
pnpm install --frozen-lockfile
pnpm run lint
pnpm run i18n:check
pnpm run typecheck
pnpm exec vitest run --coverage
pnpm run build
pnpm run bundle:budget
pnpm run analyze   # optional locally; CI uploads HTML report
CI=true pnpm run test:e2e
pnpm exec lhci autorun   # after build + serve/preview as configured in .lighthouserc.cjs
```

---

## Local CI/CD on low-end hardware (act + Forgejo)

For **Ubuntu 20.04 / 2–4 GB RAM** laptops: run the **Quick tier** natively (no Docker) and use **[act](https://github.com/nektos/act)** + optional **Forgejo** as a GitHub backup — not a second pipeline language.

| Tier | Command | When |
|------|---------|------|
| **Quick (daily)** | `pnpm run ci:quick` / `ci:quick:unit` | Every commit |
| **Full workflow (on-demand)** | `pnpm run ci:act` | Before release / weekly |
| **Eco Git** | `infra/low-end-ci/scripts/ci-eco-start.sh` | Only when pushing to local Forgejo |

**Full setup:** [`infra/low-end-ci/INSTALL.md`](../infra/low-end-ci/INSTALL.md) · **Daily checklist:** [`infra/low-end-ci/DAILY-DRIVER.md`](../infra/low-end-ci/DAILY-DRIVER.md)

Baseline hardware eval: `infra/low-end-ci/eval-template.sh` → `~/storycraft-ci/eval-*.txt`

---

## Local simulation with Act (manual)

If you already installed act (see INSTALL.md), use **job ids from `ci.yml`**. Prefer the repo wrapper (sequential, one matrix axis):

```bash
pnpm run ci:act
# or:
./infra/low-end-ci/scripts/ci-act-sequential.sh pull_request
```

Manual slices:

```bash
act pull_request --sequential -j security -j quality --matrix node-version:22 -W .github/workflows/ci.yml
act pull_request -j build -W .github/workflows/ci.yml
```

Codecov (optional):

```bash
act pull_request -j quality -s CODECOV_TOKEN="$CODECOV_TOKEN" -W .github/workflows/ci.yml
```

**Limits on 2 GB RAM:** run Forgejo **stopped** during act; use **6 GB swap**; skip `deploy` / SLSA / `dependency-review` locally; E2E may need `--e2e-chromium-only` (see DAILY-DRIVER.md).

---

## E2E authoring (Playwright)

- Specs run **only** when `CI=true` (`pnpm run test:e2e`). CI installs **Chromium**; locally you may also run Firefox projects (`playwright.config.ts`).
- Shared utilities: **[`tests/e2e/helpers.ts`](../tests/e2e/helpers.ts)** — replace brittle `networkidle` waits with `waitForSpaReady()`, bootstrap projects via `ensureBlankProject()`, and prefer **sidebar-scoped** locators (`#sidebar`) so desktop navigation is unambiguous.
- **Accessibility:** **[`tests/e2e/a11y.spec.ts`](../tests/e2e/a11y.spec.ts)** runs **axe-core** (via `@axe-core/playwright`) on the welcome route and on **Settings → Accessibility** after `ensureBlankProject`; serious/critical violations must be zero (`color-contrast` rule disabled — track tokens separately).
- **Command palette:** **[`tests/e2e/commands.spec.ts`](../tests/e2e/commands.spec.ts)** — palette open/close (Ctrl+K / Escape), "dashboard" search, fuzzy "wrt" search, Enter-navigate. Depends on `ensureBlankProject()`.
- **Collaboration:** **[`tests/e2e/collaboration.spec.ts`](../tests/e2e/collaboration.spec.ts)** — security warning `[role="alert"]` visible before connection; uses `ensureBlankProject()`.
- The **Version Control** drawer uses a modal backdrop; close it (**Escape** when no nested modal is open) before clicking other chrome.
- Visual baselines live under `tests/e2e/*-snapshots/`; `snapshotPathTemplate` omits the OS segment so one PNG can serve Linux CI and Windows/macOS dev machines.

---

## Related files

| File | Role |
|------|------|
| `.github/workflows/ci.yml` | Pipeline definition |
| `.github/ACTIONS-OPTIMIZATIONS.md` | Historical runner optimization notes (see this file for **current** graph) |
| `.github/workflows/tauri-build.yml` | Optional desktop bundle builds + GitHub Release assets on `v*` tags |
| `.nvmrc` | Node version for Actions and dev |
| `.lighthouserc.cjs` | Lighthouse assertions and collect URL |
| `vitest.config.ts` | Coverage thresholds, reporters |
| `scripts/check-bundle-budget.mjs` | Chunk size budget after `pnpm run build` |
| `renovate.json` | Renovate Bot: patch auto-merge policy |
| `.github/actions/setup/action.yml` | Composite action: Node + pnpm setup reused by all jobs |
| `.github/dependabot.yml` | Dependabot: npm + GitHub Actions weekly updates, dev-tooling grouped |
| `.github/workflows/scorecard.yml` | OpenSSF Scorecard weekly run → Code Scanning SARIF |
| `playwright.config.ts` | E2E projects (CI: Chromium desktop + Pixel 5; local: Chromium + Firefox, optional mobile via `RUN_MOBILE_E2E=1`), `snapshotPathTemplate`, reporters |
| `tests/e2e/helpers.ts` | SPA-ready waits (avoid `networkidle` with Vite/HMR), EN locale, blank project bootstrap, `#sidebar` scope |
| `tests/e2e/a11y.spec.ts` | axe Playwright smoke (welcome + settings accessibility hub) |
| `tests/e2e/commands.spec.ts` | Command palette: open/close, search, fuzzy match, Enter-navigate |
| `tests/e2e/collaboration.spec.ts` | Collaboration panel security warning banner pre-connect |
| `services/commands/` | Command registry backing the palette (fuzzy search — regression-sensitive if E2E targets palette copy) |
| `hooks/useGlobalKeyboardShortcuts.ts` | Global shortcut listener — keep in sync with **Settings → Shortcuts** defaults |
| `stryker.conf.json` | Mutation testing targets + thresholds (`break: 75`, `high: 85`, `low: 70`; 40 mutate targets as of v1.19.0) |

---

## Commit messages

Conventional Commits are encouraged, for example: `feat:`, `fix:`, `docs:`, `ci:`, `test:`.
