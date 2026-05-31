# StoryCraft Studio — Voice Full Support (opt-in) Master Plan v1.0

> Created: 2026-05-24 | Updated: 2026-05-28 | Author: Senior Voice Architect | Status: **Phase 1 Complete (v1.17.0) + Phase 2 WASM Scaffold Complete (v1.19.0 B-2)**

---

## Executive Summary + Vision

StoryCraft Studio receives a **complete, opt-in Voice Full Support** as a premium add-on feature. The app remains primarily mouse and keyboard driven. When activated, users can control nearly all features (navigation, writing, Plot Board, AI features, settings, export, collaboration) by voice.

**Vision:** Voice as an equal input medium alongside mouse/keyboard — with maximum privacy (local-first), offline capability, and WCAG 2.2 AAA-compliant accessibility. Voice Mode is a force multiplier for power users and a gateway for accessibility users.

**Status v1.0 Foundation:** All abstract engine interfaces, Web Speech API fallback implementations, Redux state, UI components, intent engine, command mappings, and 83 unit tests are implemented and green.

**Status v1.19.0 WASM Scaffold (B-2):** `WasmSttEngine` (Whisper.cpp WASM STT scaffold) und `SileroVadEngine` (Silero VAD v4 via ONNX Runtime Web) implementiert in `services/voice/wasmSttEngine.ts` + `sileroVadEngine.ts`. Beide implementieren die abstrakten Interfaces aus `voiceTypes.ts`. Aktivierung via `enableVoiceWasm` flag (off by default). Model-Download-UI ist Phase 3.

---

## 1. Overall Architecture

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

- **Abstract engine pattern:** `SttEngine`, `TtsEngine`, `VadEngine`, `WakeWordEngine` as TypeScript interfaces with multiple implementations
- **Capability detection:** Runtime check which engines are available (WASM support, WebGPU, model download status)
- **Graceful degradation:** Automatic fallback from local → Web Speech API → visual-only
- **Worker isolation:** Audio processing (VAD, STT chunking) in `workers/voiceAudio.worker.ts` (v1.1)
- **Redux state:** `features/voice/voiceSlice.ts` for persistent voice preferences (stored in Settings)
- **Zustand state:** `app/transientUiStore.ts` for ephemeral UI (listening indicator, active mode)

---

## 2. Wake-Word, VAD, Continuous Listening & Microphone Handling

### Wake-Word ✅ v1.0
- **Default:** "Hey StoryCraft" or "OK StoryCraft"
- **Engine:** `EnergyThresholdWakeWordEngine` — energy threshold + phrase-matching fallback
- **Future:** Sherpa-ONNX wake-word (WASM) with small ONNX model (~50KB)
- **Privacy:** Wake-word runs entirely locally; no audio upload

### VAD ✅ v1.0
- **Primary:** `WebRtcVadEngine` — energy-based VAD in pure JavaScript (immediately available)
- **Future:** Silero VAD v4 via ONNX Runtime Web (~2MB model, lazy-loaded)
- **Configuration:** `threshold` (0.01), `minSilenceFrames` (5), `minSpeechFrames` (3)

### Continuous Listening ✅ v1.0
- **Push-to-Talk (PTT):** hold key (configurable, default: `Ctrl+Shift+V`) — recommended for privacy
- **Wake-Word Mode:** continuous VAD/wake-word hybrid; active listening after wake-word
- **Manual Mode:** click the voice button in the toolbar
- **AudioWorklet:** custom `voice-processor.js` for 16kHz/16bit mono stream with minimal latency (v1.1)

### Microphone Handling ✅ v1.0
- **Permission:** Explicit request on first activation with an explanation of its purpose
- **Indicator:** Permanent microphone status in status bar (only when voice is active)
- **Muting:** Fast mute via keyboard or click; audio stream is actually stopped

---

## 3. Web Speech API Alternativen (Moderne Stacks)

### Vergleich

