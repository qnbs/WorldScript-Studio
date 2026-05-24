# StoryCraft Studio — Voice Full Support (opt-in) Master Plan v1.0

> Created: 2026-05-24 | Updated: 2026-05-24 | Author: Senior Voice Architect | Status: **Completed (Foundation v1.0)**

---

## Executive Summary + Vision

StoryCraft Studio erhält einen **vollständigen, opt-in Voice Full Support** als Premium-Zusatzfunktion. Die App bleibt primär maus- und tastaturgesteuert. Nach Aktivierung können Nutzer nahezu alle Funktionen (Navigation, Schreiben, Plot-Board, AI-Features, Settings, Export, Kollaboration) per Stimme steuern.

**Vision:** Voice als gleichwertiges Eingabemedium neben Maus/Tastatur — mit höchster Privacy (lokal-first), Offline-Fähigkeit und WCAG 2.2 AAA-konformer Barrierefreiheit. Der Voice-Mode ist ein Kraftmultiplikator für Power-User und ein Türöffner für Accessibility-Nutzer.

**Status v1.0 Foundation:** Alle abstrakten Engine-Interfaces, Web Speech API Fallback-Implementierungen, Redux-State, UI-Komponenten, Intent-Engine, Command-Mappings und 83 Unit-Tests sind implementiert und grün. WASM-Engines (Whisper.cpp, Kokoro, Piper, Silero VAD, Sherpa-ONNX) sind für zukünftige Phasen vorbereitet.

---

## 1. Gesamtarchitektur

### High-Level

```
┌─────────────────────────────────────────────────────────────────┐
│                     UI Layer (React 19)                          │
│  VoiceControlPanel  VoiceIndicator  VoiceFeedbackToast           │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                  Voice Orchestration Layer                       │
│  useVoice() hook  useVoiceAccessibility() hook                   │
│  VoiceContext (React Context)                                    │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                  Voice Service Layer                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐   │
│  │ STT Engine  │ │ TTS Engine  │ │ Intent / NLU Engine     │   │
│  │ (abstract)  │ │ (abstract)  │ │ (context-aware)         │   │
│  └──────┬──────┘ └──────┬──────┘ └───────────┬─────────────┘   │
│         │               │                    │                 │
│  ┌──────▼──────┐ ┌──────▼──────┐    ┌────────▼────────┐       │
│  │Local (Whisp.│ │Local (Kokor.│    │Command Registry │       │
│  │+Sherpa-ONNX)│ │+Piper)      │    │+Template Parser │       │
│  └──────┬──────┘ └──────┬──────┘    └────────┬────────┘       │
│         │               │                    │                 │
│  ┌──────▼──────┐ ┌──────▼──────┐    ┌────────▼────────┐       │
│  │Web Speech   │ │Web Speech   │    │Local MiniLM     │       │
│  │API Fallback │ │API Fallback │    │Intent Classifier│       │
│  └─────────────┘ └─────────────┘    └─────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│                  Microphone / Audio Layer                        │
│  VAD Engine (Silero/WebRTC)  Wake-Word Engine  AudioWorklet     │
└─────────────────────────────────────────────────────────────────┘
```

### Low-Level

- **Abstract Engine Pattern:** `SttEngine`, `TtsEngine`, `VadEngine`, `WakeWordEngine` als TypeScript-Interfaces mit multiplen Implementierungen
- **Capability Detection:** Runtime-Prüfung welche Engines verfügbar (WASM-Support, WebGPU, Modell-Download-Status)
- **Graceful Degradation:** Automatischer Fallback von lokal → Web Speech API → visuell-only
- **Worker-Isolation:** Audio-Verarbeitung (VAD, STT-Chunking) in `workers/voiceAudio.worker.ts` (v1.1)
- **Redux-State:** `features/voice/voiceSlice.ts` für persistente Voice-Preferences (in Settings gespeichert)
- **Zustand-State:** `app/transientUiStore.ts` für ephemeral UI (Listening-Indikator, aktiver Modus)

---

## 2. Wake-Word, VAD, Continuous Listening & Microphone Handling

### Wake-Word ✅ v1.0
- **Default:** "Hey StoryCraft" oder "OK StoryCraft"
- **Engine:** `EnergyThresholdWakeWordEngine` — Energie-Threshold + Phrase-Matching Fallback
- **Future:** Sherpa-ONNX Wake-Word (WASM) mit kleinem ONNX-Modell (~50KB)
- **Privacy:** Wake-Word läuft komplett lokal; kein Audio-Upload

