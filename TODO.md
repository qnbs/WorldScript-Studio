# WorldScript Studio — TODO (Current Sprint)

Prioritized task tracker for the current sprint.
Status: 🔄 in progress | ⬜ open | ✅ done

> Completed items are archived in [`docs/history/`](docs/history/).
> Long-term features and quarterly planning → [`ROADMAP.md`](ROADMAP.md).

---

## Release — tag/publish pending (2026-08-01)

Native Grok/Claude providers, opt-in Browser-Ollama, and DuckDB `codex_mentions.excerpt`
cell-level encryption (SEC-6) all shipped in this cycle — see
[`docs/history/completed-v1.25.0-providers.md`](docs/history/completed-v1.25.0-providers.md) for
the full completed checklist. `CHANGELOG.md`, `package.json`/`README.md`, and `src-tauri`/`public/sw.js`
are all version-bumped and synced for this release.

- ✅ PR #303 (DuckDB excerpt encryption SEC-6 + CodeRabbit fix + doc-truth fixes) merged to `main`
  at `256264d3` via admin-bypass squash-merge (fresh maintainer authorization; `mergeStateStatus`
  cache-lag artifact — all 20/20 checks green, 0 unresolved review threads, Tauri Rust build
  manually verified green on all 3 platforms before merge).
- ⬜ Tag and publish this release (`v1.25.0`) once `main`'s post-merge CI (`build` + `e2e`) is green
  so `deploy` (GitHub Pages) succeeds — see the exact hand-off commands in the archived provider
  workstream doc linked above. Not auto-executed; requires explicit go-ahead per operational-safety
  rules on pushing/tagging.


---

## Infra — Vercel deployment failures root-caused + fixed (2026-07-29)