| Engine | Type | Size | Quality | Offline | Privacy | Languages | Status 2026 |
|--------|------|------|---------|---------|---------|-----------|-------------|
| **Web Speech API** | Browser-native | 0KB | Medium | No | Poor | Browser-dependent | ✅ v1.0 fallback |
| **Whisper.cpp WASM** | Local WASM | ~30-80MB | Very high | Yes | Excellent | 99+ | v1.1 planned |
| **Faster-Whisper (ONNX)** | Local WASM | ~50MB | Very high | Yes | Excellent | 99+ | v1.1 planned |
| **Sherpa-ONNX** | Local WASM | ~5-20MB | High | Yes | Excellent | 10+ | v1.1 planned |
| **Transformers.js Whisper** | Web Transformer | ~30MB | High | Yes | Excellent | 99+ | v1.1 planned |
| **Parakeet (NVIDIA)** | Cloud/API | 0KB | Extremely high | No | Poor | En+ | Optional |
| **Kokoro (ONNX)** | Local TTS | ~15MB | Very high | Yes | Excellent | En+ | v1.1 planned |
| **Piper** | Local TTS | ~5-20MB | High | Yes | Excellent | 20+ | v1.1 planned |
| **Coqui XTTS** | Local TTS | ~400MB | Extremely high | Yes | Excellent | Multi | Heavyweight |

### Recommended stack 2026

**STT:**
1. **Primary (v1.1):** Whisper.cpp WASM (tiny/base model, ~30-80MB)
2. **Secondary (v1.1):** Sherpa-ONNX (faster streaming, lower latency)
3. **Fallback ✅ v1.0:** Web Speech API (immediately available, no downloads)

**TTS:**
1. **Primary (v1.1):** Kokoro (ONNX, ~15MB)
2. **Secondary (v1.1):** Piper (~5MB)
3. **Fallback ✅ v1.0:** Web Speech API `speechSynthesis`

**VAD:**
1. **Primary (v1.1):** Silero VAD v4 via ONNX Runtime Web
2. **Fallback ✅ v1.0:** WebRTC native VAD (energy-based)

**Wake-Word:**
1. **Primary (v1.1):** Sherpa-ONNX wake-word
2. **Fallback ✅ v1.0:** Energy threshold + phrase matching

---

## 4. Speech-to-Text (STT) ✅ v1.0

### Local high-quality solution
- **Whisper.cpp WASM** with streaming support (chunk-based) — v1.1
- **Model tiers:**
  - `tiny` (~30MB): For fast devices, very good quality
  - `base` (~80MB): For desktop/high-end, best quality
  - Model download on-demand with progress indicator
- **Language detection:** Automatic language recognition (Whisper supports 99+ languages)
- **Prompting:** Context prompt with current project content for better proper-noun recognition

### Hybrid mode ✅ v1.0
- **Cloud fallback:** When local is unavailable AND user has explicitly consented, optional cloud STT (Gemini STT API)
- **Toggle:** Setting "Allow cloud speech processing" (default: false)

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

### Architecture
- **Command registry reuse:** Existing `services/commands/commandBuilder.ts` is extended with `voiceKeywords` per command
- **Intent templates:** Natural language templates can be assigned to each command definition
  - Example: `"navigate to {view}"`, `"open {view}"`, `"show {view}"` → `global-dashboard`
- **Slot extraction:** `{view}`, `{characterName}`, `{sectionTitle}` are extracted from the transcript

### Context awareness ✅ v1.0
- **Current view:** "next scene" means something different in the manuscript vs. on the Plot Board
- **Selection:** "delete this" deletes the current selection
- **Last actions:** "do that again" repeats the last command
- **Project context:** Character names, scene titles, and locations are known and recognized as slots

---

## 6. Natural Language Understanding (NLU) ✅ v1.0 (rule-based)

### Approach: hybrid system
1. **Rule-based (fast) ✅ v1.0:** 80% of commands via template matching and keyword scoring (Jaccard similarity)
2. **Semantic (precise):** Local embedding similarity (MiniLM via ONNX) for similar commands — v1.2
3. **LLM fallback (complex):** For complex multi-part commands a small local LLM (Phi-3.5 mini / Qwen 2.5 0.5B) is used via WebLLM — v1.2

### Examples of complex commands
- "Create a new scene after the current one titled 'The Forest' and link the protagonist"
- "Change the font size to 18, activate Zen Mode, and jump to the manuscript"
- "Export the current project as PDF with the default template"

---

## 7. Accessible Audio Navigation per WCAG 2.2 ✅ v1.0