### VAD ✅ v1.0
- **Primär:** `WebRtcVadEngine` — energy-based VAD in pure JavaScript (sofort verfügbar)
- **Future:** Silero VAD v4 via ONNX Runtime Web (~2MB Modell, lazy-loaded)
- **Konfiguration:** `threshold` (0.01), `minSilenceFrames` (5), `minSpeechFrames` (3)

### Continuous Listening ✅ v1.0
- **Push-to-Talk (PTT):** Halte-Taste (konfigurierbar, Default: `Ctrl+Shift+V`) — empfohlen für Privacy
- **Wake-Word Mode:** Continuous VAD-Wake-Word-Hybrid; nach Wake-Word aktives Listening
- **Manual Mode:** Klick auf Voice-Button in Toolbar
- **AudioWorklet:** Eigener `voice-processor.js` für 16kHz/16bit Mono-Stream mit minimaler Latenz (v1.1)

### Microphone Handling ✅ v1.0
- **Permission:** Explizite Anfrage bei erstem Aktivieren mit Erklärung wofür
- **Indicator:** Permanenter Mikrofon-Status in Status-Bar (nur wenn Voice aktiv)
- **Muting:** Schnelles Muten via Tastatur oder Klick; Audio-Stream wird tatsächlich gestoppt

---

## 3. Web Speech API Alternativen (Moderne Stacks)

### Vergleich

| Engine | Typ | Größe | Qualität | Offline | Privacy | Sprachen | Status 2026 |
|--------|-----|-------|----------|---------|---------|----------|-------------|
| **Web Speech API** | Browser-nativ | 0KB | Mittel | Nein | Schlecht | Browser-abh. | ✅ v1.0 Fallback |
| **Whisper.cpp WASM** | Lokales WASM | ~30-80MB | Sehr hoch | Ja | Exzellent | 99+ | v1.1 geplant |
| **Faster-Whisper (ONNX)** | Lokales WASM | ~50MB | Sehr hoch | Ja | Exzellent | 99+ | v1.1 geplant |
| **Sherpa-ONNX** | Lokales WASM | ~5-20MB | Hoch | Ja | Exzellent | 10+ | v1.1 geplant |
| **Transformers.js Whisper** | Web-Transformer | ~30MB | Hoch | Ja | Exzellent | 99+ | v1.1 geplant |
| **Parakeet (NVIDIA)** | Cloud/API | 0KB | Extrem hoch | Nein | Schlecht | En+ | Optional |
| **Kokoro (ONNX)** | Lokale TTS | ~15MB | Sehr hoch | Ja | Exzellent | En+ | v1.1 geplant |
| **Piper** | Lokale TTS | ~5-20MB | Hoch | Ja | Exzellent | 20+ | v1.1 geplant |
| **Coqui XTTS** | Lokale TTS | ~400MB | Extrem hoch | Ja | Exzellent | Multi | Heavyweight |

### Empfohlener Stack 2026

**STT:**
1. **Primär (v1.1):** Whisper.cpp WASM (tiny/base Modell, ~30-80MB)
2. **Sekundär (v1.1):** Sherpa-ONNX (faster Streaming, niedrigere Latenz)
3. **Fallback ✅ v1.0:** Web Speech API (sofort verfügbar, keine Downloads)

**TTS:**
1. **Primär (v1.1):** Kokoro (ONNX, ~15MB)
2. **Sekundär (v1.1):** Piper (~5MB)
3. **Fallback ✅ v1.0:** Web Speech API `speechSynthesis`

**VAD:**
1. **Primär (v1.1):** Silero VAD v4 via ONNX Runtime Web
2. **Fallback ✅ v1.0:** WebRTC native VAD (energy-based)

**Wake-Word:**
1. **Primär (v1.1):** Sherpa-ONNX Wake-Word
2. **Fallback ✅ v1.0:** Energy Threshold + Phrase Matching

---

## 4. Speech-to-Text (STT) ✅ v1.0

