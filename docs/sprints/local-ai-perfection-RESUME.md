# Local AI Perfection Sprint — Wiederaufnahmemarke

> **Sprint:** Mantis-Impulse-Spider-Gwen  
> **Erstellt:** 2026-05-31 11:08 CEST  
> **Für:** Nächste Entwicklungssitzung  
> **Status beim Abbrechen:** Phase 2.1 ~80% abgeschlossen, Phase 2.2 noch nicht begonnen

---

## TL;DR — Was muss als Erstes passieren?

1. **Quality Gate ausführen:** `pnpm run lint && pnpm run typecheck && pnpm run i18n:check`
2. **Bundle Budget prüfen:** `pnpm run bundle:budget`
3. **Phase 2.1 abschließen** (optional: Worker Midflight-Abort)
4. **Phase 2.2 starten:** LoRA Productionization

---

## Wiederaufnahme-Checkliste

### □ Schritt 0: Umgebung vorbereiten (5 Min)

```bash
# 1. Git-Status prüfen
#    → Es sollten keine uncommitted Changes sein (alle Änderungen sind in docs/sprints/)
git status

# 2. Dependencies aktuell?
pnpm install

# 3. Node-Version prüfen
node --version  # Sollte >= 22.0.0
```

### □ Schritt 1: Quality Gate (10 Min)

```bash
# Alle drei müssen passen:
pnpm run lint
pnpm run typecheck
pnpm run i18n:check

# Wenn einer fehlschlägt → SOFORT fixen bevor weitergearbeitet wird
```

**Bekannte Probleme:**
- `vitest` Runner ist broken (`Failed to load url basic`). Workaround:
  ```bash
  pnpm exec vitest run tests/unit/ai-core.test.ts
  pnpm exec vitest run tests/unit/localAiFacade.test.ts
  pnpm exec vitest run tests/unit/inferenceWorker.test.ts
  ```

### □ Schritt 2: Bundle Budget prüfen (5 Min)

```bash
pnpm run build
pnpm run bundle:budget
```

**Wichtig:** ONNX WASM Chunks könnten größer geworden sein durch echte Pipelines.  
**Thresholds:** Total < 7000 KB, Entry < 4500 KB.

### □ Schritt 3: Phase 2.1 Restarbeiten (Optional — 30–60 Min)

**Datei:** `workers/inference.worker.ts`

**Problem:** `@xenova/transformers` Pipeline unterstützt kein `AbortSignal`. Wenn ein langer Inference-Call läuft und `WORKER_CANCEL` empfangen wird, läuft die Inference trotzdem zu Ende — nur das Ergebnis wird nicht gepostet.

**Lösungsansatz:**
```typescript
// In runInference(), nach dem Pipeline-Aufruf:
// Aktuell:
rawResult = await (pipe as ...)(req.input, opts);

// Besser (wenn Transformers.js es irgendwann unterstützt):
rawResult = await (pipe as ...)(req.input, { ...opts, signal });

// Workaround (jetzt implementierbar):
// Da pipeline nicht cancelbar ist, akzeptieren wir das.
// Wir prüfen signal.aborted NACH dem Call und werfen ggf. weg.
```

**Entscheidung:** Diese Restarbeit ist **optional** und hat niedrige Priorität. Überspringen und direkt zu Phase 2.2 gehen ist OK.

### □ Schritt 4: Phase 2.2 — LoRA Productionization (Hauptaufgabe)

**Ziel:** LoRA vollständig durchgängig von UI bis Worker.

#### 4a. App.tsx Route hinzufügen

**Datei:** `App.tsx`

**Pattern:**
```typescript
// Suchen nach anderen lazy-loaded Views
const LoraView = lazy(() => import('./components/lora/LoraView'));

// In der Route-Definition hinzufügen:
<Route path="/lora" element={<LoraView />} />
```

**Zu klären:** Soll LoRA eine eigene Route oder ein Dialog/Modal in den Settings sein?  
**Empfehlung:** Erstmal als Settings-Section (wie GPU Metrics), da LoRA ein Konfigurations-Feature ist.

#### 4b. LoRA Settings UI erstellen

**Neue Datei:** `components/settings/LoraSection.tsx`

**Anforderungen:**
- [ ] Ollama Model Tag Input (Textfeld mit Validierung)
- [ ] LoRA Adapter Dropdown (statisch: "None", "Creative Writing", "Technical", etc.)
- [ ] Aktivieren/Deaktivieren Toggle
- [ ] Info-Text was LoRA ist
- [ ] i18n Keys für alle Strings

**Pattern:**
```typescript
// Analog zu GpuMetricsPanel.tsx oder PrivacySection.tsx
// useSettings() Hook für State
// useTranslation() für Texte
```

**i18n Keys (neu, alle 5 Locales):**
```json
{
  "settings.lora.title": "LoRA Adapters",
  "settings.lora.description": "Low-Rank Adaptation for local AI models",
  "settings.lora.ollamaModelTag": "Ollama Model Tag",
  "settings.lora.adapterLabel": "Adapter",
  "settings.lora.adapterNone": "None",
  "settings.lora.enabled": "Enable LoRA"
}
```

