# StoryCraft Studio — Roadmap

## Vision

StoryCraft Studio soll die führende Open-Source-Plattform für KI-gestütztes kreatives Schreiben werden — offline-first, datenschutzfreundlich und erweiterbar.

### UX / PWA baseline audit (2026-05-11)

Messlatten aus dem UI-/PWA-Deep-Dive (Umsetzung im Repo, keine neue Pflicht-Doku):

- **Kernpfade:** Willkommen → Blank/Demo → Manuskript / Writer → Export → Settings — Orientierung über Sidebar, Command Palette und konsistente Glossar-Begriffe ([`docs/BEST-PRACTICES.md`](docs/BEST-PRACTICES.md)).
- **Responsive:** Mobile-Shell-E2E [`tests/e2e/mobile-shell.spec.ts`](tests/e2e/mobile-shell.spec.ts); kleine Viewports manuell für Bottom-Sheet und Writer-Split.
- **Design-Tokens:** Hotspots schrittweise auf `--sc-*` / `--ring-focus` ([`docs/Design-System.md`](docs/Design-System.md)); Legacy-Bridge in [`index.css`](index.css) bis Migration fertig.
- **Deep Links:** `?view=` wird beim Start gegen gültige Views validiert ([`hooks/useApp.ts`](hooks/useApp.ts)); PWA-Shortcuts im Manifest zeigen auf dieselben Keys ([`public/manifest.json`](public/manifest.json)).
- **Share Target:** GET-Parameter `share_title` / `share_text` / `share_url` → Toast + `sessionStorage` + URL-Bereinigung ([`App.tsx`](App.tsx)).
- **Service Worker:** `APP_VERSION` folgt `package.json` via [`scripts/sync-sw-version.mjs`](scripts/sync-sw-version.mjs) (`predev`/`prebuild`); **Network-only** für KI- und Local-Inference-Hosts ([`public/sw.js`](public/sw.js)); Precache nur über `install` + injiziertes `__WB_MANIFEST` (kein zweites `precacheAndRoute`-Paralleltrack).
- **HTML `lang`:** folgt der gewählten UI-Sprache ([`App.tsx`](App.tsx)).

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

## v1.3 — Dual persistence, Codex hardening, quality gates

**Status:** ✅ Released as **v1.3.0** (2026-05-08) — siehe [`CHANGELOG.md`](CHANGELOG.md), [`AUDIT.md`](AUDIT.md) (Follow-up 2026-05-08).

- Legacy → dual IndexedDB migration, Story Bible / Codex feature flags, scene visualization, `@google/genai` v2, Stryker + Playwright visual/a11y harness, Biome `--error-on-warnings`.
- **Documentation (2026-05-06):** Vollständige **15-Dateien**-Inventur + README Documentation Hub inkl. **`.github/ACTIONS-OPTIMIZATIONS.md`**; CI-/Copilot-Texte zu Dual-DB und E2E-Helfern — siehe [`AUDIT.md`](AUDIT.md) „Markdown corpus“ und [`CHANGELOG.md`](CHANGELOG.md) `[Unreleased]`.

---

## v1.2 — Security, Quality & Local AI

**Status:** ✅ Abgeschlossen (Security-Härting, Tauri-Parität, i18n×5, Spotlight-Tour — siehe CHANGELOG **[1.2.0]**)

### Security Hardening ✅ abgeschlossen

- ✅ CryptoKey non-extractable (`crypto.subtle.generateKey()`)
- ✅ CSP img-src hardening (`frame-ancestors 'none'`, `upgrade-insecure-requests`)
- ✅ Import-JSON Schema-Validation mit Valibot
- ✅ Collaboration Awareness-State Validation
- ✅ communityTemplateService → lokaler Static-Asset-Pfad
- ✅ OpenAI Stream Abort-Check, silent Model-Downgrade gestoppt
- ✅ Gemini Connection Test (echter API-Call)

### Code Quality ✅ größtenteils abgeschlossen

