# StoryCraft Studio — Roadmap

## Vision

StoryCraft Studio soll die führende Open-Source-Plattform für KI-gestütztes kreatives Schreiben werden — offline-first, datenschutzfreundlich und erweiterbar.

> Current sprint tasks → [`TODO.md`](TODO.md)
> Completed items archive → [`docs/history/`](docs/history/)

---

## v1.1 — Stabilisierung & Härtung (aktuell)

**Status:** ✅ Abgeschlossen (siehe [docs/history/completed-v1.1.md](docs/history/completed-v1.1.md) für Details)

All critical, high, and most medium-priority items have been completed. Remaining open items tracked in [`TODO.md`](TODO.md):

- E2E-Tests erweitern (Projekt-Flow, Settings)
- ManuscriptView Resize-Listener Cleanup
- Request-Deduplizierung für AI-Calls
- DevContainer, Feature-Flag-System, Logging-Framework

---

## v1.2 — Local AI & erweiterte Werkzeuge

**Status:** 📋 Geplant

### Ollama / Local-AI Integration

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

**Implementation-Schritte:**

1. `services/ollamaService.ts` — HTTP-Client (`/api/generate`, `/api/chat`, `/api/tags`)
2. `aiProviderService.ts` erweitern — Provider-Registry mit Fallback-Chain
3. `features/settings/settingsSlice.ts` — `aiProvider: 'gemini' | 'ollama'`, `ollamaModel`, `ollamaUrl`
4. `components/SettingsView.tsx` — Provider-Toggle UI
5. Prompt-Adapter: Gemini-Prompts → Ollama-kompatibles Format transformieren

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

## v1.3 — UX & Accessibility

**Status:** 📋 Geplant

- Mobile-First Touch-Optimierungen (Swipe-Navigation, Touch-DnD)
- AI-Creativity-Presets pro Projekt (nicht global)
- Erweiterte Keyboard Navigation
- High-Contrast-Mode Verbesserungen
- Performance Budgets (Lighthouse CI)

---

## v2.0 — Community & Collaboration

**Status:** 💡 Vision

- Full E2E-Encryption für P2P-Collaboration
- Community-Model-Liste (kuratierte Ollama-Modelle für kreatives Schreiben)
- Plugin-System für benutzerdefinierte AI-Tools
- Fine-Tuning/LoRA-Support für personalisierte Schreibstile
- Cloud-Sync Option (optional, E2E-verschlüsselt)
- Tauri Release-Pipeline (Auto-Update, Code-Signing)

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
