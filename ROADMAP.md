# StoryCraft Studio — Roadmap

## Vision

StoryCraft Studio soll die führende Open-Source-Plattform für KI-gestütztes kreatives Schreiben werden — offline-first, datenschutzfreundlich und erweiterbar.

> Current sprint tasks → [`TODO.md`](TODO.md)
> Completed items archive → [`docs/history/`](docs/history/)

---

## v1.1 — Stabilisierung & Härtung

**Status:** ✅ Abgeschlossen (siehe [docs/history/completed-v1.1.md](docs/history/completed-v1.1.md) für Details)

All critical, high, and most medium-priority items have been completed, including:

- ManuscriptView Resize-Listener Cleanup (AbortController + throttle)
- Feature-Flag-System (localStorage-basiert, UI in Settings)
- DevContainer-Konfiguration
- Request-Deduplizierung (abort-previous Pattern in aiThunkUtils.ts)
- Self-hosted Fonts (kein CDN, kein Google Fonts)

---

## v1.1.2 — Hotfix: Kritische Bugs

**Status:** ✅ Abgeschlossen

- codexService Infinite-Loop Fix (while+continue → for...of matchAll)
- Modal Focus-Trap Cleanup konsolidiert (fragile 2-return → single cleanup)
- FOUC Theme-Init behoben (inline script + localStorage mirror)
- Unübersetzte Sprachen (FR/ES/IT) aus Selector entfernt
- Dead Code entfernt (buildDeduplicationKey, persist/PERSIST)

---

## v1.2 — Security, Quality & Local AI

**Status:** 🔄 In Arbeit

### Security Hardening ✅ abgeschlossen

- ✅ CryptoKey non-extractable (`crypto.subtle.generateKey()`)
- ✅ CSP img-src hardening (`frame-ancestors 'none'`, `upgrade-insecure-requests`)
- ✅ Import-JSON Schema-Validation mit Valibot
- ✅ Collaboration Awareness-State Validation
- ✅ communityTemplateService → lokaler Static-Asset-Pfad
- ✅ OpenAI Stream Abort-Check, silent Model-Downgrade gestoppt
- ✅ Gemini Connection Test (echter API-Call)

### Code Quality ✅ größtenteils abgeschlossen

- ✅ Coverage-Config auf Glob-Patterns umgestellt
- ✅ TypeScript 6.0 übernommen (`stableTypeOrdering`, native `RegExp.escape`)
- ✅ Project/Settings-Save-Listener getrennt (Performance)
- ✅ SettingsView.tsx in 8 Sektions-Komponenten aufgeteilt (2116 LOC → ~234 LOC)
- ✅ constants.tsx in icons/defaults/index aufgeteilt
- ✅ projectSlice.ts in 6 Thunk-Domain-Dateien aufgeteilt (777 → 248 LOC)
- ✅ Lighthouse CI hard-fail aktiviert
- ✅ Test-Suite auf 160+ Tests ausgebaut (CI grün auf Node LTS + Node 24)
- ⬜ StorageBackend-Interface strikt durchgesetzt (Union-Typ entfernen, dbService konform)

### Tauri Feature-Parität ✅ abgeschlossen

- ✅ fileSystemService: Retry-Logik, LZ-String-Kompression, numerische Snapshot-IDs, `deleteImage()`, `hasSavedData()`, Auto-Snapshot (5 min, max 20)
- ✅ Story Codex + RAG-Vektoren: file-per-project Storage (`projects/{id}/codex/`)
- ✅ `storageService` / `codexService` routen alles über `StorageBackend`-Interface

### Ollama / Local-AI Integration ✅ abgeschlossen

**Architektur:** `aiProviderService.ts` → `ollamaService.ts` (HTTP-Client für localhost:11434)

| Modell                | Parameter | VRAM (min) | Stärken                    | Empfehlung    |
| --------------------- | --------- | ---------- | -------------------------- | ------------- |
| Qwen3 8B              | 8B        | 6 GB       | Multilingual, Reasoning    | ⭐ Primär     |
| DeepSeek V3.2 7B      | 7B        | 6 GB       | Coding, Reasoning          | Alternativ    |
| Llama 4 Scout 17B     | 17B       | 12 GB      | Multilingual, lang-context | Power-User    |
| Gemma 3 4B            | 4B        | 4 GB       | Kompakt, schnell           | Low-End       |
| Mistral Small 3.2 24B | 24B       | 16 GB      | Multilingual Instruction   | High-End      |
| Phi-4 Mini 3.8B       | 3.8B      | 4 GB       | Reasoning, kompakt         | Low-End       |
| GLM-4 9B              | 9B        | 8 GB       | Chinesisch+Englisch        | Nische        |
| Kimi K2 Instruct      | 32B (MoE) | 16 GB+     | Agentic, Tool-Use          | Experimentell |

**Hardware-Matrix:**

- **Minimum (4 GB VRAM):** Gemma 3 4B, Phi-4 Mini — Basis-Textgenerierung
- **Empfohlen (8 GB VRAM):** Qwen3 8B, DeepSeek V3.2 — Vollständige Toolchain
- **Optimal (16+ GB VRAM):** Llama 4 Scout, Mistral Small — Lange Manuskripte, komplexe Analyse

