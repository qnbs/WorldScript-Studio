# Session Handoff — Main CI red (coverage collapse) + deferred CodeAnt loop

_Created 2026-06-20. Read this first next session._

## ✅ RESOLVED 2026-06-20 — root cause was the undici override, fixed in commit `e2c73e93`

**Root cause:** the `undici: ">=7.28.0"` override resolved to **undici@8.5.0**. undici 8.x removed
`lib/handler/wrap-handler.js`, an internal file **jsdom@29.1.1** `require()`s
(`jsdom-dispatcher.js:8`; jsdom declares `undici ^7.25.0`). Every jsdom-environment test **worker failed
to start** with `MODULE_NOT_FOUND` → all `.tsx` tests collected "no tests" → coverage collapsed to ~5% →
Quality Gate failed the thresholds. Node-environment tests (idbCore, storageEncryptionService, proForge
stores) don't use jsdom, which is why only **coverage** — not a hard test failure — went red.

**Fix:** bound the override to `">=7.28.0 <8"` (commit `e2c73e93` on `main`). Still satisfies
GHSA-vmh5-mc38-953g (fixed 7.28.0) but keeps undici on the 7.x line that retains `wrap-handler.js`.
Lockfile now pins exactly one undici (7.28.0); `pnpm audit --audit-level=high` clean; `CommandPalette.test.tsx`
(jsdom) collects and passes again. **Lift the `<8` bound only when jsdom ships an undici-8-compatible release.**

The diagnostic narrative below is retained for the record.

---

## 🔴 (HISTORICAL) TOP PRIORITY — main CI is red and must go green before anything else

**Symptom:** On `main`, the **`CI / CD` → `🔍 Quality Gate`** job (both Node 22 and Node 24) fails on the
**coverage threshold**:

```
ERROR: Coverage for lines (5.16%) does not meet global threshold (74%)
ERROR: Coverage for functions (4.91%) ... (67%)
ERROR: Coverage for statements (5.02%) ... (72%)
ERROR: Coverage for branches (3.24%) ... (60%)
```

### What is NOT the problem (already ruled out)
- **Security Audit job = green.** The `pnpm-workspace.yaml` `overrides:` (undici ≥7.28.0, js-yaml ≥4.1.2,
  dompurify ≥3.4.11) are **active and working** — `pnpm audit --audit-level=high` passes in CI.
  - A pasted external analysis claimed the overrides were "in the wrong file / not active / should move to
    `package.json` / bump undici to 8.x". **That premise is wrong.** For a pnpm v10 **workspace**,
    `pnpm-workspace.yaml → overrides:` is the canonical location; moving them to `package.json "pnpm"` would
    be the regression. Do **not** follow that advice.
- **Not flaky.** Re-ran the failed jobs (`gh run rerun 27816011936 --failed`) → **failed again with
  identical numbers** (5.02/3.24/4.91/5.16). Deterministic.
- **Not the typecheck step.** tsgo passes on `main` (the proForgeMachine TS2352 errors below are only on the
  unmerged refactor branch, not main).

### The actual paradox (this is the key clue — start here)
- Commit **d4be86b7 = PASS** with **77.09%** coverage (healthy full suite).
- Next commit **7f925ea1 = FAIL** with **5.16%**.
- `git diff --stat d4be86b7 7f925ea1` = **one markdown file** (`docs/TAURI-NATIVE-DESKTOP-RUNBOOK.md`, +135).
  A docs-only change **cannot** change coverage → the cause is environmental/deterministic, not the commit.
- `git diff --stat 7f925ea1 b8e2dbbb` = `pnpm-workspace.yaml` + `pnpm-lock.yaml` (the security overrides),
  which also fails identically.

### What the 5% actually means (diagnosis so far)
- Coverage config is `all: true`, so a source file shows **>0%** only if a test **actually imported &
  executed** it. Every `.tsx` component shows **0%**; only **node-environment** unit tests contribute
  (idbCore 89%, storageEncryptionService 93%, proForgeMemoryBank 91%, proForgeHistoryStore 87%,
  applyReviewEdits 65%).
- ⇒ **The jsdom test files are not being collected/executed.** They are **not failing** (the job dies on the
  *threshold* check, not a test failure), they simply don't run.
- CI vitest command (from the Quality Gate job):
  `pnpm exec vitest run --coverage --reporter=json --outputFile=test-results.json --retry=2`
  The `--reporter=json` suppresses all stdout, so the per-file pass/fail detail is **only** in
  `test-results.json` (a CI artifact we have not yet inspected). The 5-min runtime + JSON-written line +
  threshold error are all we see in the raw log.

### Leading hypothesis to confirm next session
Something makes vitest **silently skip the jsdom-environment test files** in CI while still exiting through
the coverage-threshold path (i.e. not as a hard test failure). Candidates, in priority order:
1. **A global setup / `tests/setup.ts` / environment-resolution error** that makes every jsdom file fail
   *collection* and get dropped, while node-env files survive. Check whether a recent dep resolution (the
   `pnpm-lock.yaml` churn) changed `jsdom`/`happy-dom`/`@vitest/coverage-v8`/`vitest` versions.
