# CI Reference — WorldScript Studio

This document describes the **current** GitHub Actions pipeline (`/.github/workflows/ci.yml`) for WorldScript Studio: job graph, tooling, and how to approximate runs locally.

For historical optimization notes (targets may predate the live workflow), see [`.github/ACTIONS-OPTIMIZATIONS.md`](../.github/ACTIONS-OPTIMIZATIONS.md).

**Audit snapshot (inventory, risks, stabilization log):** [`.github/CI-AUDIT.md`](../.github/CI-AUDIT.md).

---

## Cloud CI-first vs local development

**Canonical quality gate:** GitHub Actions. Low-end local machines should **not** be expected to run the full heavy stack.

| Tier | Where | Commands / scope |
|------|--------|------------------|
| **Quick (local)** | Developer laptop | `pnpm run ci:prepush` (change-aware: single-checker typecheck and i18n/content-guard checks run only when the outgoing change classification requires them, see [`ci:prepush` change-aware routing](#ciprepush-change-aware-routing); release/doc truth and lightweight guardrails run unconditionally); the pre-commit hook runs staged Biome checks; optional targeted `pnpm exec vitest run <path>` for a fast smoke |
| **Heavy (CI)** | `ci.yml` | Vitest **with** `--coverage` and thresholds, Playwright E2E (`CI=true`) including **mobile emulation** (Pixel 5 / Chromium), Lighthouse CI, Storybook static build, bundle budget + analyze. Mutation testing (Stryker) is **not** part of this pipeline — see [Mutation testing status](#mutation-testing-status). |

**Merge readiness:** A green workflow run on the PR/branch matters more than reproducing every E2E or LHCI step locally. Use CI **artifacts** (Playwright HTML report, coverage, Lighthouse output) to debug failures.

**Local deep dive:** E2E, full-suite coverage, Lighthouse, and Storybook are CI-only on constrained hardware. For a focused local investigation, use `pnpm exec vitest run <path>` or `pnpm exec vitest run <path> --coverage`; never invoke `pnpm test`, `npm run test`, or a bare Vitest wrapper.

### First-attempt failures and flake quarantine

The required Vitest CI step intentionally runs without `--retry`: a first-attempt failure is
authoritative evidence and must not be converted into a green result by an automatic retry. A
suspected flake remains merge-blocking until reproduced or dispositioned. Do not add `skip`, `todo`,
or a retry merely to hide it.

Temporary quarantine is allowed only when all of the following are present: a dedicated issue with
the `flaky-test` label, the test's owner and reproduction evidence, an adjacent one-line
`QNBS-v3` comment naming the issue and an expiry date no more than 14 days away, and a visible CI
summary entry. The quarantine must be removed or renewed explicitly with new evidence; it is not a
permanent suppression mechanism. The normal observation period is ten successful first-attempt
CI runs for the affected test path before removing a temporary quarantine.

### Gate authority

`✅ CI Success` is the required branch-protection status and aggregates `workflow-policy`, `pr-size`,
`security`, `signatures`, `quality`, `changes`, `rust-tauri`, `core-rust`, `build`, `e2e`, `lighthouse`, and `vrt` (`pr-size`
only runs on `pull_request` events — legitimately skipped otherwise). `e2e-deep` and
`storybook` are explicitly advisory at job level while their stability criteria are measured. The
`deploy` job depends only on that aggregate and remains main-push-only.

`storybook` and `e2e-deep` are separately executed advisory jobs with explicit job-level
`continue-on-error: true`; their failures remain visible and must still be investigated before merge
under the repository's full-suite policy. Lighthouse is part of the required aggregate because its
mobile accessibility and CLS assertions are blocking; only its desktop performance step remains
non-blocking under the exit criteria documented below. The coverage ratchet remains informational.

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
| Bundle guardrails | **`pnpm run bundle:budget`** (entry/vendor/JS/WASM ceilings) + **`pnpm run analyze`** (rollup visualizer → `dist/bundle-analysis.html`, artifact in CI) |

---

## Composite setup action

`.github/actions/setup/action.yml` centralises pnpm + Node.js bootstrap into one reusable step used by every job:

```
pnpm/action-setup (explicit patched 11.22.0) → actions/setup-node (cache: pnpm) → toolchain check → pnpm install --frozen-lockfile
```

Each job that uses the composite must call `actions/checkout@v6` first (local composite actions are resolved from the workspace, so the repo must be checked out before `uses: ./.github/actions/setup` can be used). The `quality` job additionally passes `node-version: ${{ matrix.node-version }}` to cover the LTS matrix.

**`workflow-policy` deliberately does not use this composite.** It sets up pnpm/Node inline with the same external SHA-pinned actions instead, so a PR that tampers with `.github/actions/setup/action.yml` itself can't have that tampered content execute before `workflow-policy` evaluates it — see the job table above.

---

## Workflow triggers

- `push` to `main` and tags (`'*'`)
- `pull_request` to `main`
- `workflow_dispatch`

**Concurrency:** one run per workflow + branch/PR; `cancel-in-progress: true` **for PRs only** (main branch pushes are never cancelled — each push builds its own run so deploy history is clean).

---

## Job graph

```text
workflow-policy ─┬─► security ──► quality ──┬──► build ──┬──► lighthouse
                 │                          ├──► e2e     └──► vrt
                 └──► pr-size (pull_request  ├──► e2e-deep (advisory)
                      only)                  └──► storybook (advisory)

workflow-policy ─┐
pr-size (needs workflow-policy) ─┤ (pull_request only — skipped otherwise)
security ────────┤
signatures ──────┤
quality ─────────┼──► ci-success (required-status aggregator)
changes ─────────┤
rust ────────────┤
core-rust ───────┤
build ───────────┤
e2e ─────────────┤
lighthouse ──────┤
vrt ─────────────┘

build (main, non-PR) ──► upload-pages-artifact
ci-success (main, non-PR) ──► deploy ──► GitHub Pages
```

Mutation testing (Stryker) is **not** in this graph — it runs only via manual `workflow_dispatch` on [`mutation.yml`](../.github/workflows/mutation.yml). See [Mutation testing status](#mutation-testing-status).

The scheduled OSV workflow is intentionally separate from this graph so an unchanged `main` is
scanned daily without running the full CI matrix. The existing `security` job remains the
authoritative PR/main vulnerability gate; `pnpm audit` remains advisory because of its documented
registry gzip-decoding failure mode, while OSV failures remain blocking.

| Job | Needs | Purpose |
|-----|--------|---------|
| `workflow-policy` | — | Structural (real-parser, not regex) validation of every `.github/workflows/*.yml` and `.github/actions/**/action.yml` — permissions, needs graph, SHA-pinned action references, publishing boundary (`scripts/workflow-policy-check.mjs`). Runs first, before any job invokes the governed `./.github/actions/setup` composite, using only external SHA-pinned actions directly (never that composite) and an `--ignore-scripts --ignore-pnpmfile` install, so a PR tampering with the composite (or its own install hooks) can't execute before the gate evaluates it. |
| `pr-size` | `workflow-policy` | PR-size governance (`scripts/check-pr-size.mjs`) — tiered file/line/commit limits, advisory below the absolute ceiling and blocking only above it. `pull_request` only. Runs the **base ref's** own copy of the checker (never the PR's working-tree copy) when it exists there, so a PR touching it can't raise its own limits; falls back to the PR's own copy one time only, for the introducing PR whose base ref has no checker yet. |
| `security` | `workflow-policy` | `pnpm audit --audit-level=high`; **OSV scanner** (`google/osv-scanner-action`) for npm + Rust lockfiles; `gitleaks` secrets scan; on PRs: `dependency-review-action` |
| `scheduled-osv` | — | Separate daily and manually triggerable (`workflow_dispatch`) `.github/workflows/security-scheduled.yml` scan of the same three lockfiles; `contents: read` only; fails closed and writes lockfile/package/advisory details to the step summary |
| `quality` | `security` | Matrix **Node 22** and **24** → Biome lint, **`pnpm run i18n:check`**, **`pnpm run docs:check`**, **`pnpm run csp:verify`**, **`pnpm run parity:check`**, `pnpm run typecheck`, Vitest + coverage (+ non-blocking coverage-ratchet suggestion), Codecov (optional token), coverage artifact |
| `rust-tauri` | `security` | Rust `cargo fmt --check`, `cargo check --locked`, `cargo clippy --locked --all-targets -- -D warnings`, and `cargo test --locked`; compile/lint signal for Tauri changes without building installers on every PR |
| `build` | `quality` | Production `pnpm run build`, **`bundle:budget`**, **`analyze`** (upload `bundle-analysis.html`), **`pnpm run smoke:prod`** (headless-Chromium prod-build + CSP-runtime gate — see below), `dist` artifact; on `main` (non-PR): Pages artifact + **SLSA build provenance attestation**. No `if:` on the job itself — `smoke:prod` runs on every PR, not just `main` pushes. |
| `e2e` | `quality` | Playwright **Chromium** + **Mobile Chrome** (Pixel 5) — `CI=true`, 2× retries, 50 min timeout; browser cache via `actions/cache@v5`. Firefox optional locally. `PLAYWRIGHT_SKIP_VRT=true` (VRT is its own job). |
| `lighthouse` | `build` | LHCI (mobile): **accessibility error gate** `minScore: 0.95`; **CLS error** ≤ 0.1; performance/SEO warn. Desktop run: `continue-on-error: true` until baselines stabilise. Timeout 25 min. |
| `storybook` | `quality` | Cloud-first — Storybook build + test-runner only run in CI (not locally); Playwright browser cache `v5`; `--maxWorkers=2 --junit` (non-blocking, `continue-on-error: true` — see [exit criteria](#non-blocking-gates--exit-criteria-f-13)); artifacts uploaded always. Debug: manual `storybook-debug.yml` workflow. |
| `vrt` | `build` | Visual regression against production `dist`; `toHaveScreenshot()` with committed PNG baselines (4 views × Chromium); artifacts uploaded always |
| `signatures` | `security` | Read-only GitHub API verification of every commit in the complete introduced range; pull-request commit pagination; and annotated release-tag plus target-commit verification. |
| `ci-success` | `workflow-policy`, `pr-size`, `security`, `signatures`, `quality`, `changes`, `rust-tauri`, `core-rust`, `build`, `e2e`, `lighthouse`, `vrt` | Required-status **aggregator** — `if: always()`, fails if any required release-safety job does not resolve to `success`; signature verification is authoritative; Storybook and deep-E2E are explicitly advisory. Rust jobs are legitimately skipped when their paths are untouched; `pr-size` is legitimately skipped only on non-`pull_request` events. |
| `deploy` | `ci-success` | **Only** `main` push (not PR), and only after the aggregate gate succeeds; the Pages artifact is resolved from the same workflow run. |

> **Desktop:** On-demand / tag-driven Tauri bundles live in [`tauri-build.yml`](../.github/workflows/tauri-build.yml); **`v*` tags** additionally publish installers on a **GitHub Release**. See [`docs/TAURI-CI.md`](TAURI-CI.md). Desktop CI does not block the web deploy graph above.
>
> **Maintainer follow-up (not done here):** switching branch protection's required-checks list from the
> 4 individual contexts to just `ci-success` is a branch-protection settings change — out of scope for
> an automated PR. Do it manually once `ci-success` has run green on `main` at least once: repo
> Settings → Branches → `main` → Required status checks → remove the 4 individual entries, add
> `✅ CI Success`.

### Release-truth checks

`pnpm run docs:check` treats the latest available stable tag as the release frontier. A dated
Keep-a-Changelog heading at or beyond that frontier must have its matching tag; a package version
behind the frontier fails, while a newer development version requires an `[Unreleased]` section;
when post-release commits exist, that section must contain meaningful history. README badges may use an explicit `Next`/`unreleased` development label,
but a released-version badge must resolve to an existing tag. Historical headings below the
frontier remain valid when old tags are no longer present.

The gate intentionally skips version-based assertions when no tags are available, because a
tagless or shallow checkout cannot establish a release frontier. CI uses `fetch-tags: true` so the
authoritative quality job does not silently lose this evidence. Release tags must be created only
after the release-truth PR is merged and the exact target SHA has passed the release prerequisites.

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
| Storybook `test-storybook` (`storybook` job, `continue-on-error: true`) | Fixed 2026-07-29 (F-12): the invocation was calling flags this test-runner version doesn't support (`--max-workers`/`--retries`/`--screenshot-on-failure`), so it failed on argument parsing before running a single story, on every prior run. This is the first run where it will actually execute real stories/a11y checks — no track record exists yet. Moved from `\|\| true` to job-level `continue-on-error: true` the same day (CodeRabbit-caught): `\|\| true` swallowed the exit code so the step showed green even while genuinely failing — the exact mechanism that let the F-12 bug go unnoticed. | Re-evaluate after **~10 real (non-argument-error) runs on `main`**; drop `continue-on-error` and make blocking if none fail on a genuine story/a11y assertion. |
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
the mutation score is **not continuously tracked**; it is a point-in-time snapshot whenever someone
runs it manually. [`stryker.config.mjs`](../stryker.config.mjs) consumes the single authoritative
scope in [`stryker-scope.json`](../stryker-scope.json): 25 production targets across 8 modules.
Each module is marked Tier A (pure/domain/policy logic) or Tier B (bounded adapter/orchestration
logic), and the workflow accepts `all`, `tier-a`, or one module name for a bounded diagnostic run.

Incremental runs pass Stryker's supported `--incrementalFile` option and cache one file per module;
the cache is not inferred from an arbitrary environment variable. `force` removes the selected
module cache before running, so it is the explicit no-cache mode for release, security, and major
refactor audits. Reports are uploaded under unique `stryker-report-<module>` artifact directories;
the aggregate job derives metrics from real mutant statuses under `files`, keeps the summary visible
when a shard fails, and fails loudly on any missing, malformed, or incomplete expected report. The
summary keeps killed, survived, timeout, no-coverage, ignored, pending, and error counts visible
instead of treating timeout/no-coverage as equivalent evidence. `vitest.related: true` is enabled
so each mutant uses related tests instead of rerunning the full suite.

The current operational thresholds are `break: 75`, `high: 85`, and `low: 70`. They are preserved
until a trusted force run establishes measured module/global baselines; they must not be changed to
make a run green. The installed TypeScript checker is intentionally not used: Stryker's Vitest
runner and the repository's tsgo gate provide the supported compile/type signal, while enabling the
unused checker would add cost without an accepted compatibility baseline.

**Re-integration criterion:** bring it back into the `quality` job (or a separate required check)
once a manual run demonstrates the flakiness is resolved — concretely, three consecutive manual
`workflow_dispatch` runs on `main` completing without a spurious failure or timeout, at the current
25-target mutate scope. Until then, treat a manual run's score as informational only, not a gate.

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
| **pnpm v11 build-script policy** | Dependency installation | `pnpm-workspace.yaml` uses the sole supported, default-deny `allowBuilds` map; legacy build-script lists are intentionally absent |
| **Branch protection** | Always | `main` requires 1 approved review, required status checks including the `CI Success` aggregator, no force-push |

Only the two reviewed native packages marked `true` in `allowBuilds` (`@swc/core` and `esbuild`)
may run dependency lifecycle scripts. `@google/genai`, `core-js`, `onnxruntime-node`, `protobufjs`,
`sharp`, `simple-git-hooks`, `unrs-resolver`, and `workerd` are explicitly denied. Git-hook
installation is deliberately opt-in through `pnpm run hooks:install`; dependency installation no
longer runs a root `prepare` command. `pnpm-workspace.yaml` sets `verifyDepsBeforeRun: error`, so
`pnpm run`/`pnpm exec` aborts when dependencies are stale instead of implicitly running install.

---

## Permissions

- Global default: `contents: read`
- `security` job (PR dependency review): additional `pull-requests: read` so `dependency-review-action` can read changed manifests.
- `build` job (main, non-PR): `attestations: write` + `id-token: write` for SLSA provenance signing.
- `deploy` job: `pages: write`, `id-token: write` (OIDC for Pages)

**Upload artifacts:** Coverage, Playwright, and Lighthouse reports use `if-no-files-found: warn`, so missing folders after aborts do not turn the workflow additionally red — logs of the failing steps remain the source of truth.

---

## Local checks (without Act)

On **low-resource** machines, stop at the **Quick** tier (see [Cloud CI-first vs local development](#cloud-ci-first-vs-local-development)): **`pnpm run ci:prepush`**, and optionally targeted **`pnpm exec vitest run <path>`**. Never run multiple heavyweight local processes concurrently. Treat **`CI=true pnpm run test:e2e`** (desktop + mobile projects in CI), **Lighthouse**, coverage, Storybook, and mutation testing as **CI-owned**.

```bash
node scripts/dependency-state.mjs reconcile
pnpm run deps:verify
pnpm run ci:prepush
pnpm exec vitest run <path>  # optional targeted smoke, no coverage
```

Playwright E2E, Lighthouse, Storybook, and full-suite coverage are intentionally omitted from
the local block above; GitHub Actions owns those heavy checks on this hardware.

### `ci:prepush` change-aware routing

`pnpm run ci:prepush` always resolves a change classification from the outgoing evidence first
(`scripts/ci-prepush-classifier.mjs`), then runs docs/release-truth, CSP, desktop-import boundary,
native-readiness, and dependency-state checks unconditionally on every invocation. It does **not**
run Biome lint — full-repository lint stays CI-owned (`quality` job); only staged files are linted
locally, by the separate pre-commit hook (`lint-staged`). Two check groups are conditional on the
change classification instead of always running:

- **TypeScript (single-checker)** — skipped, reporting `DEFERRED_TO_REQUIRED_CI`, when the
  classification is `DOCS_ONLY`, `WORKFLOW_ONLY`, `NON_CODE_ONLY`, `RUST_TAURI`, `TOOLING`, or
  non-TypeScript `TEST_ONLY`. Runs for every other classification, including `AMBIGUOUS`/`MIXED`.
- **i18n (key parity, bundle rebuild, translation quality) and content-guard** — run only when the
  changed files match their own governed paths or implementation files
  (`scripts/ci-prepush-check-registry.mjs`), independent of the TypeScript decision above.

**Fail-closed by design:** whenever outgoing path evidence is incomplete — the manual committed
range can't be resolved, a Git diff command fails, or pre-push-hook evidence reports partial path
completeness (e.g. a tag-only push) — the gate does not defer anything; it falls back to running
every check, matching a `--full` invocation. Deferring a check locally never changes what required
GitHub CI validates: the complete lint, TypeScript, and i18n checks always run in CI regardless of
what the local gate ran or deferred, and CI remains the merge authority.

On standard hardware, or when debugging a build-affecting change, run the build-specific checks
separately; CI remains authoritative for the complete build and artifact checks:

```bash
pnpm run build
pnpm run bundle:budget
pnpm run analyze
```

### Node 24+ Compatibility Troubleshooting

**Problem:** Tests fail with `localStorage.clear is not a function` or similar Web Storage errors on Node 24+.

**Root Cause:** Node.js ab v24.0.0 stellt eine native (aber unvollständige) Web Storage API bereit. Diese überschreibt jsdoms korrekte Implementierung und führt zu fehlenden Methoden wie `.clear()`.

**Solution:** Die `tests/setup.ts` setzt `localStorage` und `sessionStorage` mit vollständigen Mocks. Zusätzlich wird in CI der Vitest-Befehl mit `--no-experimental-webstorage` ausgeführt, um die native Node-Implementierung vollständig zu deaktivieren.

**Local debugging:**

```bash
# Simuliere CI-Bedingungen exakt
NODE_OPTIONS="--no-experimental-webstorage" pnpm exec vitest run <path> --coverage

# Ohne Coverage für schnelles Feedback
pnpm exec vitest run <path>
```

**Coverage Ratchet Mechanism:**

Thresholds in `vitest.config.ts` sind ~1pt unter den CI-gemessenen Werten, um Node 22/24 Varianz zu absorbieren. Nach 3 grünen CI-Läufen auf beiden Node-Versionen kann der Threshold um 1pt erhöht werden (max 5pt pro Quartal).

---

## Local CI/CD on low-end hardware (act + Forgejo)

For **Ubuntu 20.04 / 2–4 GB RAM** laptops: run the **Quick tier** natively (no Docker) and use **[act](https://github.com/nektos/act)** + optional **Forgejo** as a GitHub backup — not a second pipeline language.

| Tier | Command | When |
|------|---------|------|
| **Quick (daily)** | `pnpm run ci:quick`; optional targeted `VITEST_PATH=tests/unit/example.test.ts pnpm run ci:quick:unit` | Every commit |
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
| `stryker.config.mjs` / `stryker-scope.json` | Curated 25-file mutation scope across 8 risk-tiered modules; current thresholds are `break: 75`, `high: 85`, `low: 70` |

---

## Commit messages

Conventional Commits are encouraged, for example: `feat:`, `fix:`, `docs:`, `ci:`, `test:`.
