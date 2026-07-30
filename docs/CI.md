# CI Reference — WorldScript Studio

This document describes the **current** GitHub Actions pipeline (`/.github/workflows/ci.yml`) for WorldScript Studio: job graph, tooling, and how to approximate runs locally.

For historical optimization notes (targets may predate the live workflow), see [`.github/ACTIONS-OPTIMIZATIONS.md`](../.github/ACTIONS-OPTIMIZATIONS.md).

**Audit snapshot (inventory, risks, stabilization log):** [`.github/CI-AUDIT.md`](../.github/CI-AUDIT.md).

---

## Cloud CI-first vs local development

**Canonical quality gate:** GitHub Actions. Low-end local machines should **not** be expected to run the full heavy stack.

| Tier | Where | Commands / scope |
|------|--------|------------------|
| **Quick (local)** | Developer laptop | `pnpm run lint`, `pnpm run typecheck`, `pnpm run i18n:check`; optional `pnpm exec vitest run` **without** `--coverage` for a fast smoke |
| **Heavy (CI)** | `ci.yml` | Vitest **with** `--coverage` and thresholds, Playwright E2E (`CI=true`) including **mobile emulation** (Pixel 5 / Chromium), Lighthouse CI, Storybook static build, bundle budget + analyze. Mutation testing (Stryker) is **not** part of this pipeline — see [Mutation testing status](#mutation-testing-status). |

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
| Package manager | **pnpm** 11.x ([`package.json`](../package.json) `packageManager`) |
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
                       └──► storybook

security ─┬
quality ──┼──► ci-success (required-status aggregator)
build ────┘

build (main, non-PR) ──► upload-pages-artifact
deploy (main, non-PR) needs: build + e2e ──► GitHub Pages
```

Mutation testing (Stryker) is **not** in this graph — it runs only via manual `workflow_dispatch` on [`mutation.yml`](../.github/workflows/mutation.yml). See [Mutation testing status](#mutation-testing-status).

| Job | Needs | Purpose |
|-----|--------|---------|
| `security` | — | `pnpm audit --audit-level=high`; **OSV scanner** (`google/osv-scanner-action`) for npm + Rust lockfiles; `gitleaks` secrets scan; on PRs: `dependency-review-action` |
| `quality` | `security` | Matrix **Node 22** and **24** → Biome lint, **`pnpm run i18n:check`**, **`pnpm run docs:check`**, **`pnpm run parity:check`**, `pnpm run typecheck`, Vitest + coverage (+ non-blocking coverage-ratchet suggestion), Codecov (optional token), coverage artifact |
| `build` | `quality` | Production `pnpm run build`, **`bundle:budget`**, **`analyze`** (upload `bundle-analysis.html`), **`pnpm run smoke:prod`** (headless-Chromium prod-build + CSP-runtime gate — see below), `dist` artifact; on `main` (non-PR): Pages artifact + **SLSA build provenance attestation**. No `if:` on the job itself — `smoke:prod` runs on every PR, not just `main` pushes. |
| `e2e` | `quality` | Playwright **Chromium** + **Mobile Chrome** (Pixel 5) — `CI=true`, 2× retries, 50 min timeout; browser cache via `actions/cache@v5`. Firefox optional locally. `PLAYWRIGHT_SKIP_VRT=true` (VRT is its own job). |
| `lighthouse` | `build` | LHCI (mobile): **accessibility error gate** `minScore: 0.95`; **CLS error** ≤ 0.1; performance/SEO warn. Desktop run: `continue-on-error: true` until baselines stabilise. Timeout 25 min. |
| `storybook` | `quality` | Cloud-first — Storybook build + test-runner only run in CI (not locally); Playwright browser cache `v5`; `--maxWorkers=2 --junit` (non-blocking, `continue-on-error: true` — see [exit criteria](#non-blocking-gates--exit-criteria-f-13)); artifacts uploaded always. Debug: manual `storybook-debug.yml` workflow. |
| `vrt` | `build` | Visual regression against production `dist`; `toHaveScreenshot()` with committed PNG baselines (4 views × Chromium); artifacts uploaded always |
| `ci-success` | `security`, `quality`, `build` | Required-status **aggregator** — `if: always()`, fails if any of its three `needs` didn't resolve to `success` (a matrix job like `quality` only reports `success` once every Node 22/24 leg passes). Exists so branch protection can require **one** context instead of enumerating `security`/`quality (Node 22)`/`quality (Node 24)`/`build` by name; a future required job just joins this job's `needs` list, with no branch-protection settings edit needed. |
| `deploy` | `build`, `e2e` | **Only** `main` push (not PR): `deploy-pages` |

> **Desktop:** On-demand / tag-driven Tauri bundles live in [`tauri-build.yml`](../.github/workflows/tauri-build.yml); **`v*` tags** additionally publish installers on a **GitHub Release**. See [`docs/TAURI-CI.md`](TAURI-CI.md). Desktop CI does not block the web deploy graph above.

> **Maintainer follow-up (not done here):** switching branch protection's required-checks list from the
> 4 individual contexts to just `ci-success` is a branch-protection settings change — out of scope for
> an automated PR. Do it manually once `ci-success` has run green on `main` at least once: repo
> Settings → Branches → `main` → Required status checks → remove the 4 individual entries, add
> `✅ CI Success`.

---

## CSP gates — which layer catches which failure class

**Post-mortem (2026-07-29):** `script-src` shipped without `'wasm-unsafe-eval'` for two months
(2026-05-27 → 2026-07-29, `faad8f0`), blocking `WebAssembly.instantiate` in every deployed
Chromium browser — the entire advertised local-inference stack (WebLLM, ONNX Runtime Web,
Transformers.js, DuckDB-WASM, Whisper-STT, Kokoro-TTS) never functioned in production. **A green
CI run never once caught it.** The reason is a gate-design gap, not a gate that was skipped or
disabled: the only CSP test that existed (Layer A below) checks a different property than the one
that broke. See [ADR-0013](adr/0013-csp-wasm-and-blob-frames.md) for the full incident record.

**Layer A alone was never sufficient, and never will be**, for anything shaped like this defect —
that's the standing lesson, not a one-time fix:

| Layer | Where | Checks | What it CANNOT catch |
|-------|-------|--------|-----------------------|
| **A — Consistency** | `tests/unit/csp.test.ts`, `tests/unit/deploymentHeaders.test.ts` | Cross-surface consistency — the 5 CSP surfaces agree with each other (identical strings / no header looser than the meta tag) | Whether the *agreed-upon* policy is itself correct — 5 identically-broken CSPs pass Layer A with a clean bill of health |
| **B — Correctness** | `tests/unit/cspCorrectness.test.ts` | Specific directives contain the tokens a shipped feature actually needs (`'wasm-unsafe-eval'`, `frame-src blob:`, …), forbidden tokens are absent (`'unsafe-eval'`, `'unsafe-inline'` in `script-src`), and every inline `<script>` without a `src` has a matching hash | Whether the browser *actually enforces* the policy the way the static text implies — no real browser is involved |
| **C — Runtime** | `scripts/smoke-prod-build.mjs` (`build` job, every PR) | Real headless-Chromium load of the production `dist/`: `securitypolicyviolation` DOM events, console block/refusal messages, a live `WebAssembly.instantiate` probe | Tauri's WebView-specific CSP enforcement — Playwright drives Chromium, not the Tauri WebView (see Tauri gap below) |

A commit shaped like `faad8f0` today — `script-src 'self'` plus an unhashed inline `<script>`,
while the app ships WASM-based features — now fails at **all three** independently: Layer B flags
the missing `'wasm-unsafe-eval'` and the unhashed inline script; Layer C's WASM probe reports
`BLOCKED` and its violation listeners report the inline-script refusal. Losing any one layer would
still leave two others standing — that's the point of stacking these, not relying on one.

**Tauri CSP gap (accepted, documented, not a Layer-C blind spot in practice):** Tauri's
`src-tauri/tauri.conf.json` CSP has Layer A and Layer B coverage (both test files assert the
Tauri surface too), but no Layer-C *runtime* probe — Playwright drives real Chromium via
`vite preview`, not the Tauri WebView, so a Tauri-specific enforcement quirk (a different Chromium
build embedded in the OS WebView, or a platform-specific CSP parsing difference) would only be
caught by Layer B's static assertions, not an actual WebView load. Building a full Tauri WebView
headless-runtime harness was judged disproportionate to the risk for this sprint — the Tauri CSP is
the strictest of the 5 surfaces (no `https:` blanket, explicit `connect-src` allowlist), so a
missed enforcement quirk there is more likely to be *overly strict* (breaking a real feature, which
manual/E2E Tauri testing would surface) than *under-enforcing* (a security gap). Revisit if a
Tauri-specific CSP bug ever ships past Layer A/B undetected.

---

## Non-blocking gates — exit criteria (F-13)

A non-blocking gate without a stated exit criterion is permanent, silent debt — it looks like
progress-in-motion but nothing ever forces a revisit. Every `continue-on-error: true` / `|| true`
in `ci.yml` is listed here with why it isn't blocking today and what has to be true before it is:

| Gate | Why not blocking today | Exit criterion |
|------|------------------------|-----------------|
| Storybook `test-storybook` (`storybook` job, `continue-on-error: true`) | Fixed 2026-07-29 (F-12): the invocation was calling flags this test-runner version doesn't support (`--max-workers`/`--retries`/`--screenshot-on-failure`), so it failed on argument parsing before running a single story, on every prior run. This is the first run where it will actually execute real stories/a11y checks — no track record exists yet. Moved from `\|\| true` to step-level `continue-on-error: true` the same day (CodeRabbit-caught): `\|\| true` swallowed the exit code so the step showed green even while genuinely failing — the exact mechanism that let the F-12 bug go unnoticed. | Re-evaluate after **~10 real (non-argument-error) runs on `main`**; drop `continue-on-error` and make blocking if none fail on a genuine story/a11y assertion. |
| `e2e-deep` (feature-flag matrix job, `continue-on-error: true`) | Deliberately informational by design — parametrizes across the full `testConfigurations` flag matrix (`tests/e2e/config/test-matrix.ts`) specifically to surface flag-interaction regressions that the required `e2e` gate's default-flag-state run cannot see; failures here are diagnostic signal, not necessarily a merge-blocking defect in the default configuration. | Promote a **specific flag combination** to blocking (add it to the required `e2e` spec instead) once it has been stable for **3 consecutive weeks of `main` runs** — do not flip the entire matrix job blocking at once, since that reintroduces the flakiness-cascade risk `e2e-deep` was created to avoid. |
| Lighthouse **Desktop** step (`lighthouse` job, `continue-on-error: true`) — note: accessibility (`minScore: 0.95`) and CLS (`≤ 0.1`) stay **error**-level gates even on this step; only the broader desktop performance/SEO scores are non-blocking | Desktop performance baselines haven't been formally re-verified as stable since the last CI-runner change | Re-run `pnpm exec lhci autorun --config=.lighthouserc.desktop.cjs` locally or via `storybook-debug.yml`-style manual dispatch across **5 consecutive `main` runs**; if performance/SEO scores stay within the existing `warn` thresholds each time, remove `continue-on-error` for the step. |
| Coverage ratchet (`scripts/check-coverage-ratchet.mjs`, `continue-on-error: true`) | **Deliberately, permanently advisory** — by design (see `vitest.config.ts`'s ratchet-history comment), it exists to *suggest* the next threshold bump, not to gate a merge on hitting one. | None — this is the one gate above intentionally without an exit criterion; its purpose is met by staying advisory. Reviewed here for completeness so it isn't mistaken for forgotten debt. |

---

## Mutation testing status

Stryker was removed from the `quality` job on **2026-06-02** — it ran as a flaky, non-gating check
that added noise to every PR without blocking anything (see the `QNBS-v3` comment above the `build`
job in [`ci.yml`](../.github/workflows/ci.yml)). It now runs **only** via manual trigger:

```bash
gh workflow run mutation.yml
```

`mutation.yml` is `workflow_dispatch`-only — it never runs automatically on push or PR. This means
the mutation score is **not continuously tracked**; it's a point-in-time snapshot whenever someone
runs it manually. [`stryker.conf.json`](../stryker.conf.json) still defines the thresholds
(`break: 75`, `high: 85`, `low: 70`) that would apply if it ran.

**Re-integration criterion:** bring it back into the `quality` job (or a separate required check)
once a manual run demonstrates the flakiness is resolved — concretely, three consecutive manual
`workflow_dispatch` runs on `main` completing without a spurious failure or timeout, at the current
40-target mutate scope. Until then, treat a manual run's score as informational only, not a gate.

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

### Node 24+ Compatibility Troubleshooting

**Problem:** Tests fail with `localStorage.clear is not a function` or similar Web Storage errors on Node 24+.

**Root Cause:** Node.js ab v24.0.0 stellt eine native (aber unvollständige) Web Storage API bereit. Diese überschreibt jsdoms korrekte Implementierung und führt zu fehlenden Methoden wie `.clear()`.

**Solution:** Die `tests/setup.ts` setzt `localStorage` und `sessionStorage` mit vollständigen Mocks. Zusätzlich wird in CI der Vitest-Befehl mit `--no-experimental-webstorage` ausgeführt, um die native Node-Implementierung vollständig zu deaktivieren.

**Local debugging:**

```bash
# Simuliere CI-Bedingungen exakt
NODE_OPTIONS="--no-experimental-webstorage" pnpm exec vitest run --coverage --reporter=json --outputFile=test-results.json

# Ohne Coverage für schnelles Feedback
pnpm exec vitest run
```

**Coverage Ratchet Mechanism:**

Thresholds in `vitest.config.ts` sind ~1pt unter den CI-gemessenen Werten, um Node 22/24 Varianz zu absorbieren. Nach 3 grünen CI-Läufen auf beiden Node-Versionen kann der Threshold um 1pt erhöht werden (max 5pt pro Quartal).

---

## Local CI/CD on low-end hardware (act + Forgejo)

For **Ubuntu 20.04 / 2–4 GB RAM** laptops: run the **Quick tier** natively (no Docker) and use **[act](https://github.com/nektos/act)** + optional **Forgejo** as a GitHub backup — not a second pipeline language.

| Tier | Command | When |
|------|---------|------|
| **Quick (daily)** | `pnpm run ci:quick` / `ci:quick:unit` | Every commit |
| **Full workflow (on-demand)** | `pnpm run ci:act` | Before release / weekly |
| **Eco Git** | `infra/low-end-ci/scripts/ci-eco-start.sh` | Only when pushing to local Forgejo |

**Full setup:** [`infra/low-end-ci/INSTALL.md`](../infra/low-end-ci/INSTALL.md) · **Daily checklist:** [`infra/low-end-ci/DAILY-DRIVER.md`](../infra/low-end-ci/DAILY-DRIVER.md)

Baseline hardware eval: `infra/low-end-ci/eval-template.sh` → `~/worldscript-ci/eval-*.txt`

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