#### 4c. Redux → Service Wiring

**Dateien:**
- `features/lora/loraSlice.ts` — Prüfen ob `ollamaModelTag` befüllt wird
- `services/ai/ollamaService.ts` — LoRA-Parameter in API-Call
- `services/aiProviderService.ts` — `generateText` mit `loraAdapterId`

**In ollamaService.ts:**
```typescript
// Ollama API unterstützt LoRA via "options" oder Modell-Namen-Suffix
// Je nach Ollama-Version:
// Option A: Modell-Tag enthält LoRA (z.B. "llama3.2:lora-creative")
// Option B: API-Body mit "options": { "lora": "adapter-name" }

// Aktueller Stand: ollamaModelTag ist im State, wird aber nie verwendet
```

**In aiProviderService.ts:**
```typescript
// In generateText() oder streamText():
// Wenn Provider === 'ollama' && loraAdapterId:
//   Füge LoRA-Parameter zum Request hinzu
```

#### 4d. Worker-Seitige LoRA

**Datei:** `workers/inference.worker.ts`

**Änderungen:**
```typescript
export interface InferenceRequest {
  // ... bestehende Felder
  loraAdapterId?: string;
}

// In runInference():
// Wenn loraAdapterId gesetzt, prüfe ob Pipeline LoRA unterstützt
// @xenova/transformers unterstützt aktuell KEIN LoRA
// → Log Warnung, ignoriere loraAdapterId für Local AI
```

**Wichtig:** Local AI (ONNX/Transformers) unterstützt aktuell kein LoRA. LoRA funktioniert nur mit Ollama. Dies muss in der UI dokumentiert werden.

#### 4e. Legacy generateText LoRA

**Datei:** `services/geminiService.ts`

**Stand:** Gemini API unterstützt kein LoRA. Keine Änderung nötig.

**Datei:** `services/aiProviderService.ts`

**Stand:** Legacy-Pfad (generateText) muss `loraAdapterId` an Ollama weiterleiten. Prüfen und implementieren.

### □ Schritt 5: Phase 2.3 — Performance Hardening (Optional)

**Priorität:** Niedriger als LoRA und Tests.

**Schnelle Siege (1–2h):**
- [ ] `MAX_PIPELINE_CACHE` dynamisch nach `navigator.deviceMemory`
- [ ] `gpuResourceManager` Timeout von 30s → 15s
- [ ] `ecoModeService` periodische Memory-Checks

**Nicht in diesem Sprint:**
- [ ] WebLLM Main-Thread → Worker (zu komplex)

### □ Schritt 6: Phase 2.4 — Test Coverage (Wichtig)

**Priorität:** Hoch — Coverage muss steigen.

**Schnelle Siege (Reihenfolge nach Aufwand/Benefit):**

1. **`tests/unit/ai-core.test.ts` erweitern** (1h)
   - ONNX-Fallback-Test (mockPipeline für ONNX-Modell)
   - Transformers-Fallback-Test
   - Prompt-stripping Test (generierter Text beginnt mit Prompt)
   - Error-Propagation Test (WebLLM wirft → ONNX wird versucht)

2. **`tests/unit/ecoModeService.test.ts` erweitern** (30min)
   - RAM-Pressure-Test
   - Battery-API-Test
   - Explicit Eco-Mode Test

3. **`tests/unit/localEmbeddingService.test.ts` erweitern** (30min)
   - MAX_RESTART_ATTEMPTS Test
   - Backoff-Exponentiell-Test

4. **`tests/unit/sileroVadEngine.test.ts` erstellen** (2h)
   - Mock `@xenova/transformers` pipeline
   - Mock ONNX Runtime
   - Test: isAvailable, initialize, processChunk

5. **`tests/unit/kokoroTtsEngine.test.ts` erstellen** (2h)
   - Mock `@xenova/transformers` pipeline
   - Mock AudioContext
   - Test: isAvailable, initialize, speak

**Coverage-Schwellen anpassen:**
```typescript
// vitest.config.ts
// lines: 63 → 70
// branches: 55 → 62
// functions: 54 → 60
// statements: 62 → 70
```

**Wichtig:** Nicht alle auf einmal anheben — Schrittweise nach jedem erfolgreichen Run.

### □ Schritt 7: Phase 3 — Final Quality Gate (Letzter Schritt)

```bash
# Komplettes Quality Gate
pnpm run lint
pnpm run typecheck
pnpm run i18n:check
pnpm run test:run        # Oder einzelne Dateien falls Runner broken
pnpm run test:coverage
pnpm run bundle:budget
pnpm run build
```

**Wenn alles passiert:** Sprint abgeschlossen! 🎉

---

## Dateien, die beim Wiederaufnehmen direkt gebraucht werden

### Must-Read (vor jeder Änderung)

```
AGENTS.md                          → Projekt-Regeln, Conventions
docs/sprints/local-ai-perfection-PLAN.md    → Vollständiger Plan
docs/sprints/local-ai-perfection-STATUS.md  → Aktueller Stand
```