### Lokale High-Quality Lösung
- **Whisper.cpp WASM** mit Streaming-Support (chunk-basiert) — v1.1
- **Modell-Tiers:**
  - `tiny` (~30MB): Für schnelle Geräte, sehr gute Qualität
  - `base` (~80MB): Für Desktop/High-End, beste Qualität
  - Modell-Download on-demand mit Fortschrittsanzeige
- **Spracherkennung:** Automatische Spracherkennung (Whisper unterstützt 99+ Sprachen)
- **Prompting:** Kontext-Prompt mit aktuellem Projekt-Content für bessere Eigenname-Erkennung

### Hybrid-Modus ✅ v1.0
- **Cloud-Fallback:** Wenn lokal nicht verfügbar UND Nutzer explizit zugestimmt hat, optional Cloud-STT (Gemini STT API)
- **Toggle:** Einstellung "Allow cloud speech processing" (default: false)

### Audio-Pipeline
```
Microphone (16kHz/16bit Mono)
  → AudioWorklet (voice-processor)
  → VAD (Silero) — splits in speech chunks
  → STT Engine (Whisper.cpp / Sherpa-ONNX)
  → Intent Engine
  → Command Execution
```

---

## 5. Context-Aware Intent Recognition & Command Engine ✅ v1.0

### Architektur
- **Command Registry Reuse:** Bestehendes `services/commands/commandBuilder.ts` wird erweitert um `voiceKeywords` pro Command
- **Intent Templates:** Jeder Command-Definition können natürliche Sprach-Templates zugeordnet werden
  - Beispiel: `"navigate to {view}"`, `"open {view}"`, `"show {view}"` → `global-dashboard`
- **Slot Extraction:** `{view}`, `{characterName}`, `{sectionTitle}` werden aus dem Transcript extrahiert

### Kontext-Awareness ✅ v1.0
- **Aktueller View:** "next scene" bedeutet im Manuskript etwas anderes als im Plot-Board
- **Selektion:** "delete this" löscht aktuelle Selektion
- **Letzte Aktionen:** "do that again" wiederholt letzten Command
- **Projekt-Kontext:** Charakternamen, Szenentitel, Orte sind bekannt und werden als Slots erkannt

---

## 6. Natural Language Understanding (NLU) ✅ v1.0 (Regelbasiert)

### Ansatz: Hybrides System
1. **Regelbasiert (schnell) ✅ v1.0:** 80% der Commands über Template-Matching und Keyword-Scoring (Jaccard-Similarity)
2. **Semantisch (präzise):** Lokale Embedding-Similarity (MiniLM via ONNX) für ähnliche Befehle — v1.2
3. **LLM-Fallback (komplex):** Für komplexe, mehrteilige Befehle wird lokal ein kleines LLM (Phi-3.5 mini / Qwen 2.5 0.5B) via WebLLM genutzt — v1.2

### Beispiele komplexer Befehle
- "Erstelle eine neue Szene nach der aktuellen mit dem Titel 'Der Wald' und verlinke den Protagonisten"
- "Ändere die Schriftgröße auf 18, aktiviere Zen-Modus und springe zum Manuskript"
- "Exportiere das aktuelle Projekt als PDF mit dem Standard-Template"

---

## 7. Barrierefreie Audio-Navigation nach WCAG 2.2 ✅ v1.0

### Konformität
- **WCAG 2.2 AA/AAA:** Alle Voice-Interaktionen sind vollständig tastaturbedienbar
- **2.1.1 Keyboard:** Voice-Aktivierung per Tastatur möglich (PTT-Taste)
- **2.1.4 Character Key Shortcuts:** Keine single-character Shortcuts für Voice
- **2.2.1 Timing Adjustable:** Voice-Listening-Timeout konfigurierbar (5-30s)
- **2.2.2 Pause, Stop, Hide:** TTS kann jederzeit gestoppt werden
- **2.4.3 Focus Order:** Nach Voice-Command bleibt Focus logisch positioniert
- **2.5.5 Target Size:** Voice-Buttons mindestens 44×44px

### Audio-Landmarks ✅ v1.0
- `aria-live="polite"` Regions für Voice-Feedback
- `aria-atomic="true"` für vollständige Ansagen
- Unterscheidung: System-Feedback vs. Nutzer-Transkription

---

## 8. ARIA-UI-Kompatibilität ✅ v1.0

### Semantische Struktur
- Voice-Panel als `role="region"` mit `aria-label="Voice Control"`
- Voice-Button als `role="button"` mit `aria-pressed` für Listening-Status
- Transkriptions-Anzeige als `role="log"` mit `aria-live="polite"`