2. **`--retry=2` + json reporter swallowing collection errors** — verify by reading `test-results.json` from
   CI (download the run's artifacts, or re-run a job and `cat` it before the threshold step).
3. **A test-file glob / environment comment regression** — but config is unchanged by the docs commit, so
   this is lower probability unless a dep changed vitest's default environment behavior.

### Concrete next steps (do these in order)
1. **Get the real per-file results:** add a temporary step (or local run) that prints the default reporter,
   NOT json — e.g. `pnpm exec vitest run --coverage=false 2>&1 | tail -120` — to see
   `Test Files X passed | Y failed/skipped` and any "Failed to collect" / environment errors. A local full
   run takes ~1 hour on this low-end box, so prefer: run a **single representative jsdom file** first
   (`pnpm exec vitest run tests/unit/CommandPalette.test.tsx`) — if it errors on env/import, that's the
   smoking gun in seconds.
2. **Compare dep versions** at d4be86b7 vs b8e2dbbb for: `vitest`, `@vitest/coverage-v8`, `jsdom`,
   `happy-dom`, anything the overrides touched transitively. `git show d4be86b7:pnpm-lock.yaml` vs current.
3. **Inspect `tests/setup.ts`** and `vitest.config.ts` `environment`/`environmentMatchGlobs`/`setupFiles`.
4. Once root cause is found: fix at the source (never lower the thresholds, never skip tests to go green),
   push to main, confirm full CI green.

### Useful refs
- Failing run: `gh run view 27816011936` (workflow "CI / CD", commit b8e2dbbb).
- Passing baseline: run `27721788508` (commit d4be86b7, Quality Gate "All files 77.09%").
- Thresholds live in `vitest.config.ts` (lines 74 / branches 60 / functions 67 / statements 72).

---

## 🟡 SECOND — unmerged refactor branch `refactor/proforge-xstate-machine` (PR #180)

**State:** my in-progress edits are **stashed**, not committed:
- `git stash list` → `stash@{0}: On refactor/proforge-xstate-machine: wip-proforge-180`
- Restore with `git stash pop` before resuming #180.

**The edits (3 CodeAnt fixes already applied in the stash):**
1. `incrementAttempt.retryFeedback` now folds the agent's `agentOutput.reflectionNotes` in with
   `lastDecision.reasons` (parity with proForgeOrchestrator).
2. New guard `isRollbackStageSelected` + `guard` on the `ROLLBACK` transition (reject rollback to a stage not
   in `selectedStages`).
3. `preparing` state now accepts `ABORT: 'aborting'`.
   Plus **3 new tests** in `tests/unit/proForgeMachine.test.ts` covering each.

**⚠️ BLOCKER on #180 — real typecheck failure (must fix before commit):**
`pnpm run typecheck` fails with **3× TS2352** at `features/proForge/machine/proForgeMachine.ts` lines
**68, 71, 75** (the pre-existing `setPreSnapshot`/`setResult`/`setDecision` actions):
```
Conversion of type 'ProForgeMachineEvent' to type '{ output: ... }' may be a mistake ...
Property 'output' is missing in type '{ type: "ABORT"; }' ...
```
Cause: these `assign` actions cast `event as { output: X }`, but the `ProForgeMachineEvent` union includes
`{ type: 'ABORT' }` (no `output`), so the direct cast no longer overlaps. **Fix:** cast through `unknown`
first — `(event as unknown as { output: X }).output` — for all three actions (this is a type cast, NOT a
biome-ignore, so it does not touch the suppression ratchet). Then re-run typecheck + the proForge test, lint:fix,
commit, push.

**After green:** reply + resolve + re-trigger #180's 3 CodeAnt threads:
- `PRRT_kwDOQOeAgc6KW_av` (comment 3431535926)
- `PRRT_kwDOQOeAgc6KW_az` (comment 3431535932)
- `PRRT_kwDOQOeAgc6KW_a0` (comment 3431535939)

> Note: do **not** push to #180 / run the CodeAnt loop until **main CI is green**, because every PR branch
> needs main merged in (for the security fix) and a red main poisons the comparison.

---

## 🟢 THIRD — the deferred combined CodeAnt loop (only after main is green)

Open PRs awaiting the **single combined CodeAnt correction loop** (procedure: `docs/CODEANT-REVIEW-LOOP.md`
and `docs/CODEANT-LOOP-RUNBOOK.md`):
- Architecture refactor: **#177, #178, #179, #180, #181, #182**
- Desktop UI/UX (D0–D4): **#183, #184, #185, #186, #187**
- Tauri native desktop (T0–T2): **#188, #189, #190**

For each: merge current main in (security fix), fetch unresolved `reviewThreads` (GraphQL), fix root-cause or
justify, reply + resolve, push, re-trigger `@codeant-ai review`, loop until **0 new comments AND 0
unresolved**. Never add a new `biome-ignore` (ratchet gate). Then merge when CI green + loop quiescent.

Known open threads at last check: #184(1), #185(1), #186(1), #187(1), #189(1), #180(3). #181/#182/#183/#188/#190
had 0 but still need a fresh review wave + merge-main.

---

## ⚪ FOURTH — deferred native-desktop work (after the CodeAnt loop)
T3–T7 from the Tauri plan are written up in `docs/TAURI-NATIVE-DESKTOP-RUNBOOK.md`
(notifications, updater modal, Pandoc UX + LoRA run-scoped abort, global shortcuts + Rust compute, theme sync +
Flow-Mode fullscreen + docs). Each = one PR off main, CodeAnt deferred.

## Environment reminders
- **ONE Bash call per turn** (low-end hardware ~3.7 GB RAM); no concurrent heavy shells. A full local
  coverage run ≈ 1 hour — prefer single-file runs for diagnosis.
- Co-Author commits with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Never lower coverage thresholds or `it.skip` to go green — fix the root cause.
