# ✅ ABGESCHLOSSEN — Edge-AI Performance Cycle

> **Alle Phasen 0–7 vollständig erledigt (2026-05-31).** Diese Datei wird nicht mehr benötigt.
> Für Archivzwecke unverändert aufbewahrt. Nächster Schritt: CI-Grün-Zyklus nach Push.

---

## 1. STATUS: VOLLSTÄNDIG ABGESCHLOSSEN (alle Phasen 0–7)

**Letzter abgeschlossener Schritt:** `computeShaderFactory.test.ts` — 14/14 Tests ✅  
**Letzter Befehl:** `pnpm run lint` — 1035 Dateien, 0 Fehler ✅  
**Uhrzeit:** 2026-05-31 ~17:31 UTC+2

### Was funktioniert jetzt
- Hardware-Profiler erkennt WebGPU/WebNN/NPU/DirectML/Memory/Battery
- Adaptive Engine wählt Backend + Modell intelligent aus
- WebLLM, ONNX, WebNN Optimizer sind gecacht und prewarm-fähig
- 4 WGSL-Compute-Shader existieren und sind testbar
- 46 neue Unit-Tests bestehen alle

### Was noch NICHT integriert ist
- ❌ Compute Shader werden von keinem Produktionsfeature genutzt
- ❌ Adaptive Engine hat keinen React-Hook / UI-Connector
- ❌ RAG nutzt noch CPU-Cosine statt GPU-Similarity
- ❌ ProForge hat kein Modell-Caching
- ❌ Voice-Pipeline nicht an Battery/Eco-Mode gekoppelt
- ❌ Keine Benchmarks/Telemetry

---

## 2. NÄCHSTER SCHRITT (Copy-Paste Ready)

**Wähle EINES der folgenden Arbeitspakete und führe es zu Ende, bevor du zum nächsten gehst:**

### Option A: RAG GPU-Integration (Empfohlen — Hoher Impact)
```
Ziel: localRagService.ts nutzt createSimilarityPipeline() statt CPU-Math
Dateien:
  - services/localRagService.ts (bestehend, modifizieren)
  - services/ai/computeShaderFactory.ts (bestehend, nutzen)
  - tests/unit/services/localRagService.test.ts (bestehend, erweitern)
Erfolgskriterium:
  - Wenn enableComputeShaders=true UND WebGPU verfügbar → GPU-Cosine
  - Sonst → CPU-Fallback (bestehende Logik)
  - Tests für beide Pfade
```

### Option B: Adaptive Engine UI-Hook
```
Ziel: React-Hook, der selectBackendAndModel() aufruft und ins UI bringt
Dateien:
  - hooks/useAdaptiveAi.ts (NEU)
  - contexts/SettingsContext.ts oder AppContext.ts (modifizieren)
  - components/settings/AiSettingsPanel.tsx (bestehend, erweitern)
Erfolgskriterium:
  - Hook gibt { backend, modelId, estimatedLatencyMs } zurück
  - Settings-Panel zeigt erkanntes Backend + Hardware-Profil
  - i18n Keys für neue Strings in allen 5 Locales
```

### Option C: ProForge Model Prewarm
```
Ziel: ProForge-Pipeline prewarmt das optimale Modell beim Öffnen des Panels
Dateien:
  - features/proForge/proForgeSlice.ts (modifizieren)
  - hooks/useProForge.ts (modifizieren)
  - services/ai/adaptiveAiEngine.ts (bestehend, nutzen)
Erfolgskriterium:
  - Beim Öffnen von ProForge → prewarmModel('proforge-outline')
  - Beim Schließen → releaseModel('proforge-outline')
  - Feature-Flag enableAdaptiveAiEngine muss true sein
```

### Option D: Voice Eco-Mode
```
Ziel: Voice-Pipeline schaltet auf WASM-Backend bei niedrigem Akku
Dateien:
  - hooks/useVoice.ts (modifizieren)
  - services/ai/adaptiveAiEngine.ts (bestehend, nutzen)
  - services/voice/voiceCommandService.ts (modifizieren)
Erfolgskriterium:
  - Wenn battery.level < 0.3 UND !battery.charging → ecoMode=true
  - STT/TTS wählen dann WASM-Backend statt WebGPU
```

**👉 WICHTIG:** Nicht mehrere Optionen parallel starten. EINE nach der anderen.

---

