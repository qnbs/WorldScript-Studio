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
| **0** | v1.23 foundation: tracker sync, dependency hygiene, plugin sandbox validation | ✅ **Closing** (PR #118) |
| 1 | Reliability/Observability + Local-AI/Voice low-end hardening | ⬜ Planned |
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

---

## 4. Decisions & follow-ups

- **FU-1 (Phase 1 candidate, low impact):** `workers/plugin.worker.ts`
  `restoreRuntimeGuards` restores the `self.Function/eval/WebAssembly` bindings correctly,
  but `Function.prototype.constructor` does **not** round-trip to its pre-call value across
  runs (each run leaves a fresh denied constructor). Benign in production —
  `createSandboxedRunner` compiles via the captured `GlobalFunction`, not
  `Function.prototype.constructor` — but the install/restore pair is asymmetric and worth a
  small source fix + assertion. Not fixed in the test-only Phase 0 PR by policy (no source
  changes smuggled into a test batch).

---

## 5. References
- Engagement prompt: Master Orchestration Prompt v1.1 (corrected baseline).
- `ROADMAP.md` (v1.23 section), `TODO.md` (P0 block), `AUDIT.md` (overrides + security),
  `CHANGELOG.md` (`[Unreleased]`).
- Plugin sandbox: `docs/PLUGINS-BETA.md`, `services/pluginRegistry.ts`,
  `workers/plugin.worker.ts`.
