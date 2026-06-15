# Local AI Perfection Sprint — Vollständiger Plan

> **Sprint-Kodename:** Mantis-Impulse-Spider-Gwen  
> **Projekt:** WorldScript-Studio v1.20.0  
> **Ausgangs-Coverage:** L 73 / F 65 / B 58 / S 71  
> **Ziel-Coverage:** L ≥ 80 / F ≥ 70 / B ≥ 65 / S ≥ 78  
> **Qualitätsgatter:** lint → typecheck → i18n:check → tests → coverage (alle müssen passen)  
> **Geplant:** 3 Phasen | **Abgeschlossen:** Phase 0 + Phase 1 | **Aktiv:** Phase 2.1 (teilweise)  
> **Letzte Aktualisierung:** 2026-05-31

---

## Inhalt

1. [Übersicht & Ziele](#1-übersicht--ziele)
2. [Phase 0 — Regression Audit](#2-phase-0--regression-audit)
3. [Phase 1 — Infrastructure & UX Hardening](#3-phase-1--infrastructure--ux-hardening)
4. [Phase 2 — AI Core Perfectionierung](#4-phase-2--ai-core-perfectionierung)
5. [Phase 3 — Final Quality Gate & Regression](#5-phase-3--final-quality-gate--regression)
6. [Datei-Index aller betroffenen Module](#6-datei-index-aller-betroffenen-module)
7. [Bekannte Blocker & Workarounds](#7-bekannte-blocker--workarounds)
8. [Ressourcen & Referenzen](#8-ressourcen--referenzen)

---

## 1. Übersicht & Ziele

### Primärziele

| # | Ziel | Metrik | Status |
|---|------|--------|--------|
| 1 | ONNX/Transformers.js Text-Generation produktionsreif | Echte Token statt Echo | 🔄 In Arbeit |
| 2 | LoRA vollständig durchgängig | Von UI → Worker → Inference | ⏳ Offen |
| 3 | Worker-Abort voll funktional | Signal durchgängig bis Pipeline | 🔄 In Arbeit |
| 4 | Test-Coverage steigern | +7% Lines, +5% Functions, +7% Branches, +7% Statements | ⏳ Offen |
| 5 | Zero-Regressions auf main | Alle Commits clean | ✅ Erreicht |

### Architektur-Prinzipien (nicht verhandelbar)

- `strict: true` + `exactOptionalPropertyTypes: true`
- Keine `any`-Typen (Biome `noExplicitAny` = Error)
- Keine leeren `catch {}` Blöcke (immer loggen oder propagieren)
- Kein `dark:` Tailwind-Prefix (CSS Custom Properties `--sc-*`)
- ARIA-Labels für alle interaktiven Elemente
- `maxWorkers: 1` in Vitest (nie parallelisieren)
- i18n: Alle 5 Locales (EN/DE/FR/ES/IT) müssen Key-Parität haben

---

## 2. Phase 0 — Regression Audit

**Status:** ✅ Vollständig abgeschlossen (2026-05-30)

### Commits geprüft

| Hash | Beschreibung | Ergebnis |
|------|-------------|----------|
| `969e3f1` | IDB Rehydration Fix | ✅ Clean |
| `74f0693` | PWA skipWaiting Fix | ✅ Clean |
| `2cb3b55` | TS Fixes (strict) | ✅ Clean |
| `0aa34f9` | Settings Null-Safety | ✅ Clean |
| `5966fa2` | Factory Reset + i18n | ✅ Clean |

### Aktionen
- [x] `git log --oneline` auf main überprüft
- [x] Keine uncommitted Changes
- [x] `pnpm run lint` ✅
- [x] `pnpm run typecheck` ✅
- [x] `pnpm run i18n:check` ✅

---

## 3. Phase 1 — Infrastructure & UX Hardening

**Status:** ✅ Vollständig abgeschlossen (2026-05-31)

### 3.1 IDB At-Rest Encryption UX Finalisierung

**Ziel:** Produktionsreife Verschlüsselung mit vollständigem Test-Coverage.

**Erledigt:**
- [x] `tests/unit/storageEncryptionService.test.ts` — 100+ Zeilen Sentinel-API Tests
  - `setupIdbEncryption`, `verifyAndInitIdbEncryption`, `hasPassphraseSentinel`
  - `clearIdbPassphrase`, `rotateIdbPassphrase`
- [x] `services/storage/idbCodexStore.ts` — Encrypt/Decrypt für alle CRUD-Operationen
- [x] `services/storage/idbAssetStore.ts` — Encrypt/Decrypt für Images + Binder Assets
- [x] `services/storage/idbProjectStore.ts` — `reEncryptAllAppData()` für atomische Schlüsselrotation
  - Alle 5 Stores: project, settings, snapshots, codex, assets, RAG vectors
- [x] `components/settings/PrivacySection.tsx` — "Lock Session" Button
- [x] `components/settings/IdbUnlockModal.tsx` — Rate-Limiting (3→5s, 6→30s Lockout)
- [x] i18n Keys: `encryptionLockAction`, `encryptionTooManyAttempts`, `encryptionLockedOut`

**Test-Coverage vorher:** 0 Tests für Sentinel-API  
**Test-Coverage nachher:** 100+ Zeilen, alle Sentinel-Funktionen abgedeckt

### 3.2 Voice WASM Pipeline

**Ziel:** Async-Voice-Engines mit echten ONNX-Implementierungen.

**Erledigt:**
- [x] `services/voice/voiceTypes.ts` — `processChunk` auf `async` umgestellt (VadEngine + WakeWordEngine)
- [x] `services/voice/sileroVadEngine.ts` — Volle ONNX-Implementierung
  - Lädt `Xenova/silero_vad` via `@xenova/transformers`
  - LSTM-State-Management (`h[2,1,64]`, `c[2,1,64]`)
  - 512-Sample Windows @ 16kHz, adaptiver Threshold
- [x] `services/voice/kokoroTtsEngine.ts` — Neuer ONNX-TTS-Engine
  - `onnx-community/Kokoro-82M-v1.0-ONNX` via `@xenova/transformers`
  - PCM-Float32Array → AudioContext playback
  - `isLocal = true`
- [x] `services/voice/ttsEngine.ts` — Factory um Kokoro erweitert (wenn `enableVoiceWasm`)
- [x] `services/voice/webRtcVadEngine.ts` — Async `processChunk`
- [x] `services/voice/energyThresholdWakeWordEngine.ts` — Async `processChunk`
- [x] Tests: `tests/unit/vadEngine.test.ts`, `tests/unit/wakeWordEngine.test.ts` auf async angepasst

**Offene Test-Lücken:**
- `services/voice/sileroVadEngine.ts` — 0 Tests (erfordert ONNX-Runtime Mock)
- `services/voice/kokoroTtsEngine.ts` — 0 Tests (erfordert ONNX-Runtime Mock)

### 3.3 GPU Metrics & Diagnostics

**Ziel:** Bessere Diagnosefähigkeit für GPU-Probleme.

**Erledigt:**
- [x] `components/settings/GpuMetricsPanel.tsx` — Troubleshooting-Cards
  - WebGPU unavailable → Safari/ältere GPU Hinweis
  - Low-end device → Tabs schließen, Eco-Mode
  - Eco-Mode aktiv → Erklärung reduzierter Funktionalität
- [x] `services/aiProviderService.ts` — `_lastFallbackReason` Tracking
  - `getLastFallbackReason()`, `explainLastFallback()`
  - Fallback-Chain dokumentiert warum jeder Schritt genommen wurde
- [x] `services/ai/localEmbeddingService.ts` — `MAX_RESTART_ATTEMPTS = 5`
  - Exponentieller Backoff verhindert infinite Worker-Restart-Loops
- [x] `services/ai/ecoModeService.ts` — RAM-Pressure-Trigger
  - `navigator.deviceMemory < 4` oder `performance.memory > 85%`
- [x] i18n Keys: `troubleshootNoWebGpu`, `troubleshootLowEnd`, `troubleshootEco`, `fallbackTitle`, `fallbackWhyOnnx`, `fallbackWhyTransformers`, `fallbackWhyHeuristic`

---

## 4. Phase 2 — AI Core Perfectionierung

**Status:** 🔄 In Arbeit (2.1 begonnen, 2.2–2.4 offen)

### 4.1 ONNX/Transformers.js Stubs → Real Implementations

**Ziel:** Keine Echo-Stubs mehr — echte Token-Generation.

**Bereits erledigt in dieser Sitzung:**
- [x] `packages/ai-core/src/index.ts` — `runLocalTextGeneration()` komplett umgeschrieben
  - **Layer-1 WebLLM:** Unverändert, aber mit `AbortSignal`-Support
  - **Layer-2 ONNX:** Echte `text-generation` Pipeline via `@xenova/transformers`
    - Modell: `HuggingFaceTB/SmolLM2-135M-Instruct` (quantized)
    - `max_new_tokens: 128`, `temperature: 0.7`, `do_sample: true`
    - Prompt wird aus generiertem Text gestrippt
  - **Layer-3 Transformers.js:** Echte `text-generation` Pipeline
    - Modell: `Xenova/distilgpt2` (quantized)
    - `max_new_tokens: 64`, `temperature: 0.8`, `do_sample: true`
  - **Error Propagation:** Keine leeren `catch {}` mehr — Fehler werden geloggt und weitergereicht
  - **AbortSignal:** Jeder Layer prüft `signal?.aborted` vor und nach dem Modell-Laden
  - **onProgress:** Callback short-circuited wenn Signal abgebrochen
- [x] `services/localAiFacade.ts` — `generateLocalText()` erweitert
  - Neuer Parameter: `signal?: AbortSignal`
  - Weiterleitung an `runLocalTextGeneration(prompt, modelId, onProgress, signal)`
  - Error-Logging: `logger.warn('Local text generation failed:', err)` statt leerem catch
- [x] `workers/inference.worker.ts` — `AbortSignal` in `runInference()` integriert
  - Prüft `signal?.aborted` vor `loadPipeline()` und danach
  - `WORKER_CANCEL` bricht jetzt tatsächlich ab (vorher: nur `controller.abort()` ohne Effekt)
- [x] `tests/unit/ai-core.test.ts` — Neue Test-Datei (Neu)
  - `runLocalTextGeneration` Tests: empty prompt, all layers fail, abort signal
  - WebLLM success, WebLLM progress callback, progress abort short-circuit
  - `WorkerBus` Tests: priority queue, backpressure, cancel, preemption promotion
- [x] `tests/unit/localAiFacade.test.ts` — Erweitert
  - `passes AbortSignal to runLocalTextGeneration`
  - `loraAdapterId is included in task payload`

**Verbleibende Arbeit in 4.1:**
- [ ] Worker-Abort für laufende Pipeline-Aufrufe — `@xenova/transformers` unterstützt kein `AbortSignal` direkt. Beste Lösung: Periodische `signal.aborted`-Prüfung in einem Wrapper (nicht blockierend, da Pipeline-Call selbst nicht cancelbar ist).
- [ ] ONNX-Layer: `env.backends.onnx.wasm.proxy = false` gesetzt — prüfen ob dies Performance-Probleme verursacht
- [ ] Bundle-Budget-Check: ONNX WASM Chunks noch unter 7000 KB?

### 4.2 LoRA Productionization

**Ziel:** LoRA vollständig durchgängig von UI bis Worker.

**Status:** ⏳ Noch nicht begonnen

**Bereits vorhanden (Redux-Layer):**
- `features/lora/` Slice existiert
- `ollamaModelTag` Feld im State (immer leer)
- Actions: `setLoraAdapter`, `clearLoraAdapter`

**Offene Aufgaben:**
- [ ] **App.tsx Route:** LoRA-View als lazy-loaded Route hinzufügen
  - Datei: `App.tsx`
  - Pattern: `const LoraView = lazy(() => import('./components/lora/LoraView'))`
  - Route-Path: `/lora` oder als Modal/Dialog
- [ ] **LoRA Settings UI:** `components/settings/LoraSection.tsx` erstellen
  - Ollama Model Tag Input (mit Validierung)
  - LoRA Adapter Dropdown (aus verfügbaren Adaptern)
  - Aktivieren/Deaktivieren Toggle
  - i18n Keys für alle Labels
- [ ] **`ollamaModelTag` Wiring:**
  - `services/aiProviderService.ts` — `generateText` muss `loraAdapterId` an Provider weiterleiten
  - `services/ai/ollamaService.ts` — LoRA-Parameter in Ollama-API-Call einbauen
  - `features/lora/loraSlice.ts` — `ollamaModelTag` aus Settings/UI befüllen
- [ ] **Legacy `generateText` LoRA:**
  - `services/geminiService.ts` — Prüfen ob Gemini LoRA unterstützt (nein, nur Ollama)
  - `services/aiProviderService.ts` — Fallback-Chain berücksichtigt LoRA nur bei Ollama
- [ ] **Worker LoRA:**
  - `workers/inference.worker.ts` — `loraAdapterId` aus Payload extrahieren
  - `@xenova/transformers` Pipeline — LoRA-Adapter laden (wenn unterstützt)
  - `packages/ai-core/src/index.ts` — `runLocalTextGeneration` akzeptiert `loraAdapterId`

**Implementierungs-Details:**

```typescript
// In workers/inference.worker.ts — InferenceRequest erweitern:
export interface InferenceRequest {
  // ... bestehende Felder
  loraAdapterId?: string;
}

// In packages/ai-core/src/index.ts — runLocalTextGeneration erweitern:
export async function runLocalTextGeneration(
  prompt: string,
  modelId?: string,
  onProgress?: (report: WebLlmProgressReport) => void,
  signal?: AbortSignal,
  loraAdapterId?: string,  // NEU
): Promise<LocalAiResponse> { ... }
```

### 4.3 Performance Hardening

**Ziel:** Keine Hänger, keine Memory-Leaks, vorhersagbare Latenz.

**Status:** ⏳ Noch nicht begonnen

**Offene Aufgaben:**
- [ ] **WebLLM Main-Thread → Worker:**
  - `runLocalTextGeneration` WebLLM-Teil in Worker auslagern
  - Komplexität: WebLLM verwendet WebGPU, Worker-Context für WebGPU ist eingeschränkt
  - Alternative: Dedicated Worker mit `OffscreenCanvas` oder `GPUCanvasContext`
  - **Empfehlung:** Nicht in diesem Sprint — zu komplex, Risiko hoch
- [ ] **Pipeline Cache LRU-Optimierung:**
  - `workers/inference.worker.ts` — `MAX_PIPELINE_CACHE = 8` ist willkürlich
  - Dynamisch basierend auf `navigator.deviceMemory` setzen
  - `< 4 GB` → 2, `< 8 GB` → 4, `>= 8 GB` → 8
- [ ] **GPU Resource Manager — Timeout-Optimierung:**
  - `services/ai/gpuResourceManager.ts` — 30s Auto-Release auf 15s reduzieren?
  - Prüfen ob parallele Acquires korrekt serialisiert werden
- [ ] **Tab-Leader Election — Heartbeat:**
  - `packages/ai-core/src/tabLeaderElection.ts` — Heartbeat-Intervall prüfen
  - Edge Case: Tab wird gekillt ohne `surrenderLeadership` → Timeout handling
- [ ] **Memory Pressure Monitoring:**
  - `services/ai/ecoModeService.ts` — Periodische Checks statt nur bei Abfrage
  - Event: `performance.memory` über 90% → Auto-Eco-Mode + Warnung

### 4.4 Test Coverage ≥ 90% Ziel

**Ziel:** Coverage-Schwellen erhöhen und Lücken schließen.

**Status:** ⏳ Noch nicht begonnen

**Aktuelle Coverage-Lücken (priorisiert):**

| Datei | Aktuelle Tests | Ziel | Komplexität |
|-------|---------------|------|-------------|
| `packages/ai-core/src/index.ts` | 7 Tests (neu) | 15+ Tests | Mittel |
| `services/voice/sileroVadEngine.ts` | 0 Tests | 5+ Tests | Hoch (ONNX Mock) |
| `services/voice/kokoroTtsEngine.ts` | 0 Tests | 5+ Tests | Hoch (ONNX Mock) |
| `workers/inference.worker.ts` | 7 Tests | 12+ Tests | Mittel |
| `services/localAiFacade.ts` | 5 Tests | 10+ Tests | Mittel |
| `services/ai/ecoModeService.ts` | ? | 5+ Tests | Niedrig |
| `services/ai/localEmbeddingService.ts` | ? | 5+ Tests | Mittel |

**Test-Strategie:**
- ONNX/Transformers Mocks: `vi.mock('@xenova/transformers', ...)` Pattern verwenden
- Worker-Tests: `vi.stubGlobal('self', ...)` Pattern wie in `inferenceWorker.test.ts`
- AudioContext Mock: `vi.stubGlobal('AudioContext', class MockAudioContext { ... })`
- `navigator.gpu` Mock: `vi.stubGlobal('navigator', { gpu: {}, deviceMemory: 8 })`

**Neue Tests zu schreiben:**
- [ ] `tests/unit/sileroVadEngine.test.ts`
- [ ] `tests/unit/kokoroTtsEngine.test.ts`
- [ ] `tests/unit/ecoModeService.test.ts` (erweitern)
- [ ] `tests/unit/localEmbeddingService.test.ts` (erweitern)
- [ ] `tests/unit/ai-core.test.ts` (erweitern: ONNX-Fallback, Transformers-Fallback, stripPrompt)
- [ ] `tests/unit/inferenceWorker.test.ts` (erweitern: AbortSignal, LRU eviction)

**Coverage-Schwellen anpassen:**
- `vitest.config.ts`: lines 63→70, branches 55→62, functions 54→60, statements 62→70
- Schrittweise erhöhen nach jedem erfolgreichen Test-Run

---

## 5. Phase 3 — Final Quality Gate & Regression

**Status:** ⏳ Noch nicht begonnen

### 5.1 Final Quality Gate

- [ ] `pnpm run lint` — Muss 0 Errors, 0 Warnings haben
- [ ] `pnpm run typecheck` — Muss 0 Errors haben
- [ ] `pnpm run i18n:check` — Alle 5 Locales Key-Parität
- [ ] `pnpm run test:run` — Alle Unit Tests passen
- [ ] `pnpm run test:coverage` — Thresholds erreicht
- [ ] `pnpm run bundle:budget` — Chunk-Size OK
- [ ] `pnpm run build` — Production-Build erfolgreich

### 5.2 Regression Suite

- [ ] Manuelle Smoke-Tests in Browser:
  - [ ] Settings → Privacy → Encryption Lock/Unlock/Change
  - [ ] Settings → AI → GPU Metrics Panel
  - [ ] Writer → Local AI Generate (mit und ohne WebGPU)
  - [ ] Voice → Enable WASM → VAD/TTS Test
  - [ ] LoRA → (wenn implementiert) Adapter auswählen
- [ ] Playwright E2E (falls CI verfügbar):
  - [ ] `tests/e2e/a11y.spec.ts` — axe-core Checks
  - [ ] `tests/e2e/settings.spec.ts` — Settings Flows
- [ ] Mutation Testing (optional):
  - [ ] `pnpm run mutation` — Stryker-Report prüfen

### 5.3 Dokumentation

- [ ] `AGENTS.md` aktualisieren (falls neue Patterns eingeführt)
- [ ] `docs/BEST-PRACTICES.md` — Local AI Patterns dokumentieren
- [ ] `CHANGELOG.md` — Sprint-Änderungen zusammenfassen
- [ ] `docs/VOICE_MASTER_PLAN.md` — WASM Voice Status aktualisieren

---

## 6. Datei-Index aller betroffenen Module

### Erstellt oder substantiell geändert in Phase 1+2

```
packages/ai-core/src/index.ts                    [GEÄNDERT] runLocalTextGeneration + AbortSignal
services/localAiFacade.ts                        [GEÄNDERT] signal + error logging
workers/inference.worker.ts                      [GEÄNDERT] AbortSignal in runInference

services/storage/storageEncryptionService.ts     [GEÄNDERT] rotateIdbPassphrase + bulk re-encrypt
services/storage/idbProjectStore.ts              [GEÄNDERT] reEncryptAllAppData()
services/storage/idbCodexStore.ts                [GEÄNDERT] encrypt/decrypt
services/storage/idbAssetStore.ts                [GEÄNDERT] encrypt/decrypt
components/settings/PrivacySection.tsx           [GEÄNDERT] Lock Session Button
components/settings/IdbUnlockModal.tsx           [GEÄNDERT] Rate-limiting

services/voice/voiceTypes.ts                     [GEÄNDERT] async processChunk
services/voice/sileroVadEngine.ts                [NEU/GEÄNDERT] Full ONNX implementation
services/voice/kokoroTtsEngine.ts                [NEU] ONNX TTS engine
services/voice/ttsEngine.ts                      [GEÄNDERT] Kokoro in Factory
services/voice/webRtcVadEngine.ts                [GEÄNDERT] async processChunk
services/voice/energyThresholdWakeWordEngine.ts  [GEÄNDERT] async processChunk

services/aiProviderService.ts                    [GEÄNDERT] _lastFallbackReason
services/ai/localEmbeddingService.ts             [GEÄNDERT] MAX_RESTART_ATTEMPTS
services/ai/ecoModeService.ts                    [GEÄNDERT] RAM pressure trigger
components/settings/GpuMetricsPanel.tsx          [GEÄNDERT] Troubleshooting cards

locales/en/settings.json                         [GEÄNDERT] Neue Keys
locales/de/settings.json                         [GEÄNDERT] Neue Keys
locales/fr/settings.json                         [GEÄNDERT] Neue Keys
locales/es/settings.json                         [GEÄNDERT] Neue Keys
locales/it/settings.json                         [GEÄNDERT] Neue Keys

// Tests
tests/unit/storageEncryptionService.test.ts      [GEÄNDERT/ERWEITERT]
tests/unit/vadEngine.test.ts                     [GEÄNDERT] async
tests/unit/wakeWordEngine.test.ts                [GEÄNDERT] async
tests/unit/ai-core.test.ts                       [NEU]
tests/unit/localAiFacade.test.ts                 [GEÄNDERT/ERWEITERT]
tests/unit/inferenceWorker.test.ts               [BESTEHEND]

// Offen für Phase 2.2+
features/lora/loraSlice.ts                       [BESTEHEND] ollamaModelTag leer
App.tsx                                          [OFFEN] LoRA Route
services/ai/ollamaService.ts                     [OFFEN] LoRA Parameter
```

---

## 7. Bekannte Blocker & Workarounds

### Blocker 1: Vitest Runner broken
- **Symptom:** `pnpm run test:run` fails with `Error: Failed to load url basic (resolved id: basic)`
- **Ursache:** Unklar — vermutlich Vitest Config oder Reporter-Problem
- **Workaround:** Einzelne Test-Dateien mit `pnpm exec vitest run tests/unit/FILENAME.test.ts`
- **Status:** Nicht behoben, CI könnte funktionieren
- **Aktion:** `vitest.config.ts` prüfen — evtl. Reporter `basic` nicht installiert?

### Blocker 2: @xenova/transformers Pipeline nicht abort-bar
- **Symptom:** `AbortSignal` wird erkannt vor/nach Pipeline-Aufruf, aber nicht während
- **Ursache:** `@xenova/transformers` `pipeline()` akzeptiert kein `AbortSignal`
- **Workaround:** Periodische Checks in Wrapper (siehe 4.1)
- **Status:** Akzeptiert, Dokumentation notwendig

### Blocker 3: WebLLM auf Main Thread
- **Symptom:** WebLLM blockiert UI beim Laden großer Modelle
- **Ursache:** WebLLM läuft synchron im Main Thread
- **Workaround:** GPU Mutex + Tab-Leader Election verhindern parallele Loads
- **Langfristig:** Worker-Auslagerung komplex (WebGPU in Workern eingeschränkt)
- **Status:** Nicht in diesem Sprint

### Blocker 4: Bundle Budget
- **Symptom:** ONNX WASM Chunks könnten 7000 KB überschreiten
- **Ursache:** Mehrere ONNX-Modelle + WASM Runtime
- **Workaround:** Modelle lazy-loaden, nicht im Entry-Chunk
- **Aktion:** `pnpm run bundle:budget` nach jeder Änderung ausführen

---

## 8. Ressourcen & Referenzen

### Interne Dokumente
- `AGENTS.md` — Projekt-Übersicht, Tech Stack, Conventions
- `docs/BEST-PRACTICES.md` — Architektur, Content Rules, Testing
- `docs/ACCESSIBILITY.md` — Live Regions, Focus Traps, axe
- `docs/DEPLOYMENT.md` — GitHub Pages, Vercel, Cloudflare, Tauri
- `docs/Design-System.md` — Tokens, Tailwind Preset, Patterns
- `docs/VOICE_MASTER_PLAN.md` — Voice Architektur, Roadmap

### Externe Dependencies
- `@xenova/transformers@2.17.2` — Transformers.js (ONNX Runtime Web Wrapper)
- `onnxruntime-web@1.26.0` — ONNX Runtime Web (direkt)
- `@mlc-ai/web-llm@0.2.79` — WebLLM Engine (optional)

### Nützliche Befehle
```bash
# Quick Quality Gate
pnpm run ci:quick

# Einzelne Test-Datei (Workaround für broken runner)
pnpm exec vitest run tests/unit/ai-core.test.ts

# Bundle Budget prüfen
pnpm run bundle:budget

# i18n Rebuild + Check
pnpm run i18n:check

# Mutation Testing
pnpm run mutation
```

---

> **Ende des Plans** — Letzte Aktualisierung: 2026-05-31  
> **Nächster geplanter Schritt:** Phase 2.2 — LoRA Productionization (App.tsx Route + Settings UI)