> **Status: Resolved same-day.** Briefly paused via `vercel.json`'s `git.deploymentEnabled: false`
> after 2 consecutive preview-deployment failures with only a generic "Deployment has failed"
> message and no further detail from the GitHub Checks API. `npx vercel inspect --logs` needs an
> interactive account login unavailable in-session, so the actual fix came from noticing Vercel's
> `buildCommand` runs `pnpm run build:edge` (`node scripts/build-edge.mjs` → `vite build` with
> `DEPLOY_TARGET=edge`) — a **different command** than the plain `pnpm run build` used for the
> earlier (misleading) local repro attempt, which succeeded and pointed away from a code cause.
> Reproducing the *exact* Vercel command locally
> (`NODE_OPTIONS=--max-old-space-size=3072 pnpm run build:edge`) immediately surfaced the real
> error: `[MISSING_EXPORT] "ensureInferencePool" is not exported by "services/workerBusManager.ts"`
> — `services/ai/localEmbeddingService.ts` (part of the in-flight worker-generation-consolidation
> migration, PR #288) imported and called a function that was never actually added to
> `workerBusManager.ts`. Vitest never caught it because `localEmbeddingService.test.ts` mocks the
> *entire* `workerBusManager` module (`vi.mock(...)` wholesale replacement), so the real file's
> missing export was invisible to that suite; `tsgo`'s local typecheck also passed clean for
> reasons not fully understood (worth a follow-up look at cache behavior) — only rolldown's
> stricter static bundling in the real production build caught it. Fixed by adding the missing
> `ensureInferencePool()` (mirrors `ensureDuckDbPool()`'s shape) plus a `workerBusManager.test.ts`
> suite that imports the *real* module instead of mocking it — that suite would have caught this
> immediately. `git.deploymentEnabled` reverted to enabled; verified fixed via a clean local
> `build:edge` re-run before re-enabling.
>
> **Lesson for future Vercel-build debugging in this repo:** always reproduce with the *exact*
> `vercel.json` `buildCommand`, not `pnpm run build` — they differ (`build:edge` sets
> `DEPLOY_TARGET=edge` and runs `scripts/sync-deploy-base.mjs` first) and a plain `build` passing
> does not prove the deploy build would.

---

## v1.24.2 — CSP/crypto/doc-truth hardening (2026-07-29)

> **Status: Merged (PR #284) and released as `v1.24.2` on 2026-07-29.** Full record:
> [`docs/audit/WS-RUN-LOG-2026-07-29.md`](docs/audit/WS-RUN-LOG-2026-07-29.md),
> [`docs/adr/0013-csp-wasm-and-blob-frames.md`](docs/adr/0013-csp-wasm-and-blob-frames.md),
> [`docs/adr/0014-worker-generation-duplication.md`](docs/adr/0014-worker-generation-duplication.md).
> All 14 findings (F-01…F-14) code-complete — see `AUDIT.md`'s new audit section for the finding table.

- ✅ **CSP functional truth** — `'wasm-unsafe-eval'` + `frame-src blob:` on all 5 surfaces; the
  local-inference stack (WebLLM/ONNX/Transformers.js/DuckDB-WASM/Whisper/Kokoro) had been silently
  broken in production for two months. New 3-layer CSP test architecture.
- ✅ **Desktop API-key encryption** — PBKDF2 600k + random salt, replacing an unsalted single-SHA-256 scheme.
- ✅ **DuckDB-WASM self-hosted** — replaced an unversioned, already-CSP-dead third-party CDN.
- ✅ **Doc-truth fixes** — fabricated `tauri-plugin-stronghold` claim removed; canonical Vercel URL unified with a new drift gate; CI Storybook 3×→1× + a genuinely broken test-runner invocation fixed.
- ✅ **Coverage ratchet** raised to CI-measured values (L79/F72/B65/S77).
- ✅ **Worker-generation consolidation (F-14)** — the dedicated migration sprint
  `docs/adr/0014-worker-generation-duplication.md` deferred, executed as 4 stacked PRs:
  #286 (parity gate + real handler tests for the previously-untested v2 workers), #287 (DuckDB —
  `duckdbClient.ts` migrated, `workers/duckdbWorker.ts` deleted), #288 (embeddings —
  `localEmbeddingService.ts` migrated), #290 (NLP — `localNlpService.ts` migrated,
  `workers/inference.worker.ts` deleted, closing out v1 entirely). Decision record:
  `docs/adr/0015-worker-generation-consolidation.md` (supersedes 0014). Correction loops on #287/#288
  surfaced and fixed real bugs the original v2 files had never been exercised against: DuckDB
  `params` were silently dropped (already live in `telemetryService.ts`'s parameterized writes),
  `terminatePool()` could leave tasks hanging forever, a respawned DuckDB worker lost its
  connection, and `ensureInferencePool()` was imported but never defined (broke Vercel's prod
  build — see the entry below). **Merge status:** #286 merged; #287/#288/#290 open, stacked, CI
  green — merge in order before the next release.
- ✅ **Pre-existing, unrelated E2E a11y finding surfaced during this sprint's CI runs** —
  `tests/e2e/a11y.spec.ts` "writer version control panel has no serious axe violations" failed
  deterministically (`color-contrast` 4.47 vs. 4.5 required, `--sc-accent` `#92400e` over its own
  `/20`-opacity background `#e0cab0`). Confirmed unrelated to the CSP/crypto sprint, but small and
  well-scoped, so fixed directly rather than deferred: `components/writing/WriterViewUI.tsx`'s
  active-toggle classes reused `--sc-accent` for both background tint and text instead of the
  already-vetted `--nav-background-active`/`--nav-text-active` token pair; switched all 3
  occurrences (Writer VC desktop/mobile + mobile ProForge, same shared pattern).
- ✅ **Tag `v1.24.2` + publish the GitHub Release** — stale entry, already done (verified via
  `git tag`/`gh release list`: `v1.24.2` tagged and published 2026-07-29T11:25:42Z).


## v1.24 — Post-release feature-flag refinement (2026-06-21)

- ✅ **ProForge → opt-in** — flipped `enableProForge` default to `false` (experimental, token-heavy); now 17 on / 6 off. Slice + tests + `FEATURE-PARITY.md` + `CLAUDE.md` updated in lockstep.
- ✅ **Feature catalog reconciled** — `featureCatalog.ts` covers all 23 flags; `defaultOn` derived from the slice (drift now impossible, guarded by `tests/unit/featureCatalog.test.ts`); added risk/desktop/dependency metadata.
- ✅ **Grouped Settings UI** — Experimental flags grouped by category with risk hints, dependency-aware disabling (Voice WASM ⇠ Voice Support), "Desktop only" note (Rust Compute), and Reset-to-defaults.
- ✅ **WebNN flag decision** — the ghost/stub `enableWebnnInference` toggle was retired (removed from `featureFlagsSlice.ts`'s 22 flags); see `tests/unit/featureFlagsSlice.test.ts:96` ("WebNN flag (a ghost/no-op toggle) was removed → 22 flags"). This line was stale — reconciled 2026-07-29.
- ⬜ **CII Best Practices badge** — removed from `README.md` (was a literal `projects/XXXX` placeholder — broken image, dead link). Register the project at <https://bestpractices.coreinfrastructure.org/> (external, interactive signup — maintainer-only action), then re-add the badge with the real project ID.


## v1.23 — P0 Audit Follow-up (DELIVERED 2026-06-16)

> All P0 release-blockers closed and v1.23.0 shipped 2026-06-16. The only item still open is the
> human-only manual smoke-test sign-off (below). Forward-looking P1/P2 work has moved to the
> **Upcoming — v1.24 / v2.0 Foundation** block in [`ROADMAP.md`](ROADMAP.md).
> Archived v1.22 tasks → [`docs/history/completed-v1.22.md`](docs/history/completed-v1.22.md).

### P0 — Release-Blocker
- ✅ **ROADMAP/TODO sync** — `ROADMAP.md`, `TODO.md` und `AUDIT.md` widerspruchsfrei auf v1.22.0 + v1.23-Ziele gebracht (2026-06-13). Vorheriger Drift: ROADMAP markierte alle P0 ✅, TODO noch ⬜ — jetzt evidenzbasiert abgeglichen.
- ✅ **Tauri Desktop Pipeline final verifizieren** — `tauri-build.yml` grün auf Ubuntu/macOS/Windows (Run #27439443241). Signing-Secret/Updater bleibt offen für `v*` Releases (kein Secret für workflow_dispatch).
- ✅ **Dependency-Hygiene** — `pnpm audit --audit-level=high` **und** `--audit-level=moderate` → 0 Vulnerabilities (verifiziert 2026-06-13). `pnpm outdated` neu erhoben: nur Patch/Minor-Drift, keine Majors. `AUDIT.md` *Known Overrides Table* aktualisiert: `esbuild >=0.28.1`-Row ergänzt, Platzhalter-CVE-Refs durch verifizierte Advisory-IDs ersetzt, Status-Datum auf 2026-06-13.
- ✅ **i18n Parity** — `pnpm run i18n:check` grün (2590 Keys × 11 Locales). `ja/zh/pt/el` + `ar/he` erreichen Projekt-Ziel ≤5 % EN-Placeholders; `ar/he` UI vollständig übersetzt, native Review offen. `--quality` Scan zeigt zusätzliche "likely untranslated" Einträge (v.a. technische Begriffe), die kein CI-Gate blockieren — siehe `docs/V1.22-SMOKE-TEST.md` für manuelle Locale-Prüfung.
- ✅ **Smoke-Test-Protokoll authored** — `docs/V1.22-SMOKE-TEST.md` mit manuellen Szenarien für alle v1.22-Features (AI-Modi, OpenRouter, Copilot v2, Voice-Download, PWA, Core, Tauri).
  - ⬜ **Manuelle Ausführung (Human-only):** Protokoll gegen beide Live-Demos (GH Pages + Vercel) + lokalen Tauri-Build durchspielen und Sign-off-Tabelle ausfüllen. Kein Code-Task — bleibt offen bis ein Tester die Matrix abhakt.
- ✅ **Plugin Sandbox post-fix validation** — adversarial Worker-Tests ergänzt (WebAssembly-Denial, Generator/AsyncGenerator-Constructor-Escape, Guard-Restoration auf Success- **und** Error-Pfad) in `tests/unit/workers/plugin.worker.test.ts` (23 Tests grün). `pluginRegistry.test.ts` deckt Storage-Key-Validierung (Prefix/Länge/`..`-Traversal/Separatoren) + 2-MiB-Value-Cap bereits ab. Tracking + Follow-up **FU-1** (Function.prototype.constructor Restore-Asymmetrie, low impact) in `docs/AUDIT-PERFECTION-PLAN-v1.23.md`.

### P1 — Diese Woche
- ⬜ Coverage-Ziele erreichen (L≥85 %, B≥75 %, F≥80 %) — Fokus AI-Routing, Voice, Copilot.
- ⬜ Local AI & Voice härten (Whisper/Kokoro Low-End, Eco-Mode, RAM/GPU-Monitoring).
- ⬜ Error Boundaries + Logging für AI/Worker-Failures konsistent.
- ⬜ Accessibility Deep-Dive (Keyboard + Screen-Reader).
  - ✅ **AI Execution Mode section** — Card shell, native ARIA radiogroup (arrow-key nav + roving tabindex), live-region announce, dynamic WebGPU/offline capability hints, full localization (AiModeIndicator hardcodes → i18n, +7 keys × 11 locales), new `AiExecutionModeSection.test.tsx` (10). (Delivered 2026-06-14 in `feat/ai-execution-mode-perfection`)
- ✅ **Command Palette Integration für OpenRouter** — `ai.mode.openrouter.toggle` (enable/disable provider + confirmation toast) und `ai.mode.openrouter.resetCircuit` (`when`-gated: nur sichtbar wenn OpenRouter aktiv **und** Circuit offen; ruft `resetOpenRouterCircuit()` + Toast). `CommandRuntimeDeps.openRouterEnabled` ergänzt (CommandPalette + App.tsx executeCommand). +5 i18n-Keys × 11 Locales (`palette.openRouter.*`), +5 Tests in `commandDefinitions.test.ts`. lint/typecheck/i18n/tests grün. (Delivered 2026-06-14)

### P2 — Nächster Sprint
- ✅ `tests/unit/settings/openRouterSection.test.tsx` — toggle, key input, model selector. (Delivered 2026-06-13 in `feat/openrouter-section-perfection`)
- ⬜ `pnpm exec tsx scripts/audit-feature-parity.ts` — 0 drifts.

---

## v1.24.1 — Local-AI reliability + Dependabot batch (2026-07-28)

- ✅ **Desktop Ollama/LM Studio/vLLM discovery fixed (#266)** — `vite.config.ts`'s `rollupOptions.external` was unconditionally externalizing `@tauri-apps/*` even for the Tauri desktop build itself, leaving `services/localServerHttp.ts`'s `@tauri-apps/plugin-http` import unresolvable in the packaged `.deb`/`.msi`. Fixed via a shared `isTauriBuild()` check; see the 2026-07-28 update in [ADR 0012](docs/adr/0012-local-server-connectivity-tauri-http.md).
- ✅ **Misleading "Ready" status badge for Ollama in the browser fixed (#266)** — the status badge and the desktop-only banner were driven by two unreconciled state signals; badge now shows a distinct "Not available in browser" label. Scan also now prefers native `/api/tags` over the OpenAI-compat shim for Ollama.
- ✅ **Dependabot batch — 20 PRs resolved (16 merged, 4 closed as superseded)** — 14 were straightforward bumps merged directly (Actions bumps, small JS/dev-tooling patches, Tauri/Rust crates, the tauri-deps group, and a stray `log` crate bump in `/src-tauri`, #246). The remaining 6 all had real breaking-change blockers, root-caused and fixed rather than force-merged or suppressed:
  - **#255 / #249 / #253 / #250** (`@ai-sdk/google`/`@ai-sdk/openai`/`@ai-sdk/react`/`ai` major bumps) — `@ai-sdk/google@4` alone emits `LanguageModelV4`, incompatible with the pre-upgrade `ai` package's `LanguageModel` type; root cause was a partial-family upgrade. Fixed by bumping all four together in **PR #275** (`feat/ai-sdk-v4-upgrade`), which supersedes these 4 PRs — closed once #275 merged.
  - **#252** (`@biomejs/biome` 2.4→2.5) — schema-version mismatch plus 2 real new lint findings (`noUnsafeOptionalChaining` ×4, `noUndeclaredEnvVars` ×21 via `turbo.json` `globalEnv`) fixed with real code changes, no suppressions; pushed directly onto the Dependabot branch.
  - **#265** (dev-tooling group) — `@babel/core@8` transitively broke `react-docgen@8.0.3`'s Storybook build (`loadPartialConfig` removed); fixed by capping the existing `pnpm-workspace.yaml` override at `<8`, verified with a real `build-storybook` run; pushed directly onto the Dependabot branch.
- ✅ **Issue #60 (vendor-fork audit)** — status comment posted confirming the audit is done (fork at `10.3.0-sc2`, `verify:vendor` CI guard); issue stays open per its own "permanent reminder" note.
- ✅ **CLAUDE.md locale-count drift fixed** — i18n section undercounted the locale roster (17 vs. the actual 19 — `ru`/`ko` were added in a prior PR but never reflected) and the per-locale module count (20 vs. 21).
- ✅ **`pnpm run build` warnings fixed** — invalid `[dir:ltr]`/`[dir:rtl]` Tailwind arbitrary variant (compiled to the invalid CSS pseudo-class `:is(dir:ltr)`) replaced with the built-in `ltr:`/`rtl:` direction variants; 3 ineffective dynamic `import()` calls (already statically imported elsewhere) converted to static imports.
- ✅ **CodeRabbit findings that failed to post inline on PR #274** — a rate-limited re-review posted 10 findings as review-body text instead of formal threads (GitHub API error). Verified each against current code: 2 already fixed, 5 real (a11y + a genuine CWE-209 stale-request race in `AiProviderCard.handleTest`, an unsafe `LocalServerError.message` passthrough in `ollamaService.ts`, a loose test assertion) fixed with code + dedicated regression tests, 1 already resolved by an earlier commit, 2 judged already-adequately-covered by existing comments.
- ⬜ **Re-open: native Intel-Mac (x86_64) desktop builds** — the `macos-13` hosted runner (added to `tauri-build.yml`'s matrix for this) never actually provisions a runner; the job sits in GitHub's queue indefinitely instead of starting, so 3 consecutive tagged-release builds each hung the full ~24h queue ceiling and blocked the entire release (the `release` job's `needs: [bundle]` only resolves once every matrix leg reaches a terminal state) even though Ubuntu/Windows/macOS-ARM finished in ~12 minutes. Removed `macos-13` from the matrix on 2026-07-28 (see `docs/TAURI-CI.md`); Intel Mac users get no native build/auto-update until a working runner option is found (self-hosted, `macos-latest-large`, or a replacement GitHub-hosted Intel image).

## Dependency-Hygiene Backlog (carried forward)

> `.npmrc` Hardening (`strict-dep-builds=true`, `block-exotic-subdeps=true`, `minimum-release-age=10080`) ist bereits aktiv.
> `pnpm audit --audit-level=high` → 0 vulnerabilities; `pnpm audit --audit-level=moderate` → 0 vulnerabilities.
> Aktueller Status in `AUDIT.md` § *Known Overrides Table*.

- ⬜ **pnpm override housekeeping** — nach `@storybook/test-runner` Upgrade auf jest-process-manager 1.x (drops wait-on@7), direkten Lockfile-Patch auf `joi` entfernen.
- ⬜ **Renovate grouping** — `@storybook/*` bumps atomisch upgraden.
- ⬜ **Moderate audit threshold** — CI `pnpm audit --audit-level` von `high` auf `moderate` anheben, sobald joi/wait-on aus dem dep tree sind.

---


## v1.21.0 — Integrity & Hardening Cycle (2026-06-10) — DELIVERED (PR #104, merged)

> Master Plan: `.claude/plans/master-prompt-worldscript-studio-glistening-pnueli.md` (Deep Audit 2026-06-09, findings F-1…F-9).
> NOTE: prior sprint blocks are retained inline below (file convention), not moved to `docs/history/`.

### WS — Integrity & Hardening
- ✅ **WS-1** (F-1/F-3/F-5, `bc53bbc`) — README badge v1.21.0→v1.20.0 + metrics (433 test files / 2 357 i18n keys); 28 misfiled CHANGELOG entries migrated `[Unreleased]`→`[1.19.0]`; this TODO rollover.
- ✅ **WS-2** (F-2, `5e7e49e`) — CSP `connect-src` Option B: removed redundant cloud endpoints, kept `https:` for shipped BYOK; ADR-0004 + `tests/unit/csp.test.ts` (6/6); Tauri CSP stays strict.
- ✅ **WS-3** (F-6, `6ce236f`) — `@huggingface/transformers` 4.2.0 verified against ai-core/voice: APIs unchanged, typecheck clean, 63 tests green; no source change.
- ✅ **WS-4** (F-4, `f3cc74f`+`6cc3e7d`) — suppression-debt ratchet gate (`scripts/check-suppressions.mjs`, baseline 181) wired into CI; abated **22** `noExplicitAny` (3 production + 19 test mocks — `services/` had none) → baseline **159**.
- ✅ **WS-5** (F-8, `8e5bd4a`) — bundle-budget single source of truth: `--max-kb 6500 --max-entry-kb 4000`, script defaults aligned; corrected the inaccurate "~4000 KB entry" claim (real entry ≈ 496 KB).
- ✅ **WS-6** (F-7/F-9, `3e0aa82`) — `VENDOR-FORKS.md` CVE/OSV-coverage section (vendored y-webrtc invisible to OSV → manual process) + new `docs/COVERAGE-POLICY.md` ratchet rule.

### Carried over from v1.20.0
- ✅ **P1-1** — WebLLM Worker Offload (ADR-0005): dedicated WorkerBus v2 `webllm` pool (`workers/v2/webllm.worker.ts`, capability `inference.webllm`); `generateLocalText` is worker-first with automatic main-thread fallback (NO_WEBGPU / spawn fail / circuit-open), decoupled from `enableWorkerBusV2` via `ensureWebLlmPool()`; GPU mutex + tab election stay main-thread; progress bridges to `inferenceProgressEmitter`. Tests: `webllmWorkerHandler.test.ts` + updated `localAiFacade.test.ts`.
- ✅ **P1-2** — Whisper WASM STT end-to-end: download UI ✅ + VAD→STT bridge ✅ + **E2E ✅** — deterministic deep suite `tests/e2e/deep/voice/whisper-stt.spec.ts` (download progress/cancel/error→retry, STT→intent→command, stop-listening) via guarded seam `services/voice/voiceTestSeam.ts`; nightly real-inference `voice-nightly.yml` + `whisper-real.spec.ts`. Remaining (follow-up, both CI/Playwright-only — cannot be reproduced or verified on the constrained local host): (a) real-audio transcription assertion needs a committed speech WAV driven via `--use-file-for-fake-audio-capture` (a valid speech fixture can't be generated offline here); (b) two STT→command navigation deep tests are `test.fixme` — the headless mock-STT → push-to-talk → command-dispatch chain doesn't fire reliably under fake-media. Re-enable after capturing a Playwright trace of the CI voice-init sequence. **The covered substitute is explicit unit coverage of the service chain:** transcript→intent→`voice-command` CustomEvent (`tests/unit/services/voice/voiceDownloadAndIntent.test.ts` `processTranscript` — asserts the dispatched `commandId`) + the App-level `voice-command`→`executeCommand`→`runCommandById` bridge (`App.tsx:512`). **Consent clarity DONE (v1.24.0, PR D):** the misleading "all voice runs locally" intro is corrected and a per-engine cloud-vs-on-device privacy note now renders beside the STT engine selector (`settings.voice.engine.privacyNote`, 17 locales).
- ✅ **P1-7** — Bundle Budget single source of truth (F-8): `package.json` `bundle:budget` = `--max-kb 6500 --max-entry-kb 4000`; `scripts/check-bundle-budget.mjs` defaults match. Real sizes (CI 2026-06-09): entry `index-*` ≈ 496 KB; largest vendor chunk `lib-*` ≈ 6 054 KB (~446 KB headroom under the 6500 per-chunk ceiling). **Superseded 2026-06-14 by PR #130** — budget tightened to `--max-kb 6200 --max-entry-kb 2500`; `lib-*` split into named `vendor-webllm` (~6.0 MB, binding constraint) / `vendor-onnx` / `vendor-transformers` chunks. See `AUDIT.md` § *v1.23 Bundle Split*.
- ⬜ **P2-2..P2-4** — v2.0 foundation (Cloud-Sync conflict resolution, Plugin Registry Beta, ADRs 0005+).

---

## v1.20.0 — Deep Correction & Release Hardening (2026-06-06)

> Master Plan: `docs/AUDIT-2026-06-06-Deep-Correction-Plan.md` (aus `.kimi/plans/obsidian-swamp-thing-tempest.md`)

### P0 — Release Unblock
- ✅ **P0-1** — Tauri Desktop Pipeline: pnpm config migration + signing fix + production hardening audit. Vercel green; CI Quality Gate running; Tauri builds active with new signing key. Commits `946045e`–`9d222c3`.
- ✅ **P0-2** — Coverage C-7: 96 neue Tests geschrieben (Ziel 90 übertroffen).
  - LoRA: datasetBuilder (19) + evaluationService (16)
  - Voice: intentEngine (17) + feedbackService (23) + audioNavigator (21)
- ✅ **P0-4** — Native File Associations + Single-Instance: `.worldscript`/`.scst` extensions registered, deep link handler in `services/tauriDeepLink.ts`, Rust `RunEvent::Opened`/`RunEvent::SecondInstance` handlers in `lib.rs`.
- ✅ **P0-3** — Quality Gates stabil: lint ✅ · typecheck ✅ · i18n:check ✅ · parity:check + bundle:budget + smoke:prod green on `main` (CI confirmed through PR #103, merged 2026-06-09).

### P1 — AI Resilience & Core Reliability
<!-- The WebLLM Worker Offload item (ADR-0005) is DONE — see its authoritative ✅ entry under "Carried over from v1.20.0" above; the stale ⬜ duplicate was removed 2026-06-14. -->
- 🔄 **P1-2** — Whisper WASM STT end-to-end: **Download UI ✅ (v1.21, 2026-06-09)** · **VAD→STT bridge ✅ (2026-06-09)** — `VoiceActivityCoordinator` wires WebRtcVadEngine PCM frames into WasmSttEngine; MIN_SPEECH_CHUNKS gate + MAX_BUFFER_MS flush; voiceCommandService routes through coordinator when enableVoiceWasm + whisper active. 12 unit tests. Remaining: full E2E integration test (CI-only)
- ✅ **P1-3** — Redux-Undo × Zustand Race Condition: `manuscriptPinnedBinderNodeId` reconciler in `listenerMiddleware.ts` — prüft nach project save/undo/redo/import ob pinned node noch existiert, reset auf `null` wenn stale. Commit `a799bc9`.
  - **Hinweis:** Rust TaskSupervisor UI (ManuscriptStatsPanel) ist separat in WorkerBus v2 Phase 3 (siehe unten).

### P2 — Global Readiness & i18n
- 🟢 **Language expansion — 6 neue Locales (11 → 17):** `fi/sv/hu/is/eu` (Beta) + `fa` (RTL, Persisch). Infra + Glossar (v2.0, ~44 Anker-Begriffe), Priority-Files **hand-übersetzt**; **alle übrigen Module bulk-übersetzt** (glossar-verankert, Placeholder-maskiert) → ~96-100 % über alle 10 Beta-Locales. `glossaryTranslate` Partial-Match-Bug behoben (jetzt Exact-Match-only; ~1.300 teil-englische Strings neu übersetzt). **Offen:** menschliche Native-Review (Checkliste in [`docs/TRANSLATION-GUIDE.md`](docs/TRANSLATION-GUIDE.md) §6). Siehe [`docs/LANGUAGE-EXPANSION-2026.md`](docs/LANGUAGE-EXPANSION-2026.md).
- ✅ **P1-5** — Beta-Sprachen ja/zh/pt/el ≤ 5% English-Placeholders **erreicht** (verifiziert 2026-06-09: pt 2.2% · el 2.8% · ja 0.9% · zh 0.5%). Tooling: `scripts/bulk-translate-locales.mjs` (Google-Translate-Endpoint mit Rate-Limiting/Retry/Checkpointing/Glossary) + `locales/translation-glossary.json` + `docs/BULK-TRANSLATION.md`. Command: `node scripts/bulk-translate-locales.mjs --lang=ja,zh,pt,el --all --delay=400`.
- ✅ **P1-4** — Error Boundaries + Logging: Alle 19+ Views in `App.tsx` mit `ErrorBoundary`/`ViewErrorBoundary` gewrappt (WelcomePortal früher Return-Path + alle Modals/Portals). Commits `f810d51` + `6305d64`.

### P3 — Architektur-Hardening & Performance
- ✅ **P1-6** — Race-Condition Audit: Redux-Undo + Zustand reconcile (`listenerMiddleware.ts` clears `manuscriptPinnedBinderNodeId` when node no longer exists after project change/undo/redo). Commit `a799bc9`.
- ✅ **P1-7** — Bundle Budget: ceilings unified in one place (`bundle:budget` = `--max-kb 6500 --max-entry-kb 4000`; script defaults match). Correction: the prior "~4000 KB Entry (nahe Limit)" note was inaccurate — the `index-*` entry is ~496 KB; the binding constraint is the `lib-*` vendor chunk (~6 054 KB vs the 6500 per-chunk ceiling). See WS-5 / F-8.
- ⬜ **P2-1** — Error Boundaries + Logging: Alle 19 Views, Kein console.error

### P4 — v2.0 Foundation
- ⬜ **P2-2** — Cloud-Sync Conflict Resolution
- ⬜ **P2-3** — Plugin Registry Beta
- ⬜ **P2-4** — ADRs 0004/0005 + CLAUDE.md/AGENTS.md Update

---

## v1.20.0 — CI Hardening + AI Core + Local AI Perfection (2026-06-01)

- ✅ **pnpm lockfile sync** — `@xenova/transformers` → `@huggingface/transformers@^3.8.1`; `ERR_PNPM_OUTDATED_LOCKFILE` blocked all CI runs
- ✅ **14 CodeAnt AI issues fixed** — webllm dispose on eviction, releaseWebLlm both variants, await releaseAllOnnxSessions, computeShaderFactory race condition, localAiDeviceProfiler backend recommendation, adaptiveAiEngine task field, telemetryService feature flag gate, window guards, AiSections conditional mount, AdaptiveAiHardwarePanel i18n (2160 keys × 5 locales)
- ✅ **E2E stabilisation (24 → ~0 failures)** — VRT baselines, WelcomePortal contrast, waitForSpaReady theme-wait, seedGeminiApiKey role=switch fix, SceneBoard ARIA (toolbar/li), LoRA wizard skip, a11y locators, export localStorageOnly
- ✅ **Local AI Perfection — Phase 1 + 2.1 complete** — IDB session lock + key rotation, Silero VAD + Kokoro TTS async, GPU diagnostics, real text-gen pipelines, AbortSignal
- ✅ **Scorecard Pinned-Dependencies #72** — graphifyy pip install pinned by SHA256 hash
- ✅ **prune-deployments.yml** — all-environment pruning (Production/Preview/github-pages); 156 records deleted; github-script v7→v9 (node24)
- ✅ **Storybook cloud-first CI** — storybook-debug.yml (manual dispatch), Playwright browser cache v5 (node24)
- ✅ **Local AI Perfection Phase 2.2** — LoRA productionization (2026-06-02): `LoraView` container assembles library/dataset/evaluation/wizard behind `LoraViewContext`; gated `lora` route in App.tsx; conditional sidebar nav (`enableLoraAdapters`); `View`/`APP_SECTIONS`/`viewNavigationLabels`/`LORA` icon/`sidebar.lora` (7 locales); `lora-wizard.spec.ts` re-enabled; LoraView unit test
- ✅ **AI retry/fetch hardening** (2026-06-02) — `aiRetry` exponential backoff + jitter + Retry-After (P1-F5); `fetchAdapter` opt-in streaming-safe timeout (P1-F6)
- 🔄 **Local AI Perfection Phase 2.3** — Performance hardening. ✅ (2026-06-02) Pipeline LRU cache unified into `services/ai/pipelineLruCache.ts` (was duplicated in `workers/inference.worker.ts` + `workers/v2/inference.worker.ts`); adds **dispose-on-evict** (closes VRAM/RAM leak) + **in-flight load dedup**; 9 deterministic tests. ⬜ Remaining: WebLLM worker offload, LRU result-pipeline warmup tuning
- 🔄 **Local AI Perfection Phase 2.4** — Coverage. Correction: `sileroVadEngine.ts` (5 tests) + `kokoroTtsEngine.ts` already had tests since 2026-05-31 (TODO "0 tests" was stale). ✅ (2026-06-02) Filled real Kokoro gaps — `cancel()`/`pause()`/`resume()`/`dispose()` + no-WebAssembly branch (+4 tests → 10). Inference-worker LRU now covered via `pipelineLruCache.test.ts` (13). ⬜ Remaining: threshold bump to CI-measured floor
- ✅ **OpenRouter Settings Section hardening** (2026-06-13) — searchable design-system `Select`, authenticated model catalog fetch/cache, key validation/test-connection, full i18n (38 new keys × 11 locales), `ViewErrorBoundary` wrapping, 10 `OpenRouterSection` unit tests + 12 `openrouterModels` tests + 4 provider tests. All 11 CodeAnt AI inline comments addressed (free-model i18n, cloud AI policy gates, cache validation, Escape propagation, authenticated catalog, error-resilient Select, re-fetch on credential change). PR `feat/openrouter-section-perfection`.
- ✅ **WorkerBus v2 Phase 1** — `@domain/worker-bus` package: typed worker pool, circuit breakers, dead-letter queue, priority task queue, progress emitter, protocol handler; 123 tests / 12 suites; 84.5% coverage
- ✅ **WorkerBus v2 Phase 2** — runtime wiring complete (2026-06-02): `workerBusManager` (singleton lifecycle), `hybridRouter` (web/Rust routing), `legacyWorkerBusAdapter` (ai-core shim), `tauriTaskBridge` (Tauri invoke); feature flag UI exposed; listenerMiddleware listeners; 154 combined tests; Rust backend stub deferred to Phase 3
- 🔄 **WorkerBus v2 Phase 3** — Rust TaskSupervisor. ✅ (2026-06-03) `src-tauri/src/commands/task_supervisor.rs` + `commands/mod.rs`; `worldscript_task_supervisor_ping` (version) + `worldscript_task_supervisor_submit` (taskType dispatcher, honest `success:false` on unknown/bad payload) registered in `lib.rs`. First real compute task `text.analyze` (word/char/sentence/syllable counts + Flesch Reading Ease, pure-Rust, 8 `#[cfg(test)]` tests). TS front-end `services/rustTaskSupervisor.ts` (`analyzeTextViaRust` — probes `isRustComputeAvailable` before routing so a Rust-only task never hits the web pool; null → JS fallback) + 5 unit tests. ⬜ Remaining: full `cargo build`/desktop verification (CI/Tauri — heavy locally); wire a real UI consumer (analytics/progress health); add more native tasks; `candle` `rust-compute` feature inference path
- 🔄 **C-7** — Coverage L85%/B75%/F80%; Stryker break 75→80
  - ✅ Stryker Config: concurrency 3, timeoutFactor 1.5, reporters [progress,json], tempDirName, slow warnings
  - ✅ Matrix-Parallelisierung: 5 Jobs (services-commands, services-core, services-ai, features-project, features-misc)
  - ✅ Incremental Caching pro Modul (actions/cache) mit force/incremental Mode-Switch
  - ✅ Timeout: 30 min pro Job (statt 45 min single job)
  - ✅ Aggregate Job mit kombinierter Summary-Tabelle
  - ⬜ Erste Test-Run auf GitHub Actions dispatchen und validieren
  - ⬜ Neue Dateien zur mutate-Liste hinzufügen (nach lokalem Test)
- 🔄 **C-6** — ar/he Beta shipped (2026-06-03): all 18 UI modules fully translated (ar + he), Noto Sans Arabic/Hebrew + Naskh fonts wired, `[dir="rtl"]` CSS net + shell logical-property conversion + canvas LTR islands, WelcomePortal ar/he selectors, "(Beta)" labels retained. `i18n:check` now validates ar/he parity (2259 keys × 7 locales). Help Center gained an **Advanced & Power Features** category (8 articles, en/de/fr/es/it; ar/he English fallback) + 3 offline RAG chunks; in-app **Settings Guide** now documents every live category (Fine-Tuning/LoRA, Community, Plugins). ⬜ Remaining: native-speaker review + `help.json` long-form prose (English fallback for Beta) — community follow-up

---

## v1.19.0 — Phase 2: B-Series Sprint (RELEASED 2026-05-28)

- ✅ **B-1** — `services/storage/storageEncryptionService.ts` — AES-256-GCM IDB at-rest encryption; PBKDF2 (310k iter), 32-byte random salt, `extractable: false`; `enableIdbAtRestEncryption` flag
- ✅ **B-2** — `services/voice/wasmSttEngine.ts` + `sileroVadEngine.ts` — Whisper WASM STT scaffold + Silero VAD v4 via ONNX; `enableVoiceWasm` flag
- ✅ **B-3** — `packages/collab-transport` — vendor fork of y-webrtc 10.3.0 with RTCDataChannel E2E encryption baked in (replaces pnpm patch approach)
- ✅ **B-4** — `tests/e2e/a11y-axe.spec.ts` — 8-view axe-core WCAG 2.2 AA E2E gate (CI-enforced, zero violations)
- ✅ **B-5** — `locales/ar/` + `locales/he/` locale stubs; `enableRtlLayout` flag activates `html[dir="rtl"]` + BiDi context provider
- ✅ **B-6** — `services/logger.ts` StructuredLogger rewrite — IDB sink (1 000-entry LRU), Tauri JSONL sink, GDPR `sanitizeLogContext`; `createLogger(module)` + `.withContext(ctx)` API
- ✅ **B-7** — Coverage thresholds raised: L 71 / F 63 / B 57 / S 69 (measured: 73/65/58/71)
- ✅ **B-8** — Stryker `break` 70→75; `mutate` targets 34→40 files
- ✅ **Docs** — `docs/SPRINT-HANDOFF-2026-05-28.md`, CHANGELOG `[1.19.0]`, ROADMAP, TODO, README, CLAUDE.md, SECURITY.md, IDB-ENCRYPTION.md, VOICE_MASTER_PLAN.md all updated
- ✅ **Quality gate** — lint ✅ · typecheck ✅ · i18n:check ✅ · tests ✅

---

## Phase 3 — v2.0 Foundation (ACTIVE 2026-05-28)

- ✅ **C-1** — `packages/collab-transport/src/crypto.js` security hardening: PBKDF2 100k→310k, extractable:false, return promise.reject() fix
- ✅ **C-2** — Reference plugins: `services/plugins/wordCountOverlay.plugin.ts` + `sceneAppender.plugin.ts` (8 tests) + runtime flag gate (2026-05-29)
- ✅ **C-3** — LoRA Ollama wiring: `LoraAdapter.ollamaModelTag`, `AIRequestOptions.loraModelPath`, `selectActiveLoraOllamaTag`; **parity fix (2026-05-29)**: selector now wired into `useWorldScriptAI` + `worldScriptCompletionFetch`
- ✅ **C-4** — Cloud-Sync verified: `services/cloudSync/` (3 files, 41 tests, AES-256-GCM); `create()` structural flag gate added (2026-05-29)
- ✅ **C-5** — GitHub Issue Templates (`bug_report.yml`, `feature_request.yml`, `translation_pr.yml`) + AGENTS.md hardening
- ✅ **Feature Parity Audit** (2026-05-29) — 8 critical drifts fixed; `docs/FEATURE-PARITY.md` + `features/featureCatalog.ts` + `scripts/audit-feature-parity.ts`
- ✅ **C-7 partial** (2026-05-28) — +130 tests; thresholds raised L73/F65/B58/S71; 4 192 tests / 392 files
- ~~✅ **Codespace Uplift** (2026-05-30) — CLAUDE.md environment-aware shell rules; devcontainer re-activated (8-core/16GB); `.devcontainer/README.md` Modus Operandi section~~ **REVERTED** — DevContainer/Codespaces config removed; local low-end hardware only
- ✅ **Vercel blank screen fix** (2026-05-30) — `index.html` `%BASE_URL%` for manifest/favicon/og; `index.tsx` error safety net; 382 test files / 4567 tests all green
- ✅ **Production blank screen — zod/rolldown DCE** (2026-06-02) — `init_locales is not defined`: rolldown's prod DCE dropped zod's `__esm` init wrappers (zod `sideEffects:false`). Fixed via `patches/zod@4.4.3.patch` (`sideEffects:true`). Added `smoke:prod` (headless mount check on built `dist/`) to CI build job + `unhandledrejection` startup handler — closes the dev-mode-E2E blind spot
- 🔄 **C-6** — ar/he UI translation **complete** (2026-06-03): 18 modules translated in `locales/{ar,he}/` (help.json English fallback), Noto fonts + RTL shell layout shipped as Beta. Remaining: native-speaker review + help-article prose — community task. See `docs/I18N-GLOSSARY-RTL.md`
- 🔄 **C-7 remainder** — Coverage → L85%/B75%/F80%; Stryker break 75→80 (current thresholds: L73/F65/B58). **Phase 3 started (2026-06-02):** +33 LoRA tests (useLoraView, training wizard, sub-panels — were 0%)
- ✅ IDB at-rest encryption UX (2026-06-02 reconciliation) — `IdbUnlockModal` (startup unlock + 2-step forgot-passphrase escape hatch, `App.tsx:182-188,638-643`), `PassphraseModal` (set/change/disable), real read/write gating `idbProjectStore.ts:209-265`, session lock + key rotation (Phase 1). `enableIdbAtRestEncryption` flag in Settings › Privacy with ⚠ warning
- ✅ **P0-2** — Plugin worker isolation (`workers/plugin.worker.ts`) — routes plugin execution to isolated worker context with timeout and sandboxed API
- 🟡 **P0-4** — DuckDB OPFS at-rest encryption (`services/duckdb/duckdbEncryption.ts`) — cell-level encryption is now wired for the one column holding literal manuscript prose, `codex_mentions.excerpt` (v1.25.0): `duckdbCodexWrite()` encrypts it into `excerpt_enc BLOB` when `enableIdbAtRestEncryption` is active, with `services/duckdb/codexExcerptEncryptionMigration.ts` backfilling pre-existing plaintext rows. Full OPFS **file-level** encryption remains infeasible (DuckDB-WASM owns the OPFS file handle directly) and is an accepted, permanent limitation, not a remaining task — see `.github/SECURITY.md` SEC-6.
- ✅ **P0-5** — Voice WASM model download UI (`components/voice/VoiceModelDownloadModal.tsx`) — progress modal for Whisper/Kokoro model downloads with cancel/retry
- 🔄 Whisper WASM STT model download + inference pipeline (B-2 continuation) — engine (`services/voice/wasmSttEngine.ts`) + download UI (P0-5 above) shipped; remaining scope narrowed to E2E integration test coverage only — stale ⬜ reconciled 2026-07-30.
- 🔄 Kokoro/Piper TTS WASM engines — Kokoro DONE (`services/voice/kokoroTtsEngine.ts`, tested since 2026-05-31); Piper remains an unimplemented type-level placeholder only (`preferredTtsEngine: 'piper'` in `voiceCommandService.ts` has no backing engine file) — stale ⬜ reconciled 2026-07-30.
- ⬜ PLANbib v1.7 features (Objects → MindMap → Interviews → Timeline → Wizard → Analysis → ReadMode → Guide → Desktop) — 9 phases, go-ahead from user required

---

## v1.18.1 — TypeScript strict-mode compliance sweep (2026-05-27)

- ✅ **All pre-existing TypeScript errors fixed** — zero `tsc --noEmit` errors across 47 changed files
- ✅ **`BaseAgent.buildAiOpts()`** — new protected helper derives valid `AIRequestOptions` (model + provider) from `PipelineConfig`; applied to all 7 pipeline agents + `selfReflect()`
- ✅ **Voice components** — `VoicePrivacyConsentModal` + `VoicePrivacyStatus` import paths, action names, and selector names corrected
- ✅ **`versionControlSlice`** — added stub `restoreSnapshot` reducer (typed cross-slice signal)
- ✅ **35+ test fixture corrections** — StorySection shape, AiModel/Theme/MindMapNodeType/StoryObjectType literals, PrivacySettings required fields, DeviceHealthReport shape, FlatHelpArticle.contentKey
- ✅ **Quality gate** — lint ✅ · typecheck ✅ · i18n:check ✅ · tests ✅

---

## v1.18.0 — ProForge Humanization & Refinement Sprint (RELEASED 2026-05-27)

- ✅ **Phase H** — Author-facing vocabulary: stage labels, loading messages, RAG "passages" rename, flag descriptions, behavioral tests
- ✅ **Phase A** — `BaseAgent` abstract class (~200 LOC removed); `aiConstants.ts` consolidation; `addDebouncedListener` factory in `listenerMiddleware.ts`
- ✅ **Phase P-1** — `SupervisorAgent`: heuristic quality gates (no AI calls), fallback sentinel detection
- ✅ **Phase P-2** — Orchestrator `executeStageWithSupervision` retry loop; hard gate: intake `qualityScore < 30`
- ✅ **Phase P-3** — `BaseAgent.selfReflect()` self-evaluation loop; DiagnosticAgent + StructuralAgent re-run on INCOHERENT flag
- ✅ **Phase P-4** — Honest fallbacks: all `createFallback*` use 0 scores + `isFallback: true`
- ✅ **Phase P-5** — `PipelineReviewPanel` redesign: Critical Actions card, severity-grouped view, Quick Accept High-Confidence button
- ✅ **Phase X-1** — Settings nav semantic grouping: `NAV_GROUPS` + `NavGroupHeader`
- ✅ **Phase X-2** — Flow Mode: `transientUiStore` `flowMode`/`setFlowMode`; `Escape` exits
- ✅ **Phase X-3** — Empty states for Characters, World, SceneBoard, ProForge views
- ✅ **i18n parity** — 2055 keys × 5 locales; `proforge.pipeline.title/noneActive` added to DE/ES/FR/IT
- ✅ **Test fixes** — 84 previously-failing tests green: `listenerMiddleware` (sync `getOriginalState`), `WriterViewUI` (context mock), `ProForgeDashboard` (i18n key assertion), 3× thunk files (aiPolicy mock)
- ✅ **Quality gate** — lint ✅ · i18n:check ✅ · typecheck ✅ · tests ✅ (84 tests recovered, 0 regressions)

---

## Coverage Sprint — Test Expansion + Maintenance (2026-05-26)

- ✅ **89 new test files** — settings, writing, manuscript, mind-map, ui, services, hooks, root components
- ✅ **~400 new unit tests** — AiScratchpad, ContextPanel, ToolInputs, InspectorPanel, NavigatorPanel, MindMapNodeEditor, MindMapNodeShape, ecoModeService, creativityTemperature, useCharacterInterviewsView, GpuMetricsPanel, FeatureFlagsSection, PrivacySection, SettingsOverviewCard, SettingsModals, + 70 more modules
- ✅ **Biome lint clean** — 895 files, 0 errors
- ✅ **Total test files:** 360 (was 178 files before this sprint)
- ✅ **ProForge test suite TypeScript errors fixed** — 15 test files, 30+ TS errors resolved (EntityState, ProForgeState shape, PipelineStage/ReviewItemType/ReviewItemSeverity casts, i18n generic mock, biome-ignore placement)
- ✅ **Coverage Sprint test failures fixed** — NotificationsSection (role=switch), Progress (CSS selector), ManuscriptEditor (word count regex), AnalyticsBootstrap (mock reset), ragPromptAssembly (token budget)
- ✅ **Dependencies updated** — 16 packages (patch + minor); `pnpm audit`: 0 vulnerabilities
- ✅ **Coverage (2026-05-26):** Stmts 71.29% / Branches 58.79% / Funcs 65.18% / Lines 73.06% — all CI thresholds passed (S≥67/B≥55/F≥60/L≥68); 4 044 tests / 360 files, 0 failures

---

## v1.17 — Voice Full Support Foundation (RELEASED 2026-05-24)

- ✅ **Abstract Engine Interfaces** — `SttEngine`, `TtsEngine`, `VadEngine`, `WakeWordEngine`, `IntentEngine` in `services/voice/voiceTypes.ts`
- ✅ **Web Speech API Fallbacks** — `WebSpeechSttEngine`, `WebSpeechTtsEngine`, `WebRtcVadEngine`, `EnergyThresholdWakeWordEngine` (immediately available, 0 downloads)
- ✅ **Hybrid Intent Engine** — template matching (exact) → Jaccard fuzzy scoring → slot extraction (navigation); view-context filtering; 25 static voice commands
- ✅ **VoiceCommandService** — singleton orchestrator with state machine (idle → listening → processing → speaking → idle)
- ✅ **Redux State** — `voiceSlice` (mode, transcript, processing, dictation, engine status, microphone permission, onboarding); `VoiceSettings` in `settingsSlice`; `enableVoiceSupport` in `featureFlagsSlice`
- ✅ **React Hooks** — `useVoice` (service bridge), `usePushToTalk` (Ctrl+Shift+V), `useVoiceDictation` (editor insertion), `useVoiceAccessibility` (ARIA + focus)
- ✅ **UI Components** — `VoiceIndicator` (status overlay), `VoiceControlPanel` (command panel), `VoiceSettingsSection` (settings tab with onboarding)
- ✅ **App Integration** — `App.tsx` (conditional rendering, `document.body.dataset['view']` for intent engine), `Header.tsx` (voice status), `ManuscriptEditor.tsx` (dictation support)
- ✅ **Audio Navigator** — `audioNavigator` singleton: ARIA landmark scanning, focus management, `aria-live` regions
- ✅ **Feedback Service** — 3 verbosity levels (minimal/standard/verbose); TTS queue; event listeners for visual feedback
- ✅ **i18n** — 2025 keys × 5 locales (voice.* settings added)
- ✅ **Tests** — 83 unit tests / 9 test files (voiceSlice, intentEngine, feedbackService, sttEngine, ttsEngine, vadEngine, wakeWordEngine, audioNavigator, commandVoiceMappings)
- ✅ **Quality gate** — lint ✅ · i18n:check ✅ · typecheck ✅ · 83/83 voice tests ✅

### DevEx — Dual-Graph Integration (2026-05-24)

- ✅ **CodeGraph Setup** — global install, `codegraph init -i`, `.codegraph/` solo-repo policy
- ✅ **pnpm Scripts** — `codegraph:*` + `graphs:update` + `codegraph:affected`
- ✅ **VS Code: Tasks** — CodeGraph status/update/report + Dual-Graph update
- ✅ **Documentation** — `docs/codegraph.md`, `docs/dual-graph-setup.md`, README Hub, CONTRIBUTING
- ✅ **Agent Instructions** — `CLAUDE.md` + `.github/copilot-instructions.md` CodeGraph rules
- ✅ **Automation** — `scripts/codegraph-report.mjs`, `scripts/dual-graph-update.mjs`, `scripts/pre-commit-codegraph.mjs`
- ✅ **CI-AUDIT.md** — `graphs:update` as post-feature repo policy
- ✅ **Quality gate** — lint ✅ · Biome ignores `.codegraph/` ✅

### v2.0 Open Items

- ✅ Full RTCDataChannel in-flight E2E encryption (Yjs y-webrtc patch) — DONE, vendor fork `packages/collab-transport` (y-webrtc 10.3.0, C-1); see its `AUDIT.md` ("RTCDataChannel payloads are now E2E-encrypted when `room.key` is set") — stale ⬜ reconciled 2026-07-30.
- 🔄 RTL language support (Arabic, Hebrew, Persian) — Beta shipped behind `enableRtlLayout` (B-5); see the more current "C-6" entry above for the ar/he UI-translation detail and remaining native-speaker-review scope — stale duplicate ⬜ reconciled 2026-07-30.
- ✅ Fine-tuning / LoRA support for personalized writing styles — DONE, `enableLoraAdapters` shipped default-on (Settings → AI → Fine-Tuning, Ollama Modelfile activation) — stale ⬜ reconciled 2026-07-30.
- ⬜ Cloud sync (optional, E2E-encrypted)
- ✅ DS-5: Delete legacy bridge block from index.css (after DS-1 verified in production) — DONE: bridge block already removed in prior sprints; remaining aliases (`--nav-*`, `--glass-*`, `--border-interactive`, `--ring-focus`) are intentional semantic tokens, not legacy bridges.

---

## v1.20.0 — UI Modernization Phase 1 (IN PROGRESS)

- ✅ **LanguageSelector** — Modern combobox with search, flag emojis, RTL support
- ✅ **RadioGroup** — Accessible radio group component
- ✅ **Tabs** — WAI-ARIA compliant tabs component
- ✅ **ToggleSwitch** — RTL-aware with reduced-motion support
- ✅ **WelcomePortal** — Updated to use new LanguageSelector
- 🔄 **Select/Combobox** — Design-system `Select` extended with optional `searchable` filtering; OpenRouter section migrated. Remaining: replace native `<select>` in other Settings/AI sections incrementally.
- ⬜ **Dropdown Menu** — Action menus with icons and keyboard navigation
- ⬜ **Unit tests** — Add tests for LanguageSelector, RadioGroup, Tabs
- ⬜ **Storybook stories** — Add stories for new components
- ⬜ **CI verification** — Wait for green CI before merge

---

## v1.11 — Stabilization Sprint (RELEASED 2026-05-22)

- ✅ **Cloudflare deploy fix (P0)** — `resolve-deploy-base.mjs` `base` → `deployBase`; `sync-deploy-base.mjs` error propagation
- ✅ **`services/dbInitialization.ts`** — `initializeStorage()` + `resetAllDatabases()` extracted from inline IIFE
- ✅ **StorageBackend retries** — `retryDb()` applied to `saveProject` + `saveSettings` in `dbService.ts`
- ✅ **`StorageErrorScreen` recovery UI** — `index.tsx` shows React component with Reload + Reset on DB init failure
- ✅ **Settings auto-save toast** — `listenerMiddleware.ts` catch dispatches error notification
- ✅ **Help Center complete** — 13 stub articles fully written (700–1000 chars HTML) × 5 locales; 1931 keys × 5 at parity
- ✅ **Tests** — `dbInitialization.test.ts` (8 tests) + `dbServiceRetry.test.ts` (7 tests)
- ✅ **Quality gate** — lint ✅ · i18n:check ✅ · typecheck ✅ · 15/15 new tests ✅

---

## v1.7 — DuckDB Analytics + Hybrid RAG + AI Extensions (RELEASED 2026-05-20)

- ✅ **DuckDB-WASM P0–P3** — worker, client, schema (10 tables + 5 views), analytics queries, migration, dual-write, RAG vectors, cross-project, codex, scene timeline
- ✅ **DuckDB resilience** — init retry (3×), dual-write retry (3×), OPFS fallback to in-memory, error surface to Redux
- ✅ **Hybrid RAG wired end-to-end** — `ragMode` setting, mode selector UI, consistency checker uses RAG context, Re-Index button in Reference Panel, Settings button bug fix
- ✅ **ONNX + Transformers.js** as selectable primary AI providers
- ✅ **Service-level dedup** — `aiThunkUtils` prevents concurrent duplicate AI requests
- ✅ **Per-project AI preset** — hash-based deep links, dedup key hardening
- ✅ **WorkerBus backpressure** — `MAX_QUEUE_SIZE` = 32, telemetry extended
- ✅ **Y-WebRTC E2E encryption** — AES-256-GCM, PBKDF2 310k iter, CollaborationPanel badge
- ✅ **PlotCanvas rAF throttle** — eliminates 60 Hz Redux dispatch storm
- ✅ **i18n** — 1 625 keys × 5 locales (+35 new keys)
- ✅ **Quality gate** — lint ✅ typecheck ✅ i18n ✅ 2 024+ tests / 178 files ✅

## v1.8 — RAG Prompt Assembly + UX (2026-05-21)

- ✅ **`assembleRAGPrompt`** — `services/ragPromptAssembly.ts` + PromptLibrary templates
- ✅ **Writer** — RAG toggle + chunk badge; continuation/brainstorm/critic use hybrid context
- ✅ **Plot Board AI** — `suggestNextBeatThunk` + modal UI
- ✅ **DuckDB embedding** — `rag_chunks.embedding` 384-dim migration + dual-write fix
- ✅ **PWA audit** — [`docs/PWA-AUDIT.md`](docs/PWA-AUDIT.md), `handle_links`, SW comment for WASM/ONNX
- ✅ **Settings & Help** — RAG hybrid hint, help article + `tryActionId`, `helpDocRetrieval` chunk
- ✅ **UI tokens** — Writer, Command Palette, Modal, Project AI preset (`--ring-focus`)
- ✅ **Docs** — README hub, ROADMAP, CHANGELOG `[Unreleased]`, AUDIT, `.cursor/index.mdc`
- ✅ **Tauri audit** — [`docs/TAURI-CI.md`](docs/TAURI-CI.md) checklist v1.8
- ✅ **Sprint ref** — [`docs/SPRINT-V1.8.md`](docs/SPRINT-V1.8.md)

### v2.0 Open Items

- ⬜ DuckDB `rag_chunks` schema migration: `FLOAT[64]` BoW → `FLOAT[384]` semantic vectors — **superseded by v1.8 embedding column** (verify on device)
- ✅ Full RTCDataChannel in-flight E2E encryption (Yjs y-webrtc patch) — DONE, vendor fork `packages/collab-transport` (y-webrtc 10.3.0, C-1); see its `AUDIT.md` ("RTCDataChannel payloads are now E2E-encrypted when `room.key` is set") — stale ⬜ reconciled 2026-07-30.
- 🔄 RTL language support (Arabic, Hebrew, Persian) — Beta shipped behind `enableRtlLayout` (B-5); see the more current "C-6" entry above for the ar/he UI-translation detail and remaining native-speaker-review scope — stale duplicate ⬜ reconciled 2026-07-30.
- ✅ Fine-tuning / LoRA support for personalized writing styles — DONE, `enableLoraAdapters` shipped default-on (Settings → AI → Fine-Tuning, Ollama Modelfile activation) — stale ⬜ reconciled 2026-07-30.
- ⬜ Cloud sync (optional, E2E-encrypted)
- ✅ **Branches coverage ≥ 55 %** (v1.10: Vitest gate 55 %, RAG/help/plot tests)

---

## v1.6 — Plot-Board v2 & Writer Experience (RELEASED 2026-05-19)

- ✅ **Plot-Board v2** — `plotBoardSlice`, `plotBoardService`, `PlotCanvas`, `ConnectionLayer`, `SubplotPanel`, `TensionCurvePanel`, `ConnectionToolbar`, beat-sheet overlays, mobile pinch/pan
- ✅ **Real-Time Book Preview** — `BookPreviewView`, `useBookPreviewView`, `BookPreviewContext`, IntersectionObserver TOC, fullscreen
- ✅ **Reference Panel** — `ReferencePanelView` (6 tabs: Characters, World, Notes, Binder, Comments, Revisions)
- ✅ **Per-Scene Revision History** — `sceneRevisionService` (IDB), `SceneRevisionPanel`, word-level diff, named snapshots
- ✅ **Threaded Comments** — `sceneCommentsSlice`, `CommentsPanel`, resolve/reply/delete
- ✅ **Progress Tracker** — `progressTrackerSlice`, `ProgressTrackerView`, session timer, streak, velocity chart, heatmap
- ✅ **Mobile Polish** — `useFoldableLayout`, `deepLinkService`, `HAPTIC_PATTERNS` named library
- ✅ **i18n** — 1590 keys × 5 locales
- ✅ **Quality gate** — lint ✅ typecheck ✅ 2024 tests / 178 files (0 failures) ✅ coverage 65.91% lines ✅

### v2.0 Open Items

- ✅ Full RTCDataChannel in-flight E2E encryption (Yjs y-webrtc patch) — DONE, vendor fork `packages/collab-transport` (y-webrtc 10.3.0, C-1); see its `AUDIT.md` ("RTCDataChannel payloads are now E2E-encrypted when `room.key` is set") — stale ⬜ reconciled 2026-07-30.
- 🔄 RTL language support (Arabic, Hebrew, Persian) — Beta shipped behind `enableRtlLayout` (B-5); see the more current "C-6" entry above for the ar/he UI-translation detail and remaining native-speaker-review scope — stale duplicate ⬜ reconciled 2026-07-30.
- ✅ Fine-tuning / LoRA support for personalized writing styles — DONE, `enableLoraAdapters` shipped default-on (Settings → AI → Fine-Tuning, Ollama Modelfile activation) — stale ⬜ reconciled 2026-07-30.
- ⬜ Cloud sync (optional, E2E-encrypted)
- ⬜ AI creativity presets per project (not global)
- ✅ **Branches coverage ≥ 55 %** (v1.10: Vitest gate 55 %, RAG/help/plot tests)

---

## v1.4.x — Quality Enhancement (Master Perfection Plan)

> Complete **`.md` inventory** (19 curated sources): [`AUDIT.md`](AUDIT.md) § *Markdown corpus*; navigation: [`README.md`](README.md#-documentation-hub). Heavy tests **CI-first**: [`docs/CI.md`](docs/CI.md).

### High (🟡)

- ✅ Unit test coverage target range **50–70 %** — v1.10: Vitest thresholds **63 Lines · 55 Branches · 54 Functions · 62 Statements**; focus tests: RAG, help index, plot snap, AI streaming
- ✅ **E2E mobile selectors (2026-05-17)** — `clickNavItem()` helper + ARIA tabs in WriterViewUI + `data-testid` anchors in VersionControlPanel/ExportView; all 4 spec files migrated to 2026 golden hierarchy (CI gate green again)
- ✅ **CI hardening (2026-05-17)** — Stryker `break: 30` enforced, Lighthouse performance→error, OSV scanner in security job, concurrency fix (cancel-in-progress for PRs only), artifact retention unified, JUnit E2E upload
- ✅ **WebLLM model selector** — `WEBLLM_SUPPORTED_MODELS` (4 MLC checkpoints: Llama 3.2 1B/3B, Phi-3.5 Mini, Gemma 2 2B), `modelId`/`onProgress` parameters, Settings UI with dropdown + progress indicator (WCAG 2.2 `role="progressbar"`, `useRef` mounted guard) — [`packages/ai-core`](packages/ai-core), [`services/localAiFacade.ts`](services/localAiFacade.ts), [`components/settings/AiSections.tsx`](components/settings/AiSections.tsx)
- ✅ **Cross-project search v2 (2026-05-18)** — DB_VERSION 8, `projects-index-store`, `crossProjectIndexService.ts` (privacy-preserving IDB index), `searchAcrossProjectIndex()`, two-phase CrossProjectSearchPanel; indexing on save via listenerMiddleware is the next step
- ✅ **Cross-project search service v1** — `services/crossProjectSearchService.ts`, `searchAcrossProjects()` via fuzzyScore, transientUiStore integration (`isCrossProjectSearchOpen`), commandDefinitions command
- ✅ **Collaboration security warning** — security warning banner in CollaborationPanel (`role="alert"`, `aria-live="polite"`, WCAG 2.2 AA) visible before connection establishment; disappears after connect
- ✅ **Phase 1+2 unit tests** — 17 new test files, 733 tests total; Vitest thresholds raised to 35/30/22/33 (previously 25/21/17/24)
- ✅ **Stryker extension (phase 4)** — `fuzzyScore.ts`, `palettePreferences.ts`, `commandBuilder.ts` as additional mutation targets
- ✅ **E2E tests (phase 4)** — `commands.spec.ts` (palette Ctrl+K, "dashboard" search, fuzzy "wrt", Enter-navigate), `collaboration.spec.ts` (security warning banner visible before connection)
- ✅ **One-click** encrypted **library export** (ZIP + AES-GCM, META.json + vault.bin) — [`services/libraryBackupService.ts`](services/libraryBackupService.ts), Settings → Data
- ✅ **WebLLM** as selectable provider (`webllm/browser`, privacy same as Ollama) — [`services/aiProviderService.ts`](services/aiProviderService.ts), [`packages/ai-core`](packages/ai-core)

### Low (🟢)

- ✅ **i18n comprehensive sweep (2026-05-18)** — all hardcoded strings eliminated; 1 440 keys in 5 locales (`help.tryTour`, `Chapter 1`, `manifest.resizer.*`, `export.pasteSection.heading`, `outline.result.body`, `templates.tabs.*`, `error.boundary.*` and many more); ErrorBoundary refactored with `ErrorFallback` function component for `useTranslation()`; TypeScript 6 strict fixes (TS2322/TS2352/TS4111/TS2375); test mocks adjusted for `ErrorBoundary.test.tsx` + `AdvancedImportExport.test.tsx`
- ✅ Complete markdown documentation sync (README Hub, CONTRIBUTING, docs/CI, AUDIT, Copilot, CLAUDE, SECURITY, TAURI/graphify, CHANGELOG/ROADMAP/TODO) — 2026-05-16

---

## v1.2.0 — Security & Quality

### High (🟡)

- ✅ Expand E2E tests (project import, character CRUD, snapshot flow + auto-snapshot)
- ✅ StorageBackend interface — `services/storageBackend.ts` as contract, `StorageManager.saveProject(StoryProject)`
- ✅ Logger with ring buffer + sink for crash diagnostics

### Medium (🟠)

- ✅ Make signaling URL for collaboration configurable in Settings (`webrtcSignalingUrls`, Settings → Collaboration)
- ✅ **Yjs AES-256-GCM encryption foundation (2026-05-18)** — `collaborationService.ts` gains `encryptUpdate/decryptUpdate/deriveEncryptionKey/getEncryptionStatus`; CollaborationPanel shows encryption badge; full RTCDataChannel in-flight encryption requires y-webrtc patching (v2.0)

### Low (🟢)

- ✅ Documentation audit (CI.md, README Hub, CONTRIBUTING, AUDIT follow-up, Copilot/CLAUDE/SECURITY/Graphify) — 2026-05-02
- ✅ Visual regression (`tests/e2e/visual-regression.spec.ts`) — Chromium baseline under `tests/e2e/*-snapshots/` (`snapshotPathTemplate` without OS suffix)
- ✅ Bundle size budgets + rollup analysis in CI (`pnpm run bundle:budget`, `pnpm run analyze`, artifact `bundle-analysis`)
- ✅ FR/ES/IT key parity + CI gate (`pnpm run i18n:check`) — translation content can be improved iteratively
- ✅ Renovate auto-merge for patch updates ([`renovate.json`](renovate.json))
- ✅ Onboarding spotlight tour (`driver.js`, Dashboard + Help)
- ✅ **Tauri v2 release pipeline (2026-05-18)** — `tauri-build.yml` generates `latest.json` from signed `.sig` artifacts; `TAURI-UPDATER.md` has full secrets table; `TAURI-CI.md` has 7-step first-release checklist; macOS notarization + Windows Authenticode still require maintainer certificates

---

## Archived (v1.2.0 sprint — done)

- ✅ Expand E2E tests: project-import.spec.ts (3 tests), characters.spec.ts (4 tests), snapshots.spec.ts (4 tests)
- ✅ Ollama / local AI integration: ollamaService.ts + aiProviderService.ts + Settings UI complete, default model set to Qwen3 8B
- ✅ Split projectSlice.ts into thunk modules (14 AI thunks → `features/project/thunks/`)
- ✅ Tauri parity: 6 missing features — fileSystemService retry/compression/snapshot-ID/deleteImage/hasSavedData/auto-snapshot + Story Codex & RAG vectors (gap 3)
- ✅ Test suite expanded from ~80 to ~160+ tests (12 new test files)
- ✅ Node 24 localStorage polyfill (CI green on Node LTS + current)

## Archived (v1.1.2 hotfix — done)

- ✅ codexService infinite-loop fix (CRIT-1)
- ✅ Modal focus-trap cleanup consolidated (BUG-1)
- ✅ FOUC theme-init fixed (BUG-2)
- ✅ Untranslated languages removed from selector (CRIT-2)
- ✅ Dead code removed (buildDeduplicationKey, persist/PERSIST)
- ✅ ManuscriptView resize-listener cleanup (already fixed, TODO was stale)
- ✅ DevContainer configuration (already fixed, TODO was stale)
- ✅ Redundant deploy.yml (already fixed, TODO was stale)
- ✅ Feature-flag system (already fixed, TODO was stale)
- ✅ Request deduplication (abort-previous pattern in aiThunkUtils.ts)
