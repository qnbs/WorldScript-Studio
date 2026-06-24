[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/qnbs/WorldScript-Studio)

# ✨ WorldScript Studio: Your AI-Powered Narrative Universe ✨

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/Redux_Toolkit-2.x-764ABC?logo=redux" alt="Redux Toolkit">
  <img src="https://img.shields.io/badge/Vite-8.x-646CFF?logo=vite&logoColor=white" alt="Vite 8">
  <img src="https://img.shields.io/badge/TypeScript-7.x_(tsgo)-3178C6?logo=typescript&logoColor=white" alt="TypeScript 7 (tsgo)">
  <img src="https://img.shields.io/badge/AI-Gemini_%7C_OpenAI_%7C_OpenRouter_%7C_Ollama_%7C_WebLLM-4285F4?logo=google" alt="Gemini · OpenAI · OpenRouter · Ollama · WebLLM">
  <img src="https://img.shields.io/badge/Local_AI-WebGPU_%7C_ONNX_%7C_Transformers.js-8B5CF6" alt="WebGPU · ONNX · Transformers.js">
  <img src="https://img.shields.io/badge/Version-v1.24.0-6366F1" alt="v1.24.0">
  <img src="https://img.shields.io/badge/Storage-IndexedDB_v8-F59E0B" alt="IndexedDB v8">
  <img src="https://img.shields.io/badge/PWA-v3.0-5BB974?logo=pwa" alt="PWA v3.0">
  <img src="https://img.shields.io/badge/i18n-19_locales-2806_keys-0EA5E9" alt="i18n 19 locales — 2806 keys">
  <img src="https://img.shields.io/badge/Tests-5807%2B_%2F_509_files-22C55E" alt="5807+ tests / 509 files">
  <img src="https://img.shields.io/codecov/c/github/qnbs/WorldScript-Studio?logo=codecov&label=Coverage" alt="Codecov Coverage">
  <img src="https://img.shields.io/badge/License-MIT-22C55E" alt="License MIT">
  <img src="https://img.shields.io/github/actions/workflow/status/qnbs/WorldScript-Studio/.github/workflows/ci.yml?branch=main&logo=github" alt="CI Status">
  <img src="https://img.shields.io/codecov/c/github/qnbs/WorldScript-Studio?logo=codecov" alt="Codecov Coverage">
  <img src="https://img.shields.io/badge/Lighthouse-90%2B-brightgreen" alt="Lighthouse Score">
  <a href="https://qnbs.github.io/WorldScript-Studio/"><img src="https://img.shields.io/badge/▶_Launch_Live-GitHub_Pages-22C55E?logo=github&logoColor=white" alt="Launch live on GitHub Pages"></a>
  <!-- CII Best Practices badge — register project at https://bestpractices.coreinfrastructure.org/ to activate -->
  <a href="https://bestpractices.coreinfrastructure.org/projects/XXXX"><img src="https://bestpractices.coreinfrastructure.org/projects/XXXX/badge" alt="CII Best Practices"></a>
</p>

---

## ⚠️ Legal Disclaimer

> **Educational & Personal Use**: WorldScript Studio is a creative writing tool for educational and personal use. It does not provide professional, medical, legal, or financial advice. Users are solely responsible for the content they create and must comply with all applicable local laws and platform policies.

---

## 🌐 Live Demo

Two always-on hosted builds — open whichever you prefer (identical app, both auto-deployed from `main`):

| | Host | Link |
|---|---|---|
| 🟢 | **GitHub Pages** _(always-on mirror — auto-deployed from `main` on every green build)_ | **🚀 <https://qnbs.github.io/WorldScript-Studio/> 🚀** |
| ▲ | **Vercel** _(primary)_ | <https://worldscript-studio.vercel.app/> |