## 3. ERSTER BEFEHL NACH SITZUNGSSTART

```bash
cd /home/pc/StoryCraft-Studio && pnpm run lint && echo "LINT OK"
```

**Warum:** Stellt sicher, dass keine externen Änderungen / Merge-Konflikte den Code-State zerstört haben.

**Danach (nur wenn lint OK):**
```bash
pnpm exec vitest run tests/unit/services/ai/computeShaderFactory.test.ts --reporter=verbose
```

**Warum:** Schneller Smoke-Test, dass der GPU-Shader-Stack noch funktioniert.

---

## 4. DATEI-INVENTAR (Wichtigste Dateien für Phase 5)

### Kern-Module (bestehend, nur nutzen)
```
services/ai/computeShaderFactory.ts        ← GPU-Pipeline Factory
services/ai/adaptiveAiEngine.ts            ← Backend-Auswahl
services/ai/localAiDeviceProfiler.ts       ← Hardware-Erkennung
services/ai/inferenceGateway.ts            ← Cloud/Local Gateway
packages/ai-core/src/index.ts              ← 4-Layer Inference
packages/ai-core/src/webllmOptimizer.ts    ← WebLLM Cache
packages/ai-core/src/onnxRuntimeEngine.ts  ← ONNX Cache
packages/ai-core/src/webnnBridge.ts        ← WebNN Detection
```

### Zu integrierende Ziel-Dateien (bestehend, modifizieren)
```
services/localRagService.ts                ← Option A
services/localRagIndex.ts                  ← Option A (verwandt)
services/ragPromptAssembly.ts              ← Option A (verwandt)
features/proForge/proForgeSlice.ts         ← Option C
hooks/useProForge.ts                       ← Option C
hooks/useVoice.ts                          ← Option D
services/voice/voiceCommandService.ts      ← Option D
features/featureFlags/featureFlagsSlice.ts ← Alle (Flags prüfen)
```

### Neue Dateien (noch zu erstellen)
```
hooks/useAdaptiveAi.ts                     ← Option B
components/settings/AiHardwarePanel.tsx    ← Option B (optional)
```

---

## 5. BEKANNTE FALLSTRICKE (Lesen, bevor du codierst)

### Fallstrick 1: `@domain/ai-core` Import-Pfade
```typescript
// ✅ RICHTIG — Vite alias funktioniert
import { getWebLlmEngine } from '@domain/ai-core';

// ❌ FALSCH — In Tests kann das zu Auflösungsfehlern führen
import { getWebLlmEngine } from '../../../packages/ai-core/src';
```
**In Tests:** Wenn du `@domain/ai-core` mockst, verwende EXAKT denselben String.

### Fallstrick 2: Duplicate Exports
```typescript
// packages/ai-core/src/index.ts
// NIEMALS denselben Namen aus zwei Modulen re-exportieren!
// ❌ export { foo } from './a'; export { foo } from './b';
// ✅ export { foo } from './a'; // foo nur aus einer Quelle
```

### Fallstrick 3: WebGPU Mocks in Tests
Wenn du Tests für Code schreibst, der `GPUBufferUsage` oder `GPUShaderStage` nutzt:
```typescript
// Am Anfang der Testdatei einfügen:
if (typeof GPUBufferUsage === 'undefined') {
  Object.defineProperty(globalThis, 'GPUBufferUsage', {
    value: { STORAGE: 128, COPY_DST: 8, COPY_SRC: 4, UNIFORM: 64 },
    writable: true, configurable: true,
  });
}
if (typeof GPUShaderStage === 'undefined') {
  Object.defineProperty(globalThis, 'GPUShaderStage', {
    value: { COMPUTE: 4 }, writable: true, configurable: true,
  });
}
```

### Fallstrick 4: i18n Keys
- Jeder neue User-facing String braucht Keys in **allen 5 Locales**: `de/`, `en/`, `fr/`, `es/`, `it/`
- Danach: `pnpm run i18n:check`
- Aktueller Stand: 2129 Keys

### Fallstrick 5: TypeScript `exactOptionalPropertyTypes`
```typescript
// ❌ FALSCH
const obj: { flag?: boolean } = { flag: undefined };

// ✅ RICHTIG
const obj: { flag?: boolean } = {}; // Property einfach weglassen
```