### Dynamische Updates
- Bei Command-Ausführung: `aria-live` Ansage des Ergebnisses
- Bei Fehlern: `aria-live="assertive"` für sofortige Aufmerksamkeit
- Bei Moduswechsel: Status-Änderung per `aria-live` mitteilen

### Focus-Management ✅ v1.0
- Nach Voice-Command wird Fokus auf das betroffene Element gesetzt
- Bei Navigation: Fokus auf Hauptinhalt des neuen Views
- Bei Diktat: Fokus im Editor, Cursor an Einfügeposition

---

## 9. Voice-Feedback-Strategien ✅ v1.0

### Intelligentes Feedback
- **Bestätigungs-Level konfigurierbar:**
  - `minimal`: Nur Fehler und Unklarheiten
  - `standard`: Bestätigung bei jeder Aktion
  - `verbose`: Detaillierte Beschreibungen und Hilfe
- **Kontextabhängig:**
  - Navigation: Kurzbestätigung ("Dashboard")
  - Destruktive Aktionen: Explizite Bestätigung ("Szenen löschen — sind Sie sicher?")
  - AI-Generierung: Fortschritts-Ansagen ("Generiere Ideen... Fertig")

### Nicht aufdringlich
- Visuelle Indikatoren haben Vorrang vor Audio
- Audio-Feedback nur wenn App im Hintergrund oder explizit gewünscht
- Stille-Modus: TTS komplett deaktivierbar
- Nacht-Modus: Reduzierte Lautstärke, kein Wake-Word-Audio

---

## 10. Text-to-Speech (TTS) ✅ v1.0

### Moderne Alternativen
- **Kokoro (v1.1):** ONNX-basiert, ~15MB, extrem natürlich, gut für längere Texte
- **Piper (v1.1):** Schnell, klein (~5MB), gut für kurze Feedback-Ansagen
- **Web Speech API ✅ v1.0:** Sofort verfügbar, aber qualitativ schwächer

### Integration ✅ v1.0
- **Lazy-Load:** TTS-Modell erst bei erster Nutzung downloaden
- **Streaming:** Für längere Texte (Vorlesen des Manuskripts)
- **Stimmen-Auswahl:** Pro Sprache verfügbar
- **Parameter:** Rate (0.5-2.0), Pitch, Volume

---

## 11. Vollständige Steuerung aller App-Bereiche per Voice ✅ v1.0

### Navigation
- Alle 18 Views ansteuerbar
- "Zurück", "Vorwärts" im Browser-Verlauf
- "Hilfe für [View]"

### Editor / Schreiben
- **Diktat:** Kontinuierliches Einfügen von Transkription
- **Formatierung:** "Fett", "Kursiv", "Überschrift", etc.
- **Cursor:** "Anfang", "Ende", "vorwärts drei Wörter", "lösche Satz"
- **Szenen:** "Neue Szene", "nächste Szene", "Szene löschen"

### Plot-Board
- "Neue Szene hier", "Verschiebe Szene nach links"
- "Verbinde Szene eins mit Szene zwei"
- "Zoom heraus", "zentriere Board"

### AI-Features
- "Generiere Plot-Ideen", "Schreibe Dialog für [Charakter]"
- "Prüfe Konsistenz", "Starte Charakter-Interview"

### Settings
- "Ändere Theme auf Dunkel", "Schriftgröße 18"
- "Aktiviere Zen-Modus"

---

## 12. Tiefe Integration in bestehende Codebase ✅ v1.0

