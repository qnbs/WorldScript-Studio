# StoryCraft Studio — Completed Tasks (v1.22 Cycle)

Archived from `TODO.md` on 2026-06-12. These items were completed during the v1.22.0 release cycle (AI Execution Modes, OpenRouter, Copilot v2, Security Hardening).

For the **current** task tracker see [`TODO.md`](../TODO.md); for long-term planning see [`ROADMAP.md`](../ROADMAP.md).

---

## AI Execution Mode — Audit, Perfection & OpenRouter

> Branch: `feat/copilot-ultimate-v2-phase2` | Plan: `.claude/plans/storycraft-studio-recursive-valiant.md`

### ✅ Completed (2026-06-11)
- ✅ **Phase 0** — Cold-start seed: `index.tsx` seeds `aiModeService` from persisted Redux state on startup.
- ✅ **Phase 1** — Positive routing: `shouldRouteLocally()` wired into `generateText()` + `DefaultInferenceGateway.generate()`.
- ✅ **Phase 1 (OpenRouter)** — Full OpenRouter provider with circuit breaker, exponential backoff + Retry-After, RPM tracking, free-model detection.
- ✅ **Phase 2** — `notifyLocalModelsReady()` wired from `localAiFacade.ts` after successful inference.
- ✅ **Phase 3** — Eco bridge: `ecoModeService.setAiModeEco()` ↔ Redux aiMode listener; battery auto-eco back-syncs to Redux.
- ✅ **Phase 4** — ProForge `baseAgent.ts` honours `shouldRouteLocally()` + `isEcoMode()` in `buildAiOpts()`.
- ✅ **Phase 5** — Routing observability: `services/ai/routingLogger.ts` with `logRoutingDecision()`.
- ✅ **Phase 6** — `AiModeIndicator` component in Copilot panel header; 2583 i18n keys × 11 locales.
- ✅ **Phase 7** — Unit tests: `aiModeService.test.ts` (25), `routingLogger.test.ts` (5), `ecoModeBridge.test.ts` (13), `openrouterProvider.test.ts` (6).
- ✅ **Settings state** — `OpenRouterSettings` type in `types.ts`; `settingsSlice` reducer + `DEFAULT_OPENROUTER_SETTINGS`; `idbProjectStore.ts` backfill guard.
- ✅ **OpenRouter Settings UI** — `components/settings/OpenRouterSection.tsx` wired into `SettingsView.tsx`; 12 new i18n keys × 11 locales (2594 keys total).
- ✅ **BaseAgent routing tests** — `baseAgent.test.ts` extended with 4 routing tests; bugfix in `baseAgent.ts` (fallback model on routing override).

---

## v1.21.0 — Integrity & Hardening Cycle (2026-06-10)

> Master Plan: `.claude/plans/master-prompt-storycraft-studio-glistening-pnueli.md`

### WS — Integrity & Hardening
- ✅ **WS-1** — README badge v1.21.0→v1.20.0 + metrics; 28 misfiled CHANGELOG entries migrated.
- ✅ **WS-2** — CSP `connect-src` Option B: removed redundant cloud endpoints, kept `https:` for BYOK; ADR-0004 + `tests/unit/csp.test.ts`.
- ✅ **WS-3** — `@huggingface/transformers` 4.2.0 verified against ai-core/voice.
- ✅ **WS-4** — Suppression-debt ratchet gate (`scripts/check-suppressions.mjs`, baseline 181) → baseline **159**.
- ✅ **WS-5** — Bundle-budget single source of truth (`--max-kb 6500 --max-entry-kb 4000`).
- ✅ **WS-6** — `VENDOR-FORKS.md` CVE/OSV-coverage section + `docs/COVERAGE-POLICY.md`.

### Carried over from v1.20.0
- ✅ **P1-1** — WebLLM Worker Offload (ADR-0005): dedicated WorkerBus v2 `webllm` pool.
- ✅ **P1-2** — Whisper WASM STT end-to-end: download UI + VAD→STT bridge + deterministic deep E2E.
- ✅ **P1-7** — Bundle Budget single source of truth.

---

## v1.20.0 — Deep Correction & Release Hardening (2026-06-06)

### P0 — Release Unblock
- ✅ **P0-1** — Tauri Desktop Pipeline: pnpm config migration + signing fix + production hardening audit.
- ✅ **P0-2** — Coverage C-7: 96 neue Tests geschrieben.
- ✅ **P0-3** — Quality Gates stabil: lint/typecheck/i18n/parity/bundle/smoke:prod green.
- ✅ **P0-4** — Native File Associations + Single-Instance for `.storycraft`/`.scst`.

### P1 — AI Resilience & Core Reliability
- ✅ **P1-3** — Redux-Undo × Zustand Race Condition: `manuscriptPinnedBinderNodeId` reconciler.

### P2 — Global Readiness & i18n
- ✅ **P1-5** — Beta-Sprachen `ja/zh/pt/el` ≤ 5 % English-Placeholders erreicht.
- ✅ **P1-4** — Error Boundaries: Alle 19+ Views in `App.tsx` gewrappt.

### P3 — Architektur-Hardening & Performance
- ✅ **P1-6** — Race-Condition Audit: Redux-Undo + Zustand reconcile.
- ✅ **P1-7** — Bundle Budget ceilings unified.

---

## Dependency-Hygiene Backlog (completed or superseded in v1.23)

- ✅ **`.npmrc` Security Hardening** — `strict-dep-builds=true`, `block-exotic-subdeps=true`, `minimum-release-age=10080` already active.
- ⬜ **pnpm override housekeeping** — deferred until `@storybook/test-runner` upgrades to jest-process-manager 1.x.
- ⬜ **Renovate grouping** — deferred to future Renovate config iteration.
- ⬜ **Moderate audit threshold** — deferred until known medium advisories (joi, wait-on) are out of the dep tree.
- ⬜ **AUDIT.md "Known Overrides" table** — moved to v1.23 P0-Audit follow-up.