### Phase 2.2 — LoRA (direkt bearbeiten)

```
App.tsx                            → Route hinzufügen
components/settings/LoraSection.tsx → NEU erstellen
features/lora/loraSlice.ts         → ollamaModelTag prüfen
services/ai/ollamaService.ts       → LoRA Parameter
services/aiProviderService.ts      → generateText mit loraAdapterId
workers/inference.worker.ts        → loraAdapterId in InferenceRequest
```

### Phase 2.4 — Tests (direkt bearbeiten)

```
tests/unit/ai-core.test.ts         → Erweitern
tests/unit/sileroVadEngine.test.ts → NEU
tests/unit/kokoroTtsEngine.test.ts → NEU
tests/unit/ecoModeService.test.ts  → Erweitern
tests/unit/localEmbeddingService.test.ts → Erweitern
vitest.config.ts                   → Thresholds anpassen
```

### i18n (nach jeder UI-Änderung)

```
locales/en/settings.json           → Neue Keys
locales/de/settings.json           → Neue Keys
locales/fr/settings.json           → Neue Keys
locales/es/settings.json           → Neue Keys
locales/it/settings.json           → Neue Keys
```

---

## Schnell-Referenz: Wichtige Code-Patterns

### AbortSignal durch die Schichten

```
Caller (Component)
  → generateLocalText(prompt, modelId, onProgress, loraAdapterId, signal)
    → runLocalTextGeneration(prompt, modelId, onProgress, signal)
      → WebLLM: signal?.aborted checks
      → ONNX: signal?.aborted checks
      → Transformers: signal?.aborted checks
    → Worker: runInference(req, controller.signal)
      → loadPipeline() + signal checks
```

### Error Propagation Pattern

```typescript
// ❌ VERBOTEN (leerer catch)
} catch {
  /* optional */
}

// ✅ KORREKT (immer loggen)
} catch (err) {
  logger.warn('Module action failed:', err);
}

// ✅ KORREKT (propagieren bei Abort)
} catch (err) {
  if (err instanceof Error && err.message === 'Aborted') throw err;
  logger.warn('Module action failed:', err);
}
```

### i18n Key Pattern

```typescript
// Neue Keys MÜSSEN in alle 5 Locales:
// EN (Source) → DE → FR → ES → IT

// In Komponenten:
const { t } = useTranslation();
<button>{t('settings.lora.title')}</button>

// Nach Änderung:
pnpm run i18n:check
```

### Test-Mock Pattern (ONNX/Transformers)

```typescript
const mockPipeline = vi.fn();
vi.mock('@xenova/transformers', () => ({
  pipeline: mockPipeline,
  env: { backends: { onnx: { wasm: { proxy: true } } } },
}));

// In Test:
mockPipeline.mockResolvedValue(
  vi.fn().mockResolvedValue([{ generated_text: 'promptResult' }])
);
```

---

## Bekannte Blocker & Workarounds (Schnell-Lookup)

| Problem | Workaround | Datei |
|---------|-----------|-------|
| `vitest` broken (`Failed to load url basic`) | Einzelne Dateien: `pnpm exec vitest run FILE` | — |
| Transformers.js nicht abort-bar | Pre/Post-Checks in `runInference` | `workers/inference.worker.ts` |
| WebLLM blockiert UI | GPU Mutex + Tab Leader | `localAiFacade.ts` |
| LoRA nur bei Ollama | UI-Hinweis: "Local AI doesn't support LoRA yet" | `LoraSection.tsx` |
| ONNX WASM Chunk zu groß | Lazy-Loading in Vite manual chunks | `vite.config.ts` |

---

## Letzte Git-Commits (zum Verifizieren)

```bash
# Wenn diese Sitzung committed wurde, sollten diese Commits vorhanden sein:
git log --oneline -10

# Erwartet (ungefähr):
# abc1234 test(ai-core): add comprehensive tests for runLocalTextGeneration
# def5678 feat(worker): integrate AbortSignal into inference pipeline
# ghi9012 feat(local-ai): forward AbortSignal and improve error logging
# jkl3456 feat(ai-core): ONNX + Transformers.js real text-generation pipelines
# ... (Phase 1 Commits)
```

**Wenn nicht committed:** Änderungen sind in Working Directory. Siehe `git status`.

---

## Kontakt & Kontext

- **Projekt:** StoryCraft-Studio v1.19.0
- **Stack:** React 19, Vite 8, TypeScript strict, Redux Toolkit 2.x, Tailwind 4.x
- **Workspace:** `@domain/ai-core`, `@domain/ui`, `collab-transport`
- **Test Runner:** Vitest (maxWorkers: 1), Playwright (E2E)
- **Lint/Format:** Biome
- **Node:** >= 22.0.0 (`.nvmrc`)
- **Package Manager:** pnpm >= 10.0.0

---

> **Ende der Wiederaufnahmemarke**  
> **Nächster empfohlener Schritt:** Phase 2.2 — LoRA Productionization  
> **Geschätzte Zeit bis Sprint-Ende:** 22–34 Stunden  
> **Erstellt:** 2026-05-31 11:08 CEST