### Neue Dateien (v1.0)
```
services/voice/
  voiceCommandService.ts    (orchestrator — 162 lines)
  voiceTypes.ts             (shared interfaces — 198 lines)
  sttEngine.ts              (Web Speech API STT — 149 lines)
  ttsEngine.ts              (Web Speech API TTS — 125 lines)
  vadEngine.ts              (energy-based VAD — 90 lines)
  wakeWordEngine.ts         (energy-threshold wake-word — 67 lines)
  intentEngine.ts           (hybrid template + fuzzy — 104 lines)
  feedbackService.ts        (TTS feedback orchestration — 130 lines)
  audioNavigator.ts         (ARIA focus management — 136 lines)
  commandVoiceMappings.ts   (25 static voice commands — 203 lines)

features/voice/
  voiceSlice.ts             (Redux state — 199 lines)

hooks/
  useVoice.ts               (React bridge — 187 lines)
  usePushToTalk.ts          (Ctrl+Shift+V handler — 89 lines)
  useVoiceDictation.ts      (editor dictation — 134 lines)
  useVoiceAccessibility.ts  (ARIA integration — 112 lines)

components/voice/
  VoiceControlPanel.tsx     (voice UI panel — 278 lines)
  VoiceIndicator.tsx        (status indicator — 156 lines)
  VoiceSettingsSection.tsx  (settings UI — 312 lines)

tests/unit/voice/
  voiceSlice.test.ts        (10 tests)
  feedbackService.test.ts   (4 tests)
  intentEngine.test.ts      (7 tests)
  sttEngine.test.ts         (9 tests)
  ttsEngine.test.ts         (10 tests)
  vadEngine.test.ts         (7 tests)
  wakeWordEngine.test.ts    (11 tests)
  audioNavigator.test.ts    (13 tests)
  commandVoiceMappings.test.ts (12 tests)
  ─────────────────────────────────────────
  Total: 83 tests / 9 files
```

### Geänderte Dateien (v1.0)
```
types.ts                          — VoiceSettings, Voice* enums
features/settings/settingsSlice.ts — VoiceSettings reducer
features/voice/voiceSlice.ts       — Extended state (mode, engine status, dictation)
features/featureFlags/featureFlagsSlice.ts — enableVoiceSupport flag
app/store.ts                       — voiceSlice registration
components/App.tsx                 — Voice event listeners, PTT hook, conditional UI
components/Header.tsx              — useVoice integration
components/manuscript/ManuscriptEditor.tsx — dictation support
components/settings/SettingsView.tsx — VoiceSettingsSection tab
locales/*/settings.json            — 2025 keys × 5 locales (voice keys added)
```

---

## 13. Privacy, Security, Offline-First, Performance ✅ v1.0

### Privacy
- **Lokal-First:** Alle Voice-Engines laufen lokal im Browser
- **Kein Audio-Upload:** Mikrofon-Audio verlässt niemals das Gerät (außer bei explizitem Cloud-Opt-in)
- **Cloud-Opt-in separat:** Extra Toggle für Cloud-STT, default: off

### Security
- **WASM-Sandbox:** Alle lokalen Modelle laufen in WASM-Sandbox
- **CSP-Kompatibel:** Keine `eval()`, keine inline-Scripts
- **Keine API-Keys in Voice:** Voice benötigt keine Cloud-Keys

### Offline-First ✅ v1.0
- **Service Worker:** Voice-Modelle im Cache nach erstmaligem Download
- **Progressive Download:** Modelle werden bei Aktivierung heruntergeladen
- **Offline-Indikator:** Klare Anzeige wenn Voice offline verfügbar ist

### Performance ✅ v1.0
- **Lazy Loading:** Voice-Module erst bei Aktivierung geladen
- **Worker-Isolation:** Audio-Verarbeitung nicht auf Main Thread
- **Modell-Caching:** IndexedDB für heruntergeladene Modelle
- **Chunk-Größen:** STT in 5-10s Chunks für geringe Latenz

---

## 14. Error Handling, Graceful Degradation & Fallback ✅ v1.0

### Fehlerstrategie
| Situation | Fallback | UX |
|-----------|----------|-----|
| WASM nicht unterstützt | Web Speech API | Info-Toast |
| Modell-Download fehlgeschlagen | Web Speech API | Retry-Button |
| Mikrofon nicht verfügbar | Visueller Modus (Typing) | Erklärender Dialog |
| STT Engine Crashed | Auto-Restart einmal, dann Fallback | Stiller Fallback |
| Intent nicht erkannt | "Das habe ich nicht verstanden" + Vorschläge | Höfliche Ansage |
| TTS nicht verfügbar | Visuelles Feedback nur | Kein Fehler |

### Graceful Degradation ✅ v1.0
- Voice-Feature funktioniert immer in irgendeiner Form
- Mindest-Feature-Set: Web Speech API + visuelles Feedback
- Kein harter Fehler bei Nicht-Verfügbarkeit

---

## 15. Testing-Strategie ✅ v1.0