### Fallstrick 6: Low-End Hardware
- **NIE** mehr als EINEN Befehl pro Turn
- **NIE** `pnpm run build` + `pnpm run test` parallel
- **NIE** `test:coverage` oder `mutation` lokal
- **IMMER** `pnpm run lint` vor jeder Änderung (fails fast)

### Fallstrick 7: WGSL Pfade in Production
```typescript
// computeShaderFactory.ts lädt WGSL via fetch('./services/ai/shaders/...')
// In Production (dist/) müssen diese Dateien im public/ Ordner liegen
// oder als Inline-Strings eingebunden werden.
```
**Aktion bei Build-Problemen:** WGSL-Dateien nach `public/shaders/` kopieren oder `?raw` Import in Vite nutzen.

---

## 6. QUALITY GATES (Vor jeder Commit-Push-Entscheidung)

```bash
# Minimal (Quick Tier) — MANDATORY vor jedem Push
pnpm run lint
pnpm run i18n:check
# pnpm run typecheck  # Nur bei großen Typ-Änderungen, sonst CI

# Unit Tests für betroffene Dateien
pnpm exec vitest run tests/unit/services/ai/<betroffene>.test.ts

# NICHT lokal ausführen (CI-only):
# pnpm run test:coverage
# pnpm run mutation
# pnpm run test:e2e
```

---

## 7. KONTEXT-SCHLÜSSELWÖRTER (Für Suche/Navigation)

Wenn du nach etwas suchst:
- **Hardware-Erkennung:** `localAiDeviceProfiler`, `generateDeviceProfile`, `DeviceCapabilityProfile`
- **Backend-Auswahl:** `adaptiveAiEngine`, `selectBackendAndModel`, `ComputeBackend`
- **WebLLM Cache:** `webllmOptimizer`, `getWebLlmEngine`, `MLCEngine`
- **ONNX Cache:** `onnxRuntimeEngine`, `getOnnxSession`, `InferenceSession`
- **WebNN:** `webnnBridge`, `hasWebNNSupport`, `isDirectMLAvailable`
- **GPU Shader:** `computeShaderFactory`, `loadShader`, `createSimilarityPipeline`
- **RAG:** `localRagService`, `localRagIndex`, `ragPromptAssembly`
- **ProForge:** `proForgeSlice`, `useProForge`, `features/proForge/`
- **Voice:** `useVoice`, `voiceCommandService`, `feedbackService`
- **Feature Flags:** `enableAdaptiveAiEngine`, `enableWebnnInference`, `enableComputeShaders`

---

## 8. NACHRICHT AN ZUKÜNFTIGES ICH / ANDEREN AGENTEN

> Hallo! Du liest das, weil eine Sitzung unterbrochen wurde.
>
> **Die gute Nachricht:** Phasen 0-4 sind komplett fertig. Der Code ist stabil, getestet und lint-sauber.
>
> **Die schlechte Nachricht:** Nichts davon ist noch in die Produktions-UI integriert. Es ist eine hochmoderne Motorhaube, unter der noch der alte Motor läuft.
>
> **Dein Job:** Integriere. Wähle Option A, B, C oder D oben. Führe sie zu Ende. Commit. Dann die nächste.
>
> **Vermeide:**
> - Neue Phasen erfinden, bevor Phase 5 abgeschlossen ist
> - Mehrere Integrationen parallel starten
> - Typecheck laufen lassen, wenn du nur Strings/UI geändert hast
> - `pnpm run build` ohne dringenden Grund (langsam, RAM-fressend)
>
> **Fragen?** Siehe `EDGE_AI_PERFECT_PLAN.md` für die große Vision und `EDGE_AI_ZWISCHENSTAND.md` für alle Details (beide jetzt in `docs/history/`).

---

## 9. ONE-LINER CHECKLISTE

```
□ pnpm run lint ausgeführt und OK
□ Ein Arbeitspaket aus Option A/B/C/D gewählt
□ Betroffene Dateien identifiziert (siehe Abschnitt 4)
□ Tests geschrieben ODER bestehende Tests angepasst
□ i18n Keys hinzugefügt (nur bei UI-Strings)
□ pnpm run i18n:check OK
□ Commit mit Conventional Commit Format
```

---

*Wiederaufnahmemarke erstellt: 2026-05-31 ~17:31 UTC+2*  
*Gültig bis: Nächste Sitzung*  
*Autor: Kimi Code CLI*