> **Tip:** If the Vercel build is ever rate-limited, the **[GitHub Pages mirror](https://qnbs.github.io/WorldScript-Studio/)** is always live and current.

✨ _Try it right now — no installation, no account required. All data is saved securely in your browser's IndexedDB._ ✨

### PWA & Desktop

- **Install as PWA:** In Chromium/Edge, open the Live Demo → use the install icon in the address bar (or browser menu) for an offline-capable app shortcut.
- **Desktop installers:** GitHub **Releases** for tags `v*` include Tauri bundles when the workflow runs — signed `.appimage`, `.msi`, and `.dmg` artifacts with an auto-generated `latest.json` update manifest. **v1.9+** adds a native **File/Help menu**, **window-state restore**, in-app **updater UI** (Settings → About), and **open data folder** (Settings → Data). See [`docs/TAURI-CI.md`](docs/TAURI-CI.md), [`docs/TAURI-UPDATER.md`](docs/TAURI-UPDATER.md), and [`docs/history/sprints/SPRINT-V1.10.md`](docs/history/sprints/SPRINT-V1.10.md).

---

**WorldScript Studio is a cutting-edge, AI-enhanced application meticulously engineered for authors, screenwriters, and creators.** It transforms the daunting task of writing into a seamless, inspiring journey from a fleeting idea to a polished manuscript. By integrating a multi-provider AI stack — including Google Gemini, OpenAI, OpenRouter, Grok, Claude, Ollama, and a fully browser-native 4-layer local inference engine — with an intuitive, offline-first interface, WorldScript Studio acts as your all-in-one creative co-pilot, empowering you to build, write, and refine your narrative universe without compromise. Four **AI Execution Modes** (Hybrid · Cloud · Local · Eco) let you choose the right balance between quality, privacy, and battery life at any moment.

---

## ⚡ Quick Start (60 seconds)

**The fastest path to value — no install, no account, no API key:**

1. **Open the Live Demo** — [GitHub Pages (always-on)](https://qnbs.github.io/WorldScript-Studio/) or [Vercel](https://worldscript-studio.vercel.app/) → click **"Try Demo Project"** on the Welcome screen to load a populated story instantly.
2. Open the **Manuscript** view (sidebar) and start typing. Press **`⌘K` / `Ctrl-K`** anytime for the Command Palette — every action is reachable from there.
3. Want AI without a cloud key? **Settings → AI Provider → WebLLM** runs a model entirely in your browser (WebGPU; auto-falls back to ONNX/WASM on any device). Prefer cloud? Paste a Gemini/OpenAI key — it's encrypted at rest in your browser and only ever sent to that provider.

> Everything is saved locally in IndexedDB and works offline (PWA). Nothing leaves your device unless you choose a cloud provider.

**Running it yourself?** `pnpm install && pnpm run dev` (Node ≥ 22, pnpm 11) → <http://localhost:3000>. Full setup, deployment, and AI-provider options — including the new **OpenRouter** free-tier gateway — are in [Getting Started](#getting-started).

---

## 📖 Table of Contents

- [Quick Start (60 seconds)](#-quick-start-60-seconds)
- [Why WorldScript Studio?](#-why-worldscript-studio)
- [Features: A Comprehensive Creative Suite](#-features-a-comprehensive-creative-suite)
- [AI Provider Stack](#-ai-provider-stack)
- [Technology Deep Dive](#️-technology-deep-dive)
- [Project Structure](#-project-structure)
- [Getting Started](#getting-started)
- [CI & Local Validation](#-ci--local-validation)
- [A Creative Workflow](#-a-creative-workflow)
- [Contributing](#-contributing)
- [Documentation Hub](#-documentation-hub)
- [Deutsche Version (German)](#-worldscript-studio-deutsch)

---

## 🤔 Why WorldScript Studio?

In a world of generic text editors and bloated writing software, WorldScript Studio carves its own niche by focusing on a holistic, AI-augmented narrative design process.

- **✍️ From Macro to Micro:** Most tools focus only on writing. We cover the _entire_ creative lifecycle — from high-level plot structure and world-building down to sentence-by-sentence prose refinement.
- **🧠 Intelligent Partnership:** The AI is not a ghostwriter — it's a Socratic partner, a tireless brainstormer, and a creative muse. It's designed to break blocks and expand your own potential, not replace it.
- **🔒 Ultimate Privacy & Ownership:** Your manuscript and project data stay on this device by default (IndexedDB in the browser, or local files in the desktop app). Cloud AI features send only the prompts and context you trigger to the provider you configure. Use local/Ollama/WebLLM mode if you want AI without sending text to any cloud API. There is no WorldScript account — you stay in control of exports and backups.
- **🔬 Built-in Quality Tools:** Go beyond writing with the AI Critic, Plot-Hole Detector, and RAG Consistency Checker — tools that help you catch narrative weaknesses before your readers do.
- **⚡ Browser-Native AI:** A 4-layer local inference stack (WebGPU → ONNX WASM → Transformers.js → heuristics) means local AI works even without Ollama — entirely in-browser, no server, no download manager.

---

## 🚀 Features: A Comprehensive Creative Suite

### 📊 Dynamic Project Dashboard

Your mission control. Track word counts against custom goals, visualize project statistics, manage your title and logline with AI assistance, and access all views from a single hub. The dashboard opens with a **personalized, time-aware greeting header** and a one-click **Continue Writing** jump-back into your last-edited scene. Surfaced cards include:

- **Writing Momentum** — current/longest streak, today-vs-daily-goal and week-vs-weekly-goal progress, and a 14-day activity sparkline (wired to the progress tracker).
- **Project Goals + Pace Projection** — words remaining and the required words/day to hit your deadline, with an on-track / behind verdict.
- **Project Health Score** (optional, `enableProjectHealthScore`) — a radial gauge plus per-dimension breakdown bars (writing progress, cast depth, worldbuilding).
- **Manuscript Composition** — scene-status distribution segmented bar, reading-time estimate, scene count, and average words/scene.
- **Author insights** — **readability sampling** (Flesch-style heuristic) and **scene-timeline rule hints**.

Everything is computed locally without sending manuscript text to the cloud.

### ✍️ Three-Panel Manuscript Editor

A focused, distraction-free writing environment. The central editor is flanked by a draggable chapter **Navigator** and a project **Inspector**. An advanced overlay provides real-time highlighting and linking for `@character` and `#world` mentions, turning your manuscript into a living document. Includes **Zen Mode** for full-screen distraction-free writing, **spell-check with suggestions**, and **grammar & style hints**.

### 🎬 Plot-Board v2 _(Visual Story Planning)_

Three co-existing modes for visual story planning:

| Mode | What it does |
|------|-------------|
| **Swimlane** | Kanban drag-and-drop across 3-act columns |
| **Canvas** | Free-form pan/zoom board — position scenes anywhere; pinch-to-zoom on mobile |
| **Timeline** | Gantt-style scene timeline with rule hints |

**SVG Connection Layer:** Draw cause-effect, parallel, subplot, temporal, and character-arc arrows between scenes. Hover to edit label or type; click to select and delete. Keyboard accessible (`role="button"` + `tabIndex`).

**Subplot System:** Color-coded subplot lanes with filter toggle — dims unrelated scenes to focus on one storyline at a time.

**Tension Curve:** 800×200 SVG chart showing auto-computed dramatic tension (status-based 0–10 score) with drag-to-override points. Beat sheet overlays: Three-Act, Save the Cat!, Hero's Journey marker presets.

**Mini-map:** Fixed 80×50 px SVG overview in corner for spatial orientation on the free-form canvas.

### 📖 Real-Time Book Preview

Scrivener-style "Scrivenings" mode — a scrollable, paginated view of your entire manuscript rendered as formatted prose. Updates live as you write:

- **Collapsible TOC sidebar** with IntersectionObserver-driven active chapter highlight
- **Font controls:** family (system-ui / serif / monospace), size (12–24 px), word-count margin annotations
- **Fullscreen mode** (`position: fixed inset-0`) with ESC-to-dismiss; independent of the app theme
- **Export button** opens the Export view in EPUB mode

### 📊 Progress Tracker Dashboard

Dedicated analytics view — the first thing a writer sees each day:

- **Circular SVG progress ring** for today's word-count goal
- **Live session timer** (`role="timer"`) with start/stop; shortcut `Ctrl+Shift+S`
- **Streak display** — current streak and longest streak computed from writing history
- **30-day velocity area chart** (pure SVG, no external chart library)
- **12-week GitHub-style heatmap** (84 `<rect>` cells, 5 intensity shades)
- **Inline goal editor** for daily/weekly word targets

### 🗒️ Reference Panel & Threaded Comments

**Reference Panel** — an iPad-style 6-tab sidebar in the manuscript editor:

| Tab | Content |
|-----|---------|
| Characters | Mini-cards for scene's characters with backstory excerpt |
| World | Linked locations with geography excerpt |
| Notes | Inline editable notes synced to the scene |
| Binder | Linked binder node content |
| Comments | Threaded comment panel (see below) |
| Revisions | Per-scene snapshot history |

**Threaded Comments:** Add comments anchored to any scene, reply inline, resolve/unresolve with a badge counter in the toolbar.

**Per-Scene Revision History:** IndexedDB-backed snapshots with word-level diff view and named snapshot labels. Two-step restore with confirmation.

### 🕸️ Character Relationship Graph _(Interactive Visualization)_

An interactive, force-directed graph that visualizes all relationships between your characters. See at a glance who knows whom, who is in conflict, and how your cast interconnects — invaluable for complex multi-POV narratives.

### 📚 Intelligent Story Template Library

Jumpstart your creativity with a library of classic structures (Three-Act, Hero's Journey, Save the Cat! Beat Sheet, Fichtean Curve) and genre templates (Fantasy, Thriller, Horror, Romance, Space Opera, and more). **Remix any template** by dragging, editing, or adding sections. **Personalize with AI** to generate chapter-specific prompts based on your unique concept. Browse **Community Templates** alongside your own saved templates.

### 🤖 AI Outline Generator

The ultimate cure for the blank page. Provide a concept and let the AI architect a detailed, chapter-by-chapter outline. Advanced controls let you specify genre, pacing, key characters, setting, and even mandate a specific plot twist. The result is a fully interactive, editable structure you can apply to your manuscript with one click.

### 👥 Advanced Character Dossiers

Breathe life into your cast. Use the **AI Profile Generator** to create compelling backstories, motivations, and personality traits from a single concept. Generate a unique **AI character portrait** in a choice of styles (realistic, anime, cartoon, comic book). Manage relationships and character arcs with dedicated fields. A **roster toolbar** adds live search, sort (name / completeness), and at-a-glance cast stats (total, developed, with-portrait, average completeness), while each card shows a **completeness ring** signalling how fully developed that character is — so gaps in a large cast are obvious at a glance.

### 🌍 Expansive World-Building Atlas

Construct the universe of your story. Define your world's history and lore, create interactive timelines and location lists, and let the **AI World Generation** feature write rich, consistent world-building content. Generate an atmospheric **ambiance image** to capture your world's visual identity. The same **roster toolbar** (search, sort, stats — total, developed, locations, average completeness) and per-world **completeness ring** keep large atlases navigable and surface under-developed worlds.

### ✨ AI Writing Studio _(10 Specialized AI Tools)_

Your tireless creative co-pilot, available at every stage:

| Tool                      | What it does                                                               |
| ------------------------- | -------------------------------------------------------------------------- |
| **Continue Writing**      | Seamlessly continues from your last sentence in your voice                 |
| **Improve Writing**       | Rewrites selected prose for clarity, flow, and impact                      |
| **Change Tone**           | Shifts the register of any passage (darker, funnier, more formal, …)       |
| **Generate Dialogue**     | Creates authentic, in-character conversations                              |
| **Brainstorm Ideas**      | Generates creative plot possibilities for what comes next                  |
| **Generate Synopsis**     | Creates a concise, polished summary of any section                         |
| **Grammar & Style Check** | Catches errors and suggests stylistic improvements                         |
| **AI Critic**             | Delivers an honest, structured literary critique of your prose             |
| **Plot-Hole Detector**    | Analyzes your manuscript for logical inconsistencies and continuity errors |
| **Consistency Checker**   | Cross-references your text against your character and world data via RAG   |

### 🔍 RAG Consistency Checker _(Advanced)_

A dedicated view using **Retrieval-Augmented Generation (RAG)** to give the AI deep, contextualized knowledge of your _entire_ project. It cross-checks your manuscript against character profiles and world-building notes to surface subtle inconsistencies and continuity errors that a read-through would miss.

### 🚀 ProForge Ultimate Author Pipeline _(Experimental — `enableProForge`)_

An 8-stage agentic manuscript editing pipeline that transforms the Writer view into a full **Human-in-the-Loop** editorial workflow — from raw draft to publication-ready manuscript. All processing runs client-side; no cloud dependency for the pipeline itself.

**Stage sequence:** Intake & Diagnostic → Structural → Line/Prose → Copy Edit → Proof → Production → Publishing → Analytics

Key design points:
- **Never auto-modifies** the manuscript — every agent output awaits explicit author approval in the Review Panel.
- **SupervisorAgent** applies heuristic quality gates between stages and can trigger one automatic retry when it detects a fallback output or low-quality score.
- **Self-evaluation loop** (`BaseAgent.selfReflect()`) flags incoherent AI output for a second-pass before surfacing to the author.
- **Critical Actions summary card** + severity-grouped Review Panel with Quick Accept for high-confidence suggestions (≥ 0.85).
- Enable via **Settings → Experimental Features → ProForge Pipeline**.

See [`docs/PROFORGE-PIPELINE.md`](docs/PROFORGE-PIPELINE.md) for full architecture, types, and agent reference.

### ✦ Global AI Copilot _(v2 — Ambient Intelligence Layer)_

An always-present AI writing assistant that surfaces proactive insights and lets you chat without leaving the editor. Enable via **Settings → Experimental → Enable Global AI Copilot**.

**Panel modes:**
- **Dialog** (default) — floating panel, bottom-right
- **Sidebar** — docked to the right edge on desktop (≥ 768 px); toggle with the dock/float icon

**v2 capabilities (shipped in latest release):**
- **Markdown rendering** — assistant replies render as formatted HTML (headings, bold, italic, code blocks, lists)
- **Apply to chapter** — if the last assistant message contains a fenced code block and a chapter is open, one click rewrites it (dispatched into redux-undo; `Ctrl+Z` reversal; gated to blocks ≥ 70 % of chapter length)
- **Inline Annotation Layer** — a badge inside the Manuscript Editor shows the heuristic insight count for the active chapter; clicking it opens the Copilot and scrolls to the relevant finding
- **Heuristics-only mode** — brain-icon toggle disables all AI calls; the Copilot replies using only the local [Heuristic Engine](docs/HEURISTIC-RULES.md) (8 built-in rules, pure TypeScript, no network)
- **ProForge integration** — each ProForge Review item has an **✦ Ask Copilot** chip that pre-fills the chat with the item's context

See [`docs/COPILOT.md`](docs/COPILOT.md) for the full feature guide and architecture overview, and [`docs/HEURISTIC-RULES.md`](docs/HEURISTIC-RULES.md) for the rule catalogue.

### 🌊 Flow Mode _(Distraction-Free Writing)_

A single-keystroke toggle that collapses all sidebars and chrome, leaving only the manuscript editor. Exit with `Escape` or the same toggle key. State is stored in the Zustand `transientUiStore` (`flowMode` flag) so it resets on page load.

### 🗣️ Voice Dictation & WASM Voice Engines _(v1.17 foundation + v1.19.0 WASM scaffold + v1.21 model download UI)_

Built-in speech-to-text via the browser's Web Speech API. Dictate scenes hands-free directly into the manuscript editor or into the Command Palette search field. **v1.19.0** adds WASM STT/VAD engine scaffolds; **v1.21** ships the full model download flow:

- **`WasmSttEngine`** (`services/voice/wasmSttEngine.ts`) — Whisper.cpp WASM interface scaffold (model download, chunked inference, 99+ language detection).
- **`SileroVadEngine`** (`services/voice/sileroVadEngine.ts`) — Silero VAD v4 via ONNX Runtime Web (~2 MB model, lazy-loaded, replaces energy-threshold VAD).
- **`VoiceModelDownloadModal`** (`components/voice/`) — Progress bar, per-model cancel (AbortController), and retry for both Whisper STT (~42 MB) and Kokoro TTS (~15 MB). Triggered from **Settings → Voice** via separate "Download STT Model" / "Download TTS Model" buttons.
- Web Speech API fallback active in all environments; WASM engines activate when model is downloaded and `featureFlags.enableVoiceWasm` is on.

### ⌨️ Command Palette & Productivity Hub

A keyboard-first **command palette** (⌘K / Ctrl+K, plus configurable bindings in **Settings → Shortcuts**) drives navigation, AI actions, editor helpers, and project tools from one surface:

- **Typed command registry** (`services/commands/`) — fuzzy scoring with highlighted matches, category sections, optional AI-suggested rows from lightweight project signals (no extra network call required).
- **Recent & pinned commands** — persisted preferences (versioned local storage); pin/unpin from the palette context menu.
- **Voice input** — Web Speech integration for dictating palette queries where supported.
- **Global shortcuts** — `hooks/useGlobalKeyboardShortcuts.ts` + `services/keyboard/` evaluate Redux-backed shortcut bindings; conflicts surface in the Shortcuts editor.
- **Settings** — filter controls via the Settings search bar (`services/settingsSearchHints.ts`); **Import / Export** of a Zod-validated, privacy-conscious settings JSON subset (**Settings → Data** via `services/settingsExchange.ts`).
- **Help Center (v1.9)** — `services/help/helpCatalog.ts` drives 50+ articles across 11 categories (including **Advanced & Power Features**, **Technical Documentation**, and **Settings Guide**); full-text search (`helpSearch.ts`); AI assistant uses 16 offline doc chunks; **Try it** actions via `tryActionId`; tours from `services/spotlightTour.ts`. The in-app **Settings Guide** documents every live settings category (incl. Fine-Tuning/LoRA, Community, Plugins). All five primary locales include translated article bodies (es/fr/it complete as of v1.9); Arabic/Hebrew article prose ships as English fallback in the RTL Beta.
- **UI primitives** — shared **`Tooltip`**, **`EmptyState`**, and toast rows that trigger a **registered command** via `commandId` (see `features/status/statusSlice.ts`).
- **Feature flags** — `enableProjectHealthScore` (dashboard card) lives in `features/featureFlags/featureFlagsSlice.ts`. (Cross-project search was promoted to permanent core behaviour in v1.8 and no longer has a flag.)

### 🔭 Cross-Project Search _(v2 — Privacy-Preserving Index)_

Search across **all your projects** without loading them into memory. An IndexedDB-based privacy-preserving index (DB v8, `projects-index-store`) stores only lightweight metadata per project — title, logline, word count, character names — never manuscript plaintext.

- **Two-phase search:** Phase 1 queries the index (instant); Phase 2 loads the full project on demand for deep-match excerpts.
- **Auto-indexing** on every save via `listenerMiddleware` (permanent core behaviour since v1.8).
- **Index management:** `crossProjectIndexService.ts` exposes `indexProject`, `listIndexedProjects`, `removeProjectIndex`.
- Fully localized across all 5 UI languages.

### 🤝 Real-Time Collaboration with Full E2E Encryption

Real-time P2P co-editing via **Yjs + collab-transport** (vendor fork of y-webrtc 10.3.0 with E2E encryption baked in) with multiple signaling endpoints for automatic failover:

- **RTCDataChannel in-flight E2E encryption** — all Yjs sync updates and awareness protocol messages over peer-to-peer WebRTC data channels are encrypted via AES-256-GCM using a room key. Shipped via `packages/collab-transport` (vendor fork with applied patch).
- **Room isolation** — room IDs are derived from a SHA-256 hash of the room name.
- **AES-256-GCM key derivation** — `collaborationService.ts` includes `deriveEncryptionKey()` (PBKDF2, 600 000 iterations, SHA-256), `encryptUpdate()` / `decryptUpdate()` (AES-256-GCM, 12-byte random IV), and `getEncryptionStatus()`.
- **Encryption status badge** — CollaborationPanel shows green `E2E Key Derived (AES-256-GCM)` or amber `Room isolation only` based on whether a room password is set.
- **Security warning banner** (`role="alert"`, `aria-live="polite"`, WCAG 2.2 AA) visible before connecting explains that public signaling relays observe connection metadata; disappears after connect.
- **Configurable signaling URLs** in Settings → Collaboration.
- Default signaling endpoints: `wss://y-webrtc-signaling.fly.dev`, `wss://signaling.yjs.dev`.

#### Self-host signaling (Cloudflare Worker)

1. Deploy a y-webrtc-compatible signaling worker using an established open-source recipe.
2. Add your endpoint to `SIGNALING_SERVERS` in `services/collaborationService.ts`.
3. Allow your endpoint in the CSP `connect-src` directive in `index.html`.
4. Keep at least one fallback endpoint during migration to avoid downtime.

### 🔒 IDB At-Rest Encryption _(B-1, v1.19.0)_

All project data, snapshots, and settings stored in IndexedDB can be encrypted at rest via `services/storage/storageEncryptionService.ts`:

- **AES-256-GCM** with a PBKDF2-derived key (600 000 iterations, SHA-256, 32-byte random salt).
- Gated behind `featureFlags.enableIdbAtRestEncryption` (on by default since v1.23; the passphrase unlock UX is complete — Settings → Privacy).
- Web build: passphrase-entry unlock screen on cold start (session-scoped in-memory key).
- Tauri build: transparent OS-keychain protection via `tauri-plugin-stronghold` (no user friction).
- GDPR-compliant: encrypted blobs are unreadable without the passphrase, even from the browser profile directory.

### 🔐 Encrypted Library Backup

One-click encrypted export of your entire project library from **Settings → Data**:

- Archives all projects as a **ZIP** containing `META.json` + `vault.bin`.
- `vault.bin` is encrypted with **AES-256-GCM** — the decryption key is derived from your chosen passphrase using PBKDF2.
- No plaintext project data ever leaves your device unencrypted.
- Import on any device using the same passphrase to restore your full library.

### 💾 Robust Offline-First Data Management

- **Auto-save** to IndexedDB on every change (debounced, non-blocking)
- **Snapshot system** — automatic and manual project backups, restorable to any point in time
- **Import / Export** project files as JSON or encrypted ZIP backups
- **Undo / Redo** with a 100-step history (Redux-Undo)
- **IndexedDB v8** schema with dedicated stores per data type and automatic migration

### 📤 Polished Export Suite

- **Markdown** (`.md`), **Plain Text** (`.txt`), **PDF** (with titlepage, configurable font and spacing)
- **Word / DOCX** — `.docx` generation via `docx` + `jszip` (lazy-loaded)
- **AI Synopsis** — generate a one-page synopsis before exporting
- **Paste-friendly format** — copy rich text for Google Docs / Notion
- Selective content inclusion (title & logline, characters, worlds, manuscript sections)

### 📱 Progressive Web App (PWA) v3.0

- **Offline-first** — all assets cached via Service Worker (Workbox-based)
- **Installable** on desktop and mobile (iOS & Android)
- **App shortcuts** for quick access from the home screen icon
- Update notifications and background sync support

### 🎨 Highly Customizable Workspace

- **Dark / Light** themes with smooth transitions
- Adjustable **font family, size, line height**, and **paragraph spacing**
- **Indent first line** toggle for traditional novel formatting
- Tunable **AI Creativity Level** (Focused → Balanced → Imaginative)
- Full **Accessibility settings** (high contrast, reduced motion, color-blind modes) — WCAG 2.2 AA–oriented

### 🌐 Full Multi-Language Support

Shipped UI locales with **2806 i18n keys** across all 17 languages — zero hardcoded user-facing strings:

- 🇩🇪 **German** (Deutsch)
- 🇬🇧 **English**
- 🇫🇷 **French** (Français)
- 🇪🇸 **Spanish** (Español)
- 🇮🇹 **Italian** (Italiano)
- 🇸🇦 **Arabic** (العربية) — *Beta, RTL*
- 🇮🇱 **Hebrew** (עברית) — *Beta, RTL*
- 🇮🇷 **Persian / Farsi** (فارسی) — *Beta, RTL*
- 🇯🇵 **Japanese** (日本語) — *Near-Production*
- 🇨🇳 **Chinese Simplified** (简体中文) — *Near-Production*
- 🇵🇹 **Portuguese** (Português) — *Near-Production*
- 🇬🇷 **Greek** (Ελληνικά) — *Near-Production*
- 🇫🇮 **Finnish** (Suomi) — *Beta*
- 🇸🇪 **Swedish** (Svenska) — *Beta*
- 🇭🇺 **Hungarian** (Magyar) — *Beta*
- 🇮🇸 **Icelandic** (Íslenska) — *Beta*
- 🌐 **Basque** (Euskara) — *Beta*
- 🇷🇺 **Russian** (Русский) — *Beta*
- 🇰🇷 **Korean** (한국어) — *Beta*

**Quality tiers** — 🟢 **Production** (de/en/es/fr/it: full parity + translated help) · 🟡 **Near-Production** (ja/zh/pt/el: ≥96% UI coverage, 0 placeholder issues, `help.json` still English) · 🔵 **Beta** (the rest: machine-translated UI, English help). Per-locale coverage is tracked in [`docs/i18n/TRANSLATION_STATUS.md`](docs/i18n/TRANSLATION_STATUS.md) (generated by `pnpm run i18n:status`).

All trees stay in key parity (`pnpm run i18n:check`). Language selection persists via `localStorage`. Selector available in Settings, the Welcome Portal, and the Command Palette. In non-Production locales the in-app Help view shows a notice that long-form articles are still English.

**RTL Layout Beta** (Arabic / Hebrew / Persian): for Arabic & Hebrew all 18 UI modules are fully translated; `help.json` long-form prose remains English fallback (community follow-up). Self-hosted **Noto Sans Arabic / Hebrew** + **Noto Naskh Arabic** (manuscript editor) provide proper glyph coverage — including Persian's پ چ ژ گ ک ی. **Persian (`fa`)** ships as RTL Beta, **machine-translated** (glossary-anchored, ~93 % coverage; `help.json` long-form articles stay English fallback; human native review pending); direction and fonts are automatic (no App/CSS/font changes). Switching to ar/he/fa sets `html[dir="rtl"]`; a global `[dir="rtl"]` CSS net plus logical-property shell layout mirror the UI, while canvas/SVG boards (Plot Board, Character Graph) stay LTR to keep pointer/geometry math correct. The `enableRtlLayout` flag (off by default) additionally forces RTL for layout testing regardless of locale.

**Spotlight tour:** After first launch, a short guided tour (driver.js) highlights navigation, command palette, and Settings; restart anytime from the Dashboard ("Guided tour") or Help.

---

## 🧠 AI Provider Stack

WorldScript Studio supports **9 distinct AI execution paths**, automatically routing to the best available option based on the active **[AI Execution Mode](#-ai-execution-modes)**.

| Layer | Provider | Requires | Notes |
|-------|----------|----------|-------|
| **Cloud 1** | Google Gemini | API key (BYOK) | Primary cloud path; Gemini 2.0 Flash |
| **Cloud 2** | OpenAI | API key (BYOK) | GPT-4o, GPT-4o-mini |
| **Cloud 3** | Anthropic Claude | API key (BYOK) | Claude 3.5 Sonnet |
| **Cloud 4** | Grok (xAI) | API key (BYOK) | grok-3, grok-3-mini |
| **Cloud 5** | **OpenRouter** | Free or paid key | Unified gateway: DeepSeek R1, Llama 3.3 70B, Qwen 2.5 72B + 100s more; `:free` suffix = zero cost |
| **Local 1** | Ollama | Local server | Default model: Qwen3 8B; configurable URL |
| **Local 2** | WebLLM (WebGPU) | GPU + browser | MLC-packaged: Llama 3.2 1B/3B, Phi-3.5 Mini, Gemma 2 2B |
| **Local 3** | ONNX Runtime Web | WASM (any device) | Fallback when no WebGPU; runs fully in-browser |
| **Local 4** | Transformers.js | WASM / WebGPU | Hugging Face–compatible models; WebGPU or WASM backend |

> **Privacy-first routing:** WebLLM, ONNX, and Transformers.js run entirely in your browser — no network call, no API key needed. Automatic fallback down the stack ensures AI features always work, even offline.

> **OpenRouter free tier:** Sign up at [openrouter.ai/keys](https://openrouter.ai/keys) for a free key with 20 req/min. Models marked `:free` (e.g. `deepseek/deepseek-r1:free`) need no paid credits. Circuit breaker automatically pauses OpenRouter after 4 consecutive 429s and retries after 5 minutes.

### ⚙️ AI Execution Modes

**Settings → AI & Models → AI Execution Mode** lets you control exactly how AI requests are routed:

| Mode | Behaviour | Best for |
|------|-----------|----------|
| **Hybrid** _(default)_ | Local models when preloaded → cloud fallback when offline or no local model | Most users — best of both worlds |
| **Cloud** | All requests go to your configured cloud provider (Gemini, OpenAI, etc.) | Highest quality; requires API key + internet |
| **Local** | All AI runs on-device via Ollama / WebLLM / ONNX — nothing leaves your device | Maximum privacy; fully offline |
| **Eco** | Battery-saving: tiny 0.5 B model + rule-based heuristics only; no cloud, no GPU | Mobile / low-end hardware |

An **AI Mode Indicator** chip in the Copilot panel header shows the active mode and turns amber when OpenRouter's circuit breaker is open.

The active mode is persisted to `settings.aiMode` and synced to `aiModeService` via `listenerMiddleware` on every change — no page reload required.

### WebGPU Hardware Detection

`services/ai/webGpuDetectorService.ts` queries `navigator.gpu.requestAdapter()` and reports:
- **Status:** `available` / `unavailable` / `unknown`
- **Adapter name** and **architecture** (via `requestAdapterInfo()`)
- **VRAM tier:** `high` (≥ 8 GB) / `medium` (≥ 4 GB) / `low` — heuristic from `adapter.limits.maxBufferSize`

The Settings → AI panel shows a live GPU status badge with adapter details and model selectors for WebLLM and ONNX models.

---

## 💡 Our Philosophy

- **Privacy First** — All data stays local. No accounts, no cloud, no tracking.
- **AI as a Partner, Not a Replacement** — The AI augments your creativity; you remain the author.
- **Seamless Workflow** — Tools that get out of the way and keep you in your creative flow.
- **Quality Over Quantity** — Each AI tool has a single, specific purpose crafted for a real creative need.
- **Accessibility by Default** — WCAG 2.2 AA orientation, ARIA roles throughout, Lighthouse accessibility gate enforced in CI.

---

## 🛠️ Technology Deep Dive

| Layer                | Technology                                                | Purpose                                                              |
| -------------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| **UI Framework**     | React 19 + TypeScript 6 (strict)                         | Component-based, fully type-safe UI with `exactOptionalPropertyTypes` |
| **Build Tool**       | Vite 8 + pnpm 11 workspaces                              | App build + workspace orchestration (`packages/ai-core`, `packages/ui`) |
| **State Management** | Redux Toolkit 2.x + Redux-Undo + Zustand                 | Persistent (Redux), ephemeral (Zustand `transientUiStore`) state layers |
| **Styling**          | Tailwind CSS 4.x + CSS Variables                         | Utility-first design with theme-aware custom properties              |
| **Cloud AI**         | Gemini / OpenAI / Claude / Grok (BYOK)                   | Provider routing via `aiProviderService.ts`; Vercel AI SDK for streaming |
| **Local AI Layer 1** | WebLLM (`@mlc-ai/web-llm`)                               | WebGPU-accelerated LLM inference in-browser (MLC-packaged models)   |
| **Local AI Layer 2** | ONNX Runtime Web (`onnxruntime-web`)                      | WASM-based inference fallback; `vendor-ai-onnx` Vite chunk           |
| **Local AI Layer 3** | Transformers.js (`@xenova/transformers`)                  | Hugging Face model inference; WebGPU or WASM backend                 |
| **Local AI Layer 4** | Heuristic fallback (`@domain/ai-core`)                   | Rule-based responses when no model is available (always works)       |
| **Local Server AI**  | Ollama HTTP adapter                                       | Any locally served model; auto-detect via `/api/tags`                |
| **AI Facade**        | `packages/ai-core` workspace package                     | Unified local inference interface; sanitizeForPrompt truncation      |
| **Storage**          | Dual IndexedDB v8 (`StateDB` + `DataDB`)                 | Split state/asset persistence; LZ-String compression + AES-256-GCM  |
| **Collaboration**    | Yjs + `packages/collab-transport` (y-webrtc vendor fork)  | P2P CRDT editing; RTCDataChannel E2E AES-256-GCM; PBKDF2 600 000 iter |
| **Encryption**       | Web Crypto API (AES-256-GCM + PBKDF2)                    | API-key encryption at rest; IDB at-rest encryption; library backup vault |
| **PDF Export**       | jsPDF                                                     | Client-side, configurable PDF document generation                    |
| **Document Export**  | docx + jszip                                              | Word-compatible `.docx` generation (lazy-loaded)                     |
| **PWA**              | Service Worker + Web App Manifest v3                     | Offline support, installability, Workbox chunking                    |
| **i18n**             | Custom React Context (`I18nContext.tsx`)                  | 2806 keys × 19 locales (de/en/es/fr/it + ar/he/fa RTL Beta + ja/zh/pt/el/fi/sv/hu/is/eu Beta); EN fallback; `localStorage` persistence |
| **Testing**          | Vitest 4.x (5807+ tests / 509 files) + Playwright E2E    | Unit/integration + cross-browser E2E; Stryker mutation (manual workflow)          |
| **Code Quality**     | Biome (lint + format) + TypeScript 7 (tsgo) strict       | `--error-on-warnings` in CI; zero `any` policy                      |
| **Visualization**    | Force-directed graph                                      | Interactive character relationship network                           |
| **Desktop**          | Tauri v2                                                  | Cross-platform installer; auto-updater via `latest.json`             |

---

## 📂 Project Structure

```text
WorldScript-Studio/
├── packages/
│   ├── ai-core/          # Local AI facade: 4-layer stack (WebLLM → ONNX → Transformers.js → heuristic)
│   ├── collab-transport/ # Vendor fork of y-webrtc 10.3.0 with RTCDataChannel E2E encryption baked in
│   └── ui/               # Shared design tokens + Tailwind preset
├── app/                  # Redux store, typed hooks, listenerMiddleware, transientUiStore (Zustand)
├── components/           # All UI view components
│   ├── settings/         # Settings panel sections (AiProviderCard, AiSections, ShortcutsSection, …)
│   ├── writing/          # WriterViewUI, ToolsPanel, ToolInputs
│   └── ui/               # Reusable design-system atoms (Button, Modal, Toast, ErrorBoundary, …)
├── features/             # Redux Toolkit slices: project, settings, status, writer, versionControl, featureFlags
├── hooks/                # View business logic (use*View.ts naming); useGlobalKeyboardShortcuts
├── contexts/             # React Context providers: I18nContext, CommandExecutorContext, per-view contexts
├── services/             # External adapters and domain services
│   ├── ai/               # aiModeService (execution mode), aiPolicy, aiRetry, routingLogger
│   │   └── providers/    # openrouterProvider (circuit breaker, free-tier catalog)
│   ├── copilot/          # heuristicEngine (8 rules), insightGenerator, copilotContextService, actionApplier
│   ├── commands/         # Command registry: definitions, fuzzyScore, palettePreferences, commandBuilder
│   ├── keyboard/         # Shortcut matching, OS normalization, conflict detection
│   ├── help/             # RAG-lite retrieval for in-app help articles
│   └── settingsExchange/ # Zod-validated settings import/export
├── locales/              # i18n source JSON (de/en/es/fr/it × 15 modules each)
├── public/
│   ├── locales/          # i18n runtime bundles (rebuilt by pnpm run i18n:check / prebuild)
│   ├── sw.js             # PWA Service Worker
│   └── manifest.json     # PWA Web App Manifest v3
├── tests/
│   ├── unit/             # Vitest unit tests (5807+ tests, 509 files)
│   │   ├── ai/           # aiSmallModules, aiCoreFallbackPaths
│   │   └── settings/     # WebLlmPanel, AiSections
│   └── e2e/              # Playwright specs + helpers.ts
├── docs/                 # Extended documentation (CI, A11y, Design System, Tauri, Deployment, …)
├── src-tauri/            # Tauri v2 desktop app shell + Rust config
├── turbo.json            # Turborepo pipeline
└── types.ts              # Shared TypeScript interfaces and types (root level)
```

---

## Getting Started

### Prerequisites

A modern browser (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+) is all you need for the web app — no installation required.

For local development: **Node ≥ 22**, **pnpm 11** (`npm install -g pnpm`). For the desktop app: **Rust + Tauri CLI** (`cargo install tauri-cli`).

### 🔐 Setting Up AI

WorldScript Studio supports local-only AI (no API key) as well as BYOK cloud providers:

#### Option A: Google Gemini / OpenAI / Claude / Grok (BYOK cloud)

1. **Get your key** — e.g. at [Google AI Studio](https://aistudio.google.com/app/apikey) (free tier available)
2. **Open Settings** → AI Provider → select your provider
3. **Enter your API key** — encrypted with AES-256-GCM and stored only in your browser's IndexedDB; never transmitted except to the provider you select

**Security best practices:**
- ✅ Your key never leaves your device in plaintext
- ✅ Encrypted at rest via the Web Crypto API
- 🔒 **Recommended:** Restrict your Gemini key to `*.github.io` in Google AI Studio

#### Option B: Ollama (local server)

1. **Install Ollama** and pull a model: `ollama pull qwen3:8b`
2. Start Ollama (it runs a local HTTP server at `http://localhost:11434` by default)
3. In Settings → AI Provider → select **Ollama** and verify the connection

#### Option C: OpenRouter (free-tier cloud gateway)

Access 100+ open-source models — including strong free-tier options — through a single API key:

1. **Get a free key** at [openrouter.ai/keys](https://openrouter.ai/keys) (no credit card for `:free` models)
2. **Open Settings → OpenRouter** → toggle **Enable OpenRouter** → paste your `sk-or-v1-…` key → click **Save**
3. Choose a preferred model (default: `deepseek/deepseek-r1:free`) or type a custom model ID
4. Free tier: 20 req/min · 50 req/day without credits. The circuit breaker pauses automatically on rate-limit bursts and resumes after 5 minutes.

> OpenRouter slots in as Cloud 5 in the routing chain: after your configured primary cloud provider but before local fallbacks.

#### Option D: Browser-Native AI (WebGPU / ONNX / Transformers.js)

No installation, no server, no API key — AI runs directly in your browser:

1. **Open Settings → AI Provider** → select **WebLLM**
2. WorldScript Studio auto-detects WebGPU support and displays your GPU adapter + VRAM tier
3. **Choose a model** from the dropdown (Llama 3.2 1B/3B, Phi-3.5 Mini, Gemma 2 2B) and click pre-download
4. If no WebGPU is available, the ONNX Runtime Web layer activates automatically (WASM, any device)
5. Transformers.js serves as a further fallback — WebGPU or WASM backend, no manual config needed

> All local-inference layers run entirely in-browser. No network call is made for AI inference.

### 🚀 Deploying to GitHub Pages

1. **Fork** this repository
2. **Enable GitHub Pages:** Settings → Pages → Source: **GitHub Actions**
3. **Push to `main`** — deployment runs automatically via GitHub Actions
4. **Access your app** at `https://YOUR-USERNAME.github.io/WorldScript-Studio/`

### ☁️ Deploying to Vercel (alternative)

Vercel is a **first-class** hosting option alongside Pages: connect the repo, use **`pnpm run build`**, output **`dist`**, SPA routing via **[`vercel.json`](vercel.json)**. Use a **custom domain** on Vercel with Vite **`base: '/'`** for clean asset URLs; keep API keys **only in the app** (IndexedDB), not in Vercel env vars for inference. Full checklist: **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)**.

### 💻 Local Development

```bash
# Clone the repository
git clone https://github.com/qnbs/WorldScript-Studio.git
cd WorldScript-Studio

# Install dependencies (Node ≥ 22, pnpm 11)
pnpm install

# Start the development server (http://localhost:3000)
pnpm run dev

# Build for production
pnpm run build

# Preview the production build locally
pnpm run preview

# Run unit tests
pnpm run test:run

# Run unit tests with coverage
pnpm run test:coverage

# Type check
pnpm run typecheck

# Lint (Biome — warnings fail like CI)
pnpm run lint

# Check i18n key parity + rebuild runtime bundles
pnpm run i18n:check

# Tauri desktop app (requires Rust)
pnpm run tauri:dev
```

> **Note:** The production build uses Vite manual chunking — `vendor-ai-onnx` for `onnxruntime-web`, separate chunks for `docx`/`jszip`/Yjs — to keep the main bundle small and comply with Workbox's 8 MiB Service Worker cache limit.

### 🌐 Custom Domain Setup

1. Create a `CNAME` file in `public/` with your domain:

   ```bash
   echo "worldscript.yourdomain.com" > public/CNAME
   ```

2. Configure DNS at your registrar:
   - **Subdomain** → CNAME → `your-username.github.io`
   - **Apex domain** → A records to `185.199.108.153` – `185.199.111.153`
3. Push changes — the build auto-detects `CNAME` and switches the base path to `/`
4. Enable HTTPS in GitHub Pages settings

### 🛠 Troubleshooting

| Problem                   | Solution                                                              |
| ------------------------- | --------------------------------------------------------------------- |
| Blank page after deploy   | Verify `base` in `vite.config.ts` matches your repo name              |
| Assets not loading (404)  | Check `manifest.json` `start_url`; verify `404.html` is in `public/`  |
| AI features not working   | Check API key in Settings; verify it starts with `AIza` and has quota |
| WebLLM not loading        | Requires a WebGPU-capable browser (Chrome 113+); check GPU status badge in Settings |
| Language resets on reload | Clear site data and re-select — should persist via `localStorage`     |
| IndexedDB migration error | Open DevTools → Application → IndexedDB → delete both stores and reload |

---

## 🧪 CI & Local Validation

The main pipeline is [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Optional **desktop** bundles: [`.github/workflows/tauri-build.yml`](.github/workflows/tauri-build.yml) (`workflow_dispatch` / `v*` tags). Full reference: **[`docs/CI.md`](docs/CI.md)** and **[`docs/TAURI-CI.md`](docs/TAURI-CI.md)**. **CI health / audit log:** **[`.github/CI-AUDIT.md`](.github/CI-AUDIT.md)**.

| Job          | When / needs        | What it does |
| ------------ | -------------------- | ------------ |
| `security`   | every run            | `pnpm audit --audit-level=high`; `osv-scanner` vulnerability scan; gitleaks secrets scan; PRs: dependency review |
| `quality`    | after `security`     | Biome lint + format, **i18n key parity** (`pnpm run i18n:check`), `tsc --noEmit`, Vitest + V8 coverage (Node **22** + **24**); Codecov upload |
| `build`      | after `quality`      | Production Vite build, **chunk budget** (max 7 000 KB/chunk, 4 500 KB entry), **rollup analyze** artifact; on `main`: SLSA provenance attestation + Pages artifact |
| `e2e`        | after `quality`      | Playwright **Chromium**, `CI=true`; JUnit artifact uploaded for per-test PR annotations |
| `mutation`   | after `quality`      | Stryker (`pnpm run mutation`); `break: 75` enforced (high: 85, low: 70) |
| `lighthouse` | after `build`        | LHCI against `dist` — accessibility `error:0.95`, CLS `error:0.1`, performance `warn:0.4`, SEO `warn:0.8` |
| `storybook`  | after `quality`      | Static Storybook build artifact |
| `deploy`     | `main` only          | GitHub Pages after **`build` + `e2e`** succeed |
| `scorecard`  | weekly + `main` push | OpenSSF Scorecard — SARIF uploaded to GitHub Code Scanning |

**Current test metrics (2026-06-16):**
- **5807+ unit tests** across **509 test files** — all passing
- Coverage thresholds: lines ≥ 74 · branches ≥ 60 · functions ≥ 67 · statements ≥ 72 — enforced in CI (see Codecov badge for live metrics)
- i18n: **2806 keys × 19 locales** (en/de/fr/es/it + ar/he/fa RTL Beta + ja/zh/pt/el/fi/sv/hu/is/eu Beta)

**CI-cloud-first workflow (recommended):** On constrained hardware run **`pnpm run lint && pnpm run i18n:check && pnpm run typecheck`** locally, then push and let CI handle coverage, E2E, Lighthouse, and Stryker. Authoritative numbers come from CI artifacts (Codecov, JUnit). After CI goes green, update the README badges and `AUDIT.md` quality-gate line from the reported metrics. See **[`docs/CI.md`](docs/CI.md) § Cloud CI-first vs local development** for the full post-merge doc-update checklist.

**Low-resource / laptop workflow:** **`pnpm run test:run`** exercises Vitest without `--coverage` — fast and memory-light. Full coverage (`pnpm exec vitest run --coverage`) is intentionally RAM-heavy; rely on the CI `quality` job unless you are debugging a specific threshold.

**Quality-gate parity (matches CI `quality` job exactly):**

```bash
pnpm run lint && pnpm run i18n:check && pnpm run typecheck && pnpm exec vitest run --coverage
```

**Simulate CI locally with [Act](https://github.com/nektos/act):**

```bash
npm install -g act
act pull_request --job security --job quality
act push --job build --job e2e
```

Shared Playwright helpers (`waitForSpaReady`, `ensureBlankProject`, `clickNavItem`) live in **`tests/e2e/helpers.ts`** — do **not** rely on `networkidle` with the Vite dev server (HMR/WebSocket). Details: **`docs/CI.md`**.

---

## 🚀 A Creative Workflow

1. **Conceive** — Start in the **Welcome Portal** — a first-launch onboarding gate that orients you with feature highlights (AI Co-Pilot, Visual Plot Board, Characters & Worlds, Pro Export), an offline-first/privacy assurance, and a one-click demo project — then begin with a Template, the AI Outline Generator, or a blank manuscript.
2. **Build** — Create **Characters** and **Worlds** with AI. Visualize your cast in the **Character Relationship Graph**.
3. **Structure** — Refine your plot in the **Outline Generator** or arrange scenes visually on the **Scene Board**.
4. **Write** — Immerse yourself in the **Manuscript** editor. `@mentions` link characters and worlds. Progress is saved automatically.
5. **Enhance** — Use the **AI Writing Studio** to continue, improve, generate dialogue, or brainstorm.
6. **Review** — Run the **AI Critic** for literary feedback, the **Plot-Hole Detector** for logic issues, and the **Consistency Checker** for continuity.
7. **Snapshot** — Save a project version before major revisions. Restore to any snapshot anytime.
8. **Export** — Export as Markdown, plain text, Word/DOCX, or a formatted **PDF** with an AI-generated synopsis. Back up your entire library as an encrypted ZIP.

---

## 🤝 Contributing

- **🐛 Report Bugs** — Open a GitHub Issue with details and reproduction steps
- **💡 Suggest Features** — Open a Discussion or Issue
- **🌍 Improve Translations** — Five locale trees (`en` is the reference); native polish for FR/ES/IT especially welcome in PRs
- **🧪 Write Tests** — Coverage thresholds: branches ≥ 60 %, functions ≥ 67 %, lines ≥ 74 %; contributions to large components (collaboration, AI streaming paths, OpenRouter provider) are particularly valuable

See **[`CONTRIBUTING.md`](CONTRIBUTING.md)** for the full dev setup, Biome / Vitest / Playwright guide, and architecture notes.

---

## 📚 Documentation Hub

| Document | Description |
| -------- | ----------- |
| [`README.md`](README.md) | Product overview, features, getting started (this file) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Dev setup, Biome/Vitest/Playwright, architecture notes |
| [`CHANGELOG.md`](CHANGELOG.md) | Keep a Changelog–style release notes |
| [`ROADMAP.md`](ROADMAP.md) | Long-term features and quarterly planning |
| [`TODO.md`](TODO.md) | Current sprint tasks and status |
| [`AUDIT.md`](AUDIT.md) | Security & quality audit trail + scorecard |
| [`docs/AUDIT-PERFECTION-PLAN-v1.23.md`](docs/AUDIT-PERFECTION-PLAN-v1.23.md) | Living master plan for the v1.23 audit/perfection engagement (phase status + batch log) |
| [`docs/CI.md`](docs/CI.md) | GitHub Actions jobs, Node/pnpm parity, Act examples |
| [`docs/DEEPSOURCE-REVIEW-LOOP.md`](docs/DEEPSOURCE-REVIEW-LOOP.md) | DeepSource static-analysis correction loop (living runbook; complements the CodeAnt loop) |
| [`docs/DEEPSOURCE-REMEDIATION-PLAN.md`](docs/DEEPSOURCE-REMEDIATION-PLAN.md) | Prioritised DeepSource backlog tracker (P0-security→P5-docs) with triage decisions |
| [`docs/adr/`](docs/adr/README.md) | Architecture Decision Records — state-management boundaries, local-AI stack layering, WorkerBus v2 hybrid routing |
| [`docs/ACCESSIBILITY.md`](docs/ACCESSIBILITY.md) | A11y architecture (live regions, focus, WCAG 2.2, Lighthouse 0.95 gate) |
| [`docs/BEST-PRACTICES.md`](docs/BEST-PRACTICES.md) | Engineering + content guidelines, glossary, CI parity checklist |
| [`docs/Design-System.md`](docs/Design-System.md) | Tokens, Tailwind preset, UI primitives under `components/ui` |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | GitHub Pages + Vercel + Cloudflare Pages — `build` vs `build:edge`, SPA routing |
| [`docs/REPO-HOUSEKEEPING.md`](docs/REPO-HOUSEKEEPING.md) | GitHub language stats (Linguist), i18n bundles, cold-start translation fixes |
| [`docs/PLOT-BOARD.md`](docs/PLOT-BOARD.md) | Plot-Board v2 architecture: canvas, connections, subplots, tension curve |
| [`docs/PROGRESS-TRACKER.md`](docs/PROGRESS-TRACKER.md) | Progress Tracker: session lifecycle, streak algorithm, SVG charts |
| [`docs/history/sprints/SPRINT-V1.5.md`](docs/history/sprints/SPRINT-V1.5.md) | Sprint reference: v1.5 local-AI architecture implementation plan |
| [`docs/history/sprints/SPRINT-V1.6.md`](docs/history/sprints/SPRINT-V1.6.md) | Sprint reference: v1.6 Plot-Board v2 & Writer Experience |
| [`docs/history/sprints/SPRINT-V1.7.md`](docs/history/sprints/SPRINT-V1.7.md) | Sprint reference: v1.7 DuckDB Analytics + Hybrid RAG + AI Extensions |
| [`docs/history/sprints/SPRINT-V1.8.md`](docs/history/sprints/SPRINT-V1.8.md) | Sprint reference: v1.8 RAG prompt assembly + Writer/Plot Board AI |
| [`docs/history/sprints/SPRINT-V1.9.md`](docs/history/sprints/SPRINT-V1.9.md) | Sprint reference: v1.9 lazy loading, Help/Settings hub, Tauri desktop UX |
| [`docs/history/sprints/SPRINT-V1.10.md`](docs/history/sprints/SPRINT-V1.10.md) | Sprint reference: v1.10 mobile UX, coverage 55 %, deploy & help expansion |
| [`docs/COPILOT.md`](docs/COPILOT.md) | Global AI Copilot v2 — panel modes, heuristics, Apply-to-chapter, ProForge integration |
| [`docs/LOCAL-AI.md`](docs/LOCAL-AI.md) | Local AI setup & troubleshooting — WebGPU/WASM requirements, model downloads, storage management, fallback chain |
| [`docs/HEURISTIC-RULES.md`](docs/HEURISTIC-RULES.md) | Heuristic Rules Reference — 8 built-in manuscript analysis rules, how-to-satisfy guidance |
| [`docs/PROFORGE-PIPELINE.md`](docs/PROFORGE-PIPELINE.md) | ProForge Ultimate Author Pipeline — 8-stage agentic editing system architecture |
| [`docs/history/sprints/SPRINT-HANDOFF-2026-05-27.md`](docs/history/sprints/SPRINT-HANDOFF-2026-05-27.md) | Sprint handoff: v1.18.0/v1.18.1 ProForge Humanization & Refinement + TypeScript strict-mode sweep |
| [`docs/history/sprints/SPRINT-HANDOFF-2026-05-28.md`](docs/history/sprints/SPRINT-HANDOFF-2026-05-28.md) | Sprint handoff: v1.19.0 Phase 2 — B-1..B-8 security, voice WASM, collab-transport, a11y gate, RTL |
| [`docs/history/sprints/SPRINT-HANDOFF-2026-06-01.md`](docs/history/sprints/SPRINT-HANDOFF-2026-06-01.md) | Sprint handoff: 2026-06-01 CI hardening — 14 CodeAnt AI fixes, E2E stabilisation (24→0), prune-deployments, node24 upgrade |
| [`docs/IDB-ENCRYPTION.md`](docs/IDB-ENCRYPTION.md) | IDB at-rest encryption architecture (B-1, AES-256-GCM, passphrase-derived key) |
| [`docs/VOICE_MASTER_PLAN.md`](docs/VOICE_MASTER_PLAN.md) | Voice Full Support master plan — foundation v1.0 complete, WASM scaffold (B-2) in v1.19.0 |
| [`docs/PWA-AUDIT.md`](docs/PWA-AUDIT.md) | PWA manifest, service worker, share-target checklist |
| [`infra/low-end-ci/`](infra/low-end-ci/) | Local CI on low-end hardware (act + Eco-Forgejo) |
| [`docs/TAURI-CI.md`](docs/TAURI-CI.md) | Tauri desktop workflow: manual/tag builds, 7-step first-release checklist |
| [`docs/TAURI-UPDATER.md`](docs/TAURI-UPDATER.md) | Tauri plugin-updater: secrets table, `latest.json` auto-generation, signing |
| [`docs/graphify.md`](docs/graphify.md) | Graphify knowledge graph — multi-modal AST graph (`pnpm run graphify:update`) |
| [`docs/codegraph.md`](docs/codegraph.md) | CodeGraph semantic code intelligence — MCP-powered symbol graph (`pnpm run codegraph:update`) |
| [`docs/dual-graph-setup.md`](docs/dual-graph-setup.md) | Master guide for using Graphify + CodeGraph together |
| [`docs/history/completed-v1.1.md`](docs/history/completed-v1.1.md) | Archived release notes (v1.1.x) |
| [`tests/e2e/helpers.ts`](tests/e2e/helpers.ts) | Playwright helpers (no `networkidle` under Vite, portal bootstrap, sidebar scope) |
| [`.cursorrules`](.cursorrules) | **QNBS v3** — Cursor AI behavior for qnbs repos |
| [`CLAUDE.md`](CLAUDE.md) | Guidance for Claude Code |
| [`.github/copilot-instructions.md`](.github/copilot-instructions.md) | GitHub Copilot Chat context |
| [`.github/SECURITY.md`](.github/SECURITY.md) | Vulnerability reporting policy |
| [`.github/ACTIONS-OPTIMIZATIONS.md`](.github/ACTIONS-OPTIMIZATIONS.md) | Historical CI optimization notes (canonical: [`docs/CI.md`](docs/CI.md)) |

---