### Conformance
- **WCAG 2.2 AA/AAA:** All voice interactions are fully keyboard-operable
- **2.1.1 Keyboard:** Voice activation possible via keyboard (PTT key)
- **2.1.4 Character Key Shortcuts:** No single-character shortcuts for voice
- **2.2.1 Timing Adjustable:** Voice listening timeout configurable (5-30s)
- **2.2.2 Pause, Stop, Hide:** TTS can be stopped at any time
- **2.4.3 Focus Order:** After a voice command focus remains logically positioned
- **2.5.5 Target Size:** Voice buttons at least 44×44px

### Audio landmarks ✅ v1.0
- `aria-live="polite"` regions for voice feedback
- `aria-atomic="true"` for complete announcements
- Distinction: system feedback vs. user transcription

---

## 8. ARIA UI Compatibility ✅ v1.0

### Semantic structure
- Voice panel as `role="region"` with `aria-label="Voice Control"`
- Voice button as `role="button"` with `aria-pressed` for listening status
- Transcription display as `role="log"` with `aria-live="polite"`

### Dynamic updates
- On command execution: `aria-live` announcement of the result
- On errors: `aria-live="assertive"` for immediate attention
- On mode change: status change communicated via `aria-live`

### Focus management ✅ v1.0
- After a voice command focus is moved to the affected element
- On navigation: focus on the main content of the new view
- On dictation: focus in the editor, cursor at the insertion position

---

## 9. Voice Feedback Strategies ✅ v1.0

### Intelligent feedback
- **Confirmation level configurable:**
  - `minimal`: Errors and ambiguities only
  - `standard`: Confirmation on every action
  - `verbose`: Detailed descriptions and help
- **Context-dependent:**
  - Navigation: brief confirmation ("Dashboard")
  - Destructive actions: explicit confirmation ("Delete scenes — are you sure?")
  - AI generation: progress announcements ("Generating ideas... Done")

### Non-intrusive
- Visual indicators take precedence over audio
- Audio feedback only when app is in the background or explicitly requested
- Silent mode: TTS completely disableable
- Night mode: reduced volume, no wake-word audio

---

## 10. Text-to-Speech (TTS) ✅ v1.0

### Modern alternatives
- **Kokoro (v1.1):** ONNX-based, ~15MB, extremely natural, good for longer texts
- **Piper (v1.1):** Fast, small (~5MB), good for short feedback announcements
- **Web Speech API ✅ v1.0:** Immediately available but lower quality

### Integration ✅ v1.0
- **Lazy-load:** Download TTS model only on first use
- **Streaming:** For longer texts (reading the manuscript aloud)
- **Voice selection:** Available per language
- **Parameters:** Rate (0.5-2.0), pitch, volume

---

## 11. Full Control of All App Areas by Voice ✅ v1.0

### Navigation
- All 18 views reachable
- "Back", "Forward" in browser history
- "Help for [view]"

### Editor / Writing
- **Dictation:** Continuous insertion of transcription
- **Formatting:** "Bold", "Italic", "Heading", etc.
- **Cursor:** "Beginning", "End", "forward three words", "delete sentence"
- **Scenes:** "New scene", "next scene", "delete scene"

### Plot Board
- "New scene here", "move scene to the left"
- "Connect scene one with scene two"
- "Zoom out", "center board"

### AI features
- "Generate plot ideas", "write dialog for [character]"
- "Check consistency", "start character interview"

### Settings
- "Change theme to dark", "font size 18"
- "Activate Zen Mode"

---

## 12. Tiefe Integration in bestehende Codebase ✅ v1.0

### Neue Dateien (v1.0 + v1.19.0 B-2)
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
  wasmSttEngine.ts          (Whisper.cpp WASM STT scaffold — v1.19.0 B-2)
  sileroVadEngine.ts        (Silero VAD v4 / ONNX scaffold — v1.19.0 B-2)

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

### Changed files (v1.0)
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
- **Local-first:** All voice engines run locally in the browser
- **No audio upload:** Microphone audio never leaves the device (except on explicit cloud opt-in)
- **Cloud opt-in separate:** Extra toggle for cloud STT, default: off

### Security
- **WASM sandbox:** All local models run in WASM sandbox
- **CSP-compatible:** No `eval()`, no inline scripts
- **No API keys in voice:** Voice needs no cloud keys