**UX-Spezifikation:**

```
Einstellungen → AI Provider → [Gemini Cloud | Ollama Local]
  ↳ Wenn Ollama: Modell-Dropdown (auto-detect via GET /api/tags)
  ↳ Server-URL: localhost:11434 (konfigurierbar)
  ↳ Status-Indikator: 🟢 Verbunden / 🔴 Nicht erreichbar
```

**Implementation-Schritte:** ✅ alle abgeschlossen

1. ✅ `services/ollamaService.ts` — HTTP-Client (`/api/generate`, `/api/chat`, `/api/tags`)
2. ✅ `aiProviderService.ts` — Provider-Registry mit Fallback-Chain (Gemini-Fallback bei Ollama-Fehler)
3. ✅ `features/settings/settingsSlice.ts` — `advancedAi.provider`, `advancedAi.model`, `advancedAi.ollamaBaseUrl`
4. ✅ `components/settings/AiProviderCard.tsx` + `AiSections.tsx` — Provider-Toggle, Modell-Auto-Detect, Status-Indikator
5. ✅ Prompt-Adapter — `sanitizeOllamaPrompt` + `buildOllamaPrompt` in `ollamaService.ts`
6. ✅ Default-Modell: Qwen3 8B (`ollama/qwen3:8b`)

### Codex Auto-Tracking (Story Codex)

Automatische Erfassung und Pflege einer „Story Bible" aus dem Manuskript:

- **RAG-Enhancement:** Beim Schreiben werden Entitäten (Charaktere, Orte, Gegenstände) automatisch extrahiert
- **Knowledge-Graph:** Beziehungen zwischen Entitäten visualisieren und pflegen
- **Widerspruchserkennung:** Echtzeit-Konsistenzprüfung gegen den Codex
- **Basis:** Existierender RAG-Vektoren-Store in IndexedDB v5

### Story Bible Light

Vereinfachte automatische Konsistenzprüfung:

- Charakter-Steckbriefe werden mit Manuskript-Erwähnungen abgeglichen
- Warnungen bei Namensänderungen, Altersinkonsistenzen, Ortwechseln
- Timeline-View für chronologische Konsistenz

### Visualize-Button (Image-Gen)

- Gemini Image Generation bereits implementiert (Charakter-Portraits, Welt-Ambiance)
- Erweiterung: „Szene visualisieren"-Button im Writer-View
- Optional: Stable Diffusion via Ollama/ComfyUI für lokale Bildgenerierung

---

## v1.2.1 — Release Blockers

**Status:** 📋 Geplant (vor erstem Tauri-Release erforderlich)

- ⬜ StorageBackend-Interface strikt durchgesetzt (Union-Typ entfernen, dbService konform)
- ⬜ Onboarding-Tour / Demo-Projekt beim ersten App-Start (Welcome-Portal)
- ⬜ Tauri v2 Release-Pipeline: Auto-Update (`tauri-plugin-updater`) + Code-Signing + GitHub Release Artifacts
- ⬜ FR/ES/IT Übersetzungen vervollständigen + CI-Gate (Lint-Fehler, wenn Key fehlt)
- ⬜ Bundle-Size-Budgets: rollup-plugin-visualizer als CI-Artifact + `performance.budget` in LHCI

---

## v1.3 — UX & Accessibility

**Status:** 📋 Geplant

- Mobile-First Touch-Optimierungen (Swipe-Navigation, Touch-DnD)
- AI-Creativity-Presets pro Projekt (nicht global)
- Erweiterte Keyboard Navigation
- High-Contrast-Mode Verbesserungen
- Visual Regression Tests (Playwright Screenshots + Storybook chromatic)

---

## v2.0 — Community & Collaboration

**Status:** 💡 Vision

- Full E2E-Encryption für P2P-Collaboration
- Community-Model-Liste (kuratierte Ollama-Modelle für kreatives Schreiben)
- Plugin-System für benutzerdefinierte AI-Tools
- Fine-Tuning/LoRA-Support für personalisierte Schreibstile
- Cloud-Sync Option (optional, E2E-verschlüsselt)
- Tauri Release-Pipeline — in v1.2.1 vorgezogen (Auto-Update, Code-Signing)

---

## Architektur-Entscheidungen

### Warum Ollama statt OpenAI-kompatibel?

- **Datenschutz:** Alle Daten bleiben lokal
- **Keine Kosten:** Keine API-Gebühren nach Hardware-Investition
- **Flexibilität:** Jedes GGUF-Modell nutzbar
- **Offline:** Funktioniert ohne Internetverbindung

### Warum nicht Full E2E in v1.x?

- **Komplexität:** Yjs-Dokument-Verschlüsselung erfordert Key-Exchange-Protokoll
- **Pragmatismus:** PSK-basierte Room-Isolation bietet bereits guten Schutz
- **Scope:** Focus auf Schreib-UX statt Crypto-Infrastruktur
