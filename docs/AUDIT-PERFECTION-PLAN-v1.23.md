# StoryCraft Studio — Audit / Correction / Perfection Plan (v1.23 cycle)

> **Living master artifact** for the "Master Orchestration Prompt v1.1" engagement.
> Single tracked home for the 6-phase audit toward v1.23. Updated per batch.
> Engagement model: **one PR per phase, stacked**; CodeAnt re-reviews each push and all
> inline comments are cleared (0 unresolved) before a phase is declared done.

**Owner:** maintainer + Claude Code · **Started:** 2026-06-13 · **Baseline version:** 1.22.0

---

## 1. Corrected baseline (verified against live `main`, 2026-06-13)

An earlier prompt revision (v1.0) carried a **stale** gap list. Fresh inspection confirms
the following are already shipped — do **not** re-plan them as gaps:

| Area | Status | Evidence |
|---|---|---|
| ROADMAP/TODO/AUDIT consistency | ✅ reconciled | PR #118 (`e8252b6`, `6b3340d`) |
| v1.22 Smoke-Test protocol | ✅ exists | `docs/V1.22-SMOKE-TEST.md` (7 sections) |
| Error Boundaries | ✅ all 19+ views | `App.tsx` + `components/ui/ViewErrorBoundary.tsx` |
| Plugin worker isolation | ✅ delivered + tested | `workers/plugin.worker.ts`, `services/pluginRegistry.ts`, 5 test files |
| Dependency audit (high + moderate) | ✅ 0 vulnerabilities | `pnpm audit` 2026-06-13; `AUDIT.md` overrides table |

---

## 2. Phase roadmap & status

| Phase | Theme | Status |
|---|---|---|
| **0** | v1.23 foundation: tracker sync, dependency hygiene, plugin sandbox validation | ✅ **Merged** (PR #118 → `8f94178`) |
| **1** | Reliability/Observability + Local-AI/Voice low-end hardening | 🔄 **In progress** (Batch 1.1) |
| 2 | Coverage elevation (L≥85 / B≥75 / F≥80) in AI routing, Copilot v2, Voice, collab, PlotBoard | ⬜ Planned |
| 3 | Tauri desktop: signing / notarization / updater pipeline + UX | ⬜ Planned |
| 4 | WCAG 2.2 AA manual audit + i18n sustainability (<2% placeholders) | ⬜ Planned |
| 5 | Performance / bundle / state-model clarity / ProForge isolation | ⬜ Planned |
| 6 | Docs, ADRs, release checklist, onboarding | ⬜ Planned |

Each phase opens its own PR off `main` with an approved plan before execution.

---

## 3. Batch log

### Batch 0.1 — Tracker reconciliation (PR #118, `e8252b6`+`6b3340d`)
ROADMAP/TODO/AUDIT brought into agreement; AUDIT Known Overrides table refreshed
(esbuild row added, placeholder CVE refs replaced with verified advisory IDs);
dependency audit re-verified 0 high/moderate. CHANGELOG `[1.22.0]` heading restored after
a CodeAnt-caught regression.

### Batch 0.2 — Plugin sandbox adversarial validation (PR #118)
- `tests/unit/workers/plugin.worker.test.ts`: +5 adversarial tests — **WebAssembly**
  denial, **GeneratorFunction** + **AsyncGeneratorFunction** constructor-escape blocked,
  and `self.*` guard **restoration** on both success and error paths.
- Verified `tests/unit/pluginRegistry.test.ts` already covers storage-key validation
  (prefix / length / `..` traversal / path separators / empty suffix) **and** the 2 MiB
  value-size cap — no new registry tests needed.

### Batch 1.1 — AI error taxonomy + fail-fast retry (Phase 1)
- New `services/ai/aiErrorTaxonomy.ts` — pure `classifyAiError(err)` →
  `{category, retryable, messageKey}` over transient/rateLimit/auth/network/offline/policy/
  invalidRequest/canceled/permanent (reuses the `aiPolicy.ts` "blocked" markers + HTTP status;
  `AbortError` cancellations fail fast — CodeAnt-flagged).
- `services/ai/aiRetry.ts` `withTransientRetry` now **fails fast** on non-retryable errors
  (auth/policy/invalid-request/offline) via a `shouldRetry` default, and emits a structured
  `createLogger('ai.retry')` line per decision with a per-call correlation id. Backward
  compatible (unknown errors still retry). +33 tests (`aiErrorTaxonomy.test.ts` table-driven,
  fail-fast cases in `aiRetry.test.ts`).
- **i18n / UI mapping of `messageKey` deferred to Batch 1.2** (avoids 11-locale churn here).
- **FU-1 split out of this batch** (fixed separately — see batch log).

### Batch FU-1 — plugin-worker guard-restoration fix
- **Root cause (confirmed by probe):** `installRuntimeGuards` reassigns the global
  `self.Function = denied`, so `restoreRuntimeGuards`'s free `Function.prototype.constructor`
  reference resolved to **`denied.prototype`** (the stub), patching the wrong object and leaving
  the real `Function.prototype.constructor` denied. `self.*` restored fine because they use
  explicit `self.X =` assignments; the async/generator paths use module-captured consts, so only
  the bare `Function` identifier was poisoned.
- **Fix:** use the module-captured `GlobalFunction` (native, never reassigned) for the three
  `Function.prototype.constructor` touch-points (snapshot capture, install, restore). One-file
  change in `workers/plugin.worker.ts`; isolation unchanged (denied stays active during runs).
- **Tests:** re-enabled the `Function.prototype.constructor` round-trip assertions (success +
  error path) and added a **cross-run** isolation test in `plugin.worker.test.ts` (24 green).

---

## 4. Decisions & follow-ups

- **FU-1 — ✅ RESOLVED** (see Batch FU-1 above). The guard-restoration leak was a poisoned
  global-binding bug, not a property-attribute issue; fixed by routing the three
  `Function.prototype.constructor` touch-points through the captured `GlobalFunction`.

---

## 5. References
- Engagement prompt: Master Orchestration Prompt v1.1 (corrected baseline).
- `ROADMAP.md` (v1.23 section), `TODO.md` (P0 block), `AUDIT.md` (overrides + security),
  `CHANGELOG.md` (`[Unreleased]`).
- Plugin sandbox: `docs/PLUGINS-BETA.md`, `services/pluginRegistry.ts`,
  `workers/plugin.worker.ts`.