- ✅ **Dokumentation 2026-05:** `docs/CI.md`, README „Documentation Hub“, CONTRIBUTING (Biome/Node 22/Vite 8), Copilot/CLAUDE/AUDIT mit aktuellem Workflow synchronisiert
- ✅ Coverage-Config auf Glob-Patterns umgestellt
- ✅ TypeScript 6.0 übernommen (`stableTypeOrdering`, native `RegExp.escape`)
- ✅ Project/Settings-Save-Listener getrennt (Performance)
- ✅ SettingsView.tsx in 8 Sektions-Komponenten aufgeteilt (2116 LOC → ~234 LOC)
- ✅ constants.tsx in icons/defaults/index aufgeteilt
- ✅ projectSlice.ts in 6 Thunk-Domain-Dateien aufgeteilt (777 → 248 LOC)
- ✅ Lighthouse CI hard-fail aktiviert
- ✅ Test-Suite auf 160+ Tests ausgebaut (CI grün auf Node LTS + Node 24)
- ✅ StorageBackend-Interface — `storageBackend.ts`, strikte `StoryProject`-Typen am Proxy

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

- ✅ StorageBackend-Interface — `storageBackend.ts`, strikte `StoryProject`-Typen am Proxy
- ✅ Geführte Tour (Spotlight mit `driver.js`, Dashboard + Hilfe als Einstieg)
- ✅ Tauri Release-Pipeline: GitHub Release mit Installern bei `v*`-Tags — [`docs/TAURI-CI.md`](docs/TAURI-CI.md) / [`tauri-build.yml`](.github/workflows/tauri-build.yml)
- ⬜ Tauri v2 Auto-Update (`tauri-plugin-updater`) + Code-Signing — deferred to dedicated PR
- ✅ FR/ES/IT Key-Parität + CI-Gate (`pnpm run i18n:check`) — qualitative Übersetzungen iterativ
- ✅ Bundle-Size-Budgets + rollup-Analyse als CI (`pnpm run bundle:budget`, `analyze` Artifact — siehe [`docs/CI.md`](docs/CI.md)); optionales LHCI-Performance-Budget weiterhin roadmap-offen

---

## v1.4 — Command Center, Gold-Standard Pipeline & Security Hardening

**Status:** ✅ Released as **v1.4.0** (2026-05-12) — siehe [`CHANGELOG.md`](CHANGELOG.md)

- **Command Center:** `services/commands/` registry + `CommandPalette.tsx` (fuzzy search, recent/pinned, AI suggestions); `CommandExecutorProvider`; global shortcuts (`services/keyboard/`, `useGlobalKeyboardShortcuts.ts`); Settings → Shortcuts
- **Settings hub:** search over control hints; settings JSON import/export
- **Gold-Standard author pipeline:** Binder, research split, compile profile, Pandoc EPUB, VC word-level diff, scene timeline, readability sampling, LanguageTool, local RAG rebuild, WebGPU leader election
- **Hybrid-AI:** local backend presets (Ollama/LM Studio/vLLM), OpenAI-compatible base URL, configurable fallback chain, desktop port scan
- **Security:** all GitHub Actions pinned to SHA, CodeQL SAST, OpenSSF Scorecard, gitleaks, SLSA attestation, Dependabot, branch protection
- **Quality:** pnpm strict config, Lighthouse accessibility error gate (WCAG 2.2)

---

## Post-v1.4.0 / v1.5 — UX, Touch & weitere Qualität

**Status:** 📋 Geplant

- Mobile-First Touch-Optimierungen (Swipe-Navigation, Touch-DnD); **responsive E2E primär in CI** ([`docs/CI.md`](docs/CI.md))
- AI-Creativity-Presets pro Projekt (nicht global)
- Erweiterte Keyboard Navigation
- High-Contrast-Mode Verbesserungen (teilweise durch Accessibility-Hub ergänzt — iterativ)
- Visual Regression Tests (Playwright Screenshots + Storybook chromatic)
- Tauri v2 Auto-Update + Code-Signing (aus v1.2.1 verschoben)

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