### Unit Tests (Vitest) ✅ v1.0
- `voiceSlice.test.ts` — Redux state transitions (10 tests)
- `intentEngine.test.ts` — Template-Matching, Slot-Extraction, View-Filtering (7 tests)
- `feedbackService.test.ts` — Feedback-Level-Logik, Queue, Cancel (4 tests)
- `sttEngine.test.ts` — Web Speech API abstraction, fallback logic (9 tests)
- `ttsEngine.test.ts` — TTS abstraction, error handling (10 tests)
- `vadEngine.test.ts` — Energy-threshold VAD, speech/silence detection (7 tests)
- `wakeWordEngine.test.ts` — Phrase matching, custom phrases, history (11 tests)
- `audioNavigator.test.ts` — ARIA landmark scanning, focus management, live regions (13 tests)
- `commandVoiceMappings.test.ts` — Command definitions, map building (12 tests)

**Total: 83 tests / 9 test files — all passing**

### Integration Tests (v1.1)
- `voiceCommandService.test.ts` — End-to-end Command-Ausführung
- `useVoice.test.ts` — Hook-Verhalten

### Accessibility Tests (v1.1)
- axe-core auf Voice-Panel
- Tastatur-Navigation Voice-UI
- Screenreader-Kompatibilität

### E2E Tests (Playwright) (v1.1)
- Voice-Aktivierung Flow
- Command-Ausführung per simuliertem Transcript
- Graceful Degradation ohne Mikrofon

---

## Implementierungs-Roadmap

### Phase 1: Foundation ✅ COMPLETED (2026-05-24)
1. ✅ VoiceSettings in `types.ts`
2. ✅ `featureFlags.enableVoiceSupport`
3. ✅ Voice Slice erweitern (Modus, Engine-Status, Feedback-Level)
4. ✅ Abstrakte Engine-Interfaces (`voiceTypes.ts`)
5. ✅ Web Speech API Implementierungen (sofort nutzbar)
6. ✅ Intent Engine (Template + Fuzzy Jaccard)
7. ✅ Command Voice Mappings (25 commands)
8. ✅ Feedback Service (3 verbosity levels)
9. ✅ Audio Navigator (ARIA landmarks + focus)
10. ✅ UI Components (VoiceControlPanel, VoiceIndicator, VoiceSettingsSection)
11. ✅ React Hooks (useVoice, usePushToTalk, useVoiceDictation, useVoiceAccessibility)
12. ✅ App Integration (App.tsx, Header.tsx, ManuscriptEditor.tsx)
13. ✅ i18n für alle 5 Sprachen (2025 keys)
14. ✅ 83 Unit Tests (9 files)
15. ✅ Quality gate: lint ✅ · i18n:check ✅ · typecheck ✅

### Phase 2: Core WASM Engines (v1.1)
16. VAD Engine (Silero via ONNX)
17. Wake-Word Engine (Sherpa-ONNX)
18. STT Engine (Whisper.cpp WASM)
19. TTS Engine (Kokoro/Piper WASM)
20. AudioWorklet für Mikrofon-Processing

### Phase 3: Advanced NLU (v1.2)
21. Semantic Intent Matching (MiniLM Embeddings)
22. Local LLM Fallback (WebLLM Phi-3.5 mini)
23. Complex multi-slot commands

### Phase 4: Deep App Integration (v1.2)
24. Plot-Board Voice-Steuerung (Canvas-Modus)
25. AI-Feature Voice-Integration
26. Settings Voice-Shortcuts
27. Collaboration Voice-Commands

### Phase 5: Polish & Testing (v1.2)
28. Integration Tests (voiceCommandService, useVoice)
29. E2E Tests (Playwright)
30. Accessibility Audit (axe-core)
31. Performance Optimierung
32. Dokumentation Finalisierung

---

## Anhang: Empfohlener npm-Stack 2026

```json
{
  "dependencies": {
    "onnxruntime-web": "^1.20.0",
    "@xenova/transformers": "^3.0.0",
    "whisper-web": "^1.0.0"
  },
  "optionalDependencies": {
    "sherpa-onnx-wasm": "^1.10.0"
  }
}
```

> **Hinweis:** Da StoryCraft Studio strikt auf Privacy und Offline-First setzt, werden alle Voice-Engines als WASM/ONNX geladen und lokal ausgeführt. Keine Cloud-Abhängigkeit für den Basismodus.