### Offline-first ✅ v1.0
- **Service Worker:** Voice models cached after first download
- **Progressive download:** Models are downloaded when activated
- **Offline indicator:** Clear display when voice is available offline

### Performance ✅ v1.0
- **Lazy loading:** Voice modules loaded only on activation
- **Worker isolation:** Audio processing not on the main thread
- **Model caching:** IndexedDB for downloaded models
- **Chunk sizes:** STT in 5-10s chunks for low latency

---

## 14. Error Handling, Graceful Degradation & Fallback ✅ v1.0

### Error strategy
| Situation | Fallback | UX |
|-----------|----------|-----|
| WASM not supported | Web Speech API | Info toast |
| Model download failed | Web Speech API | Retry button |
| Microphone unavailable | Visual mode (typing) | Explanatory dialog |
| STT engine crashed | Auto-restart once, then fallback | Silent fallback |
| Intent not recognized | "I didn't understand that" + suggestions | Polite announcement |
| TTS unavailable | Visual feedback only | No error |

### Graceful degradation ✅ v1.0
- Voice feature always works in some form
- Minimum feature set: Web Speech API + visual feedback
- No hard error on unavailability

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
- `voiceCommandService.test.ts` — end-to-end command execution
- `useVoice.test.ts` — hook behavior

### Accessibility Tests (v1.1)
- axe-core on voice panel
- Keyboard navigation voice UI
- Screen reader compatibility

### E2E Tests (Playwright) (v1.1)
- Voice activation flow
- Command execution via simulated transcript
- Graceful degradation without microphone

---

## Implementation Roadmap

### Phase 1: Foundation ✅ COMPLETED (2026-05-24)
1. ✅ VoiceSettings in `types.ts`
2. ✅ `featureFlags.enableVoiceSupport`
3. ✅ Extend voice slice (mode, engine status, feedback level)
4. ✅ Abstract engine interfaces (`voiceTypes.ts`)
5. ✅ Web Speech API implementations (immediately usable)
6. ✅ Intent engine (template + fuzzy Jaccard)
7. ✅ Command voice mappings (25 commands)
8. ✅ Feedback service (3 verbosity levels)
9. ✅ Audio navigator (ARIA landmarks + focus)
10. ✅ UI components (VoiceControlPanel, VoiceIndicator, VoiceSettingsSection)
11. ✅ React hooks (useVoice, usePushToTalk, useVoiceDictation, useVoiceAccessibility)
12. ✅ App integration (App.tsx, Header.tsx, ManuscriptEditor.tsx)
13. ✅ i18n for all 5 languages (2025 keys)
14. ✅ 83 unit tests (9 files)
15. ✅ Quality gate: lint ✅ · i18n:check ✅ · typecheck ✅

### Phase 2: Core WASM Engines (v1.19.0 B-2 — partial) ✅ Scaffold complete
16. ✅ VAD Engine (Silero via ONNX) — `sileroVadEngine.ts` scaffold done; model download UI Phase 3
17. ⬜ Wake-Word Engine (Sherpa-ONNX) — Phase 3
18. ✅ STT engine (Whisper.cpp WASM) — `wasmSttEngine.ts` scaffold done; chunked inference; model download UI Phase 3
19. ⬜ TTS engine (Kokoro/Piper WASM) — Phase 3
20. ⬜ AudioWorklet for microphone processing — Phase 3

### Phase 3: Advanced NLU (v1.2)
21. Semantic intent matching (MiniLM embeddings)
22. Local LLM fallback (WebLLM Phi-3.5 mini)
23. Complex multi-slot commands

### Phase 4: Deep App Integration (v1.2)
24. Plot Board voice control (canvas mode)
25. AI feature voice integration
26. Settings voice shortcuts
27. Collaboration voice commands

### Phase 5: Polish & Testing (v1.2)
28. Integration tests (voiceCommandService, useVoice)
29. E2E tests (Playwright)
30. Accessibility audit (axe-core)
31. Performance optimization
32. Documentation finalization

---

## Appendix: Recommended npm stack 2026

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

> **Note:** Since StoryCraft Studio strictly prioritizes privacy and offline-first, all voice engines are loaded as WASM/ONNX and executed locally. No cloud dependency for the base mode.
