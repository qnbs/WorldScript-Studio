# ✨ StoryCraft Studio: Your AI-Powered Narrative Universe ✨

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/Redux_Toolkit-6.x-764ABC?logo=redux" alt="Redux Toolkit">
  <img src="https://img.shields.io/badge/Vite-8.x-646CFF?logo=vite&logoColor=white" alt="Vite 8">
  <img src="https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript 6">
  <img src="https://img.shields.io/badge/AI-Gemini_%7C_Ollama-4285F4?logo=google" alt="Gemini + Ollama">
  <img src="https://img.shields.io/badge/Storage-IndexedDB-F59E0B" alt="IndexedDB">
  <img src="https://img.shields.io/badge/PWA-v3.0-5BB974?logo=pwa" alt="PWA v3.0">
  <img src="https://img.shields.io/badge/i18n-DE_%7C_EN_%7C_FR_%7C_ES_%7C_IT-0EA5E9" alt="i18n DE EN FR ES IT">
  <img src="https://img.shields.io/badge/License-MIT-22C55E" alt="License MIT">
  <img src="https://img.shields.io/github/actions/workflow/status/qnbs/StoryCraft-Studio/.github/workflows/ci.yml?branch=main&logo=github" alt="CI Status">
  <img src="https://img.shields.io/codecov/c/github/qnbs/StoryCraft-Studio?logo=codecov" alt="Codecov Coverage">
  <img src="https://img.shields.io/badge/Lighthouse-90%2B-brightgreen" alt="Lighthouse Score">
</p>

---

## ⚠️ Legal Disclaimer

> **Educational & Personal Use**: StoryCraft Studio is a creative writing tool for educational and personal use. It does not provide professional, medical, legal, or financial advice. Users are solely responsible for the content they create and must comply with all applicable local laws and platform policies.

---

## 🌐 Live Demo

**🚀 [Launch StoryCraft Studio in your Browser!](https://qnbs.github.io/StoryCraft-Studio/) 🚀**

✨ _Try it right now — no installation, no account required. All data is saved securely in your browser's IndexedDB._ ✨

---

**StoryCraft Studio is a cutting-edge, AI-enhanced application meticulously engineered for authors, screenwriters, and creators.** It transforms the daunting task of writing into a seamless, inspiring journey from a fleeting idea to a polished manuscript. By integrating the power of Google's Gemini API with an intuitive, offline-first interface, StoryCraft Studio acts as your all-in-one creative co-pilot — empowering you to build, write, and refine your narrative universe without compromise.

---

## 📖 Table of Contents

- [Why StoryCraft Studio?](#-why-storycraft-studio)
- [Features: A Comprehensive Creative Suite](#-features-a-comprehensive-creative-suite)
- [Technology Deep Dive](#️-technology-deep-dive)
- [Project Structure](#-project-structure)
- [Getting Started](#getting-started)
- [CI & Local Validation](#-ci--local-validation)
- [A Creative Workflow](#-a-creative-workflow)
- [Contributing](#-contributing)
- [Documentation Hub](#-documentation-hub)
- [Deutsche Version (German)](#-storycraft-studio-deutsch)

---

## 🤔 Why StoryCraft Studio?

In a world of generic text editors and bloated writing software, StoryCraft Studio carves its own niche by focusing on a holistic, AI-augmented narrative design process.

- **✍️ From Macro to Micro:** Most tools focus only on writing. We cover the _entire_ creative lifecycle — from high-level plot structure and world-building down to sentence-by-sentence prose refinement.
- **🧠 Intelligent Partnership:** The AI is not a ghostwriter — it's a Socratic partner, a tireless brainstormer, and a creative muse. It's designed to break blocks and expand your own potential, not replace it.
- **🔒 Ultimate Privacy & Ownership:** Your story is your most valuable asset. A 100% local, offline-first architecture with IndexedDB means your data never leaves your machine. No clouds, no accounts, no compromises.
- **🔬 Built-in Quality Tools:** Go beyond writing with the AI Critic, Plot-Hole Detector, and RAG Consistency Checker — tools that help you catch narrative weaknesses before your readers do.

---

## 🚀 Features: A Comprehensive Creative Suite

### 📊 Dynamic Project Dashboard

Your mission control. Track word counts against custom goals, visualize project statistics, manage your title and logline with AI assistance, and access all views from a single hub.

### ✍️ Three-Panel Manuscript Editor

A focused, distraction-free writing environment. The central editor is flanked by a draggable chapter **Navigator** and a project **Inspector**. An advanced overlay provides real-time highlighting and linking for `@character` and `#world` mentions, turning your manuscript into a living document.

### 🎬 Scene Board _(Visual Story Planning)_

A kanban-style drag-and-drop board for visual story planning. Organize your scenes across custom lanes, see your plot structure at a glance, and rearrange sections to check pacing and narrative flow without touching the manuscript.

### 🕸️ Character Relationship Graph _(Interactive Visualization)_

An interactive, force-directed graph that visualizes all relationships between your characters. See at a glance who knows whom, who is in conflict, and how your cast interconnects — invaluable for complex multi-POV narratives.

### 📚 Intelligent Story Template Library

Jumpstart your creativity with a library of classic structures (Three-Act, Hero's Journey, Save the Cat! Beat Sheet, Fichtean Curve) and genre templates (Fantasy, Thriller, Horror, Romance, Space Opera, and more). **Remix any template** by dragging, editing, or adding sections. **Personalize with AI** to generate chapter-specific prompts based on your unique concept.

### 🤖 AI Outline Generator

The ultimate cure for the blank page. Provide a concept and let the AI architect a detailed, chapter-by-chapter outline. Advanced controls let you specify genre, pacing, key characters, setting, and even mandate a specific plot twist. The result is a fully interactive, editable structure you can apply to your manuscript with one click.

### 👥 Advanced Character Dossiers

Breathe life into your cast. Use the **AI Profile Generator** to create compelling backstories, motivations, and personality traits from a single concept. Generate a unique **AI character portrait** in a choice of styles (realistic, anime, cartoon, comic book). Manage relationships and character arcs with dedicated fields.

### 🌍 Expansive World-Building Atlas

Construct the universe of your story. Define your world's history and lore, create interactive timelines and location lists, and let the **AI World Generation** feature write rich, consistent world-building content. Generate an atmospheric **ambiance image** to capture your world's visual identity.

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

### 🗣️ Voice Dictation

Built-in speech-to-text via the browser's Web Speech API. Dictate scenes hands-free directly into the manuscript editor.

### ⌨️ Command Palette

A keyboard-first command palette (⌘K / Ctrl+K) for instant navigation, AI actions, and project management — all without leaving the keyboard.

### 🦙 Local AI via Ollama _(Privacy-First)_

Run all AI features entirely on your own hardware — no API key, no internet, no data leaving your machine.

- Auto-detects installed models via Ollama's `/api/tags` endpoint
- Default model: **Qwen3 8B** (multilingual, reasoning-optimized, 6 GB VRAM)
- Configurable server URL (default `http://localhost:11434`)
- Automatic fallback to Gemini if Ollama is unreachable and a Gemini key is set
- Real-time connection status indicator in Settings

### 🎨 Highly Customizable Workspace

- **Dark / Light** themes
- Adjustable **font family, size, line height**, and **paragraph spacing**
- **Indent first line** toggle for traditional novel formatting
- Tunable **AI Creativity Level** (Focused → Balanced → Imaginative)
- Full **Accessibility settings** (high contrast, reduced motion, color-blind modes)

### 💾 Robust Offline-First Data Management

- **Auto-save** to IndexedDB on every change (debounced, non-blocking)
- **Snapshot system** — automatic and manual project backups, restorable to any point
- **Import / Export** project files as JSON backups
- **Undo / Redo** with a 100-step history (Redux-Undo)

### 📤 Polished Export Suite

- **Markdown** (`.md`), **Plain Text** (`.txt`), **PDF** (with titlepage, configurable font and spacing)
- **AI Synopsis** — generate a one-page synopsis before exporting
- Selective content inclusion (title & logline, characters, worlds, manuscript)

### 📱 Progressive Web App (PWA) v3.0

- **Offline-first** — all assets cached via Service Worker
- **Installable** on desktop and mobile (iOS & Android)
- **App shortcuts** for quick access from the home screen icon
- Update notifications and background sync support

### 🤝 Real-Time Collaboration Resilience

- Collaboration uses Yjs + y-webrtc with multiple signaling endpoints for failover.
- Default signaling endpoints: `wss://y-webrtc-signaling.fly.dev`, `wss://signaling.yjs.dev`.
- Room IDs are derived from a hash, but signaling operators can still observe connection metadata (timing and room identifier traffic patterns).

For production or sensitive collaboration environments, host your own signaling server.

#### Self-host signaling (Cloudflare Worker)

1. Deploy a y-webrtc-compatible signaling worker using an established open-source recipe.
2. Add your endpoint to `SIGNALING_SERVERS` in `services/collaborationService.ts`.
3. Allow your endpoint in the CSP `connect-src` directive in `index.html`.
4. Keep at least one fallback endpoint during migration to avoid downtime.

### 🌐 Full Multi-Language Support

Shipped UI locales (selector):

- 🇩🇪 **German** (Deutsch) — complete
- 🇬🇧 **English** — complete

Locale packs for 🇫🇷 French, 🇪🇸 Spanish, and 🇮🇹 Italian remain in `locales/` for future activation.

Language selection persists across sessions via `localStorage`.

---

## 💡 Our Philosophy

- **Privacy First** — All data stays local. No accounts, no cloud, no tracking.
- **AI as a Partner, Not a Replacement** — The AI augments your creativity; you remain the author.
- **Seamless Workflow** — Tools that get out of the way and keep you in your creative flow.
- **Quality Over Quantity** — Each AI tool has a single, specific purpose crafted for a real creative need.

---

## 🛠️ Technology Deep Dive

| Layer                | Technology                           | Purpose                                                              |
| -------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| **UI Framework**     | React 19 + TypeScript                | Component-based, fully type-safe UI                                  |
| **Build Tool**       | Vite 8                               | Instant dev server, optimized production builds with manual chunking |
| **State Management** | Redux Toolkit + Redux-Undo           | Predictable global state with 100-step undo history                  |
| **Styling**          | Tailwind CSS + CSS Variables         | Utility-first design with theme-aware custom properties              |
| **AI Integration**   | Google Gemini API (`@google/genai`)  | Multimodal generative AI for all creative features                   |
| **Local AI**         | Ollama HTTP client (`ollamaService`) | Privacy-first local inference; auto-detects models via `/api/tags`   |
| **Storage**          | IndexedDB (custom `dbService`)       | Large-capacity, async, offline-first local persistence               |
| **Encryption**       | Web Crypto API (AES-256-GCM)         | Client-side API key encryption before IndexedDB storage              |
| **PDF Export**       | jsPDF                                | Client-side, configurable PDF document generation                    |
| **Document Export**  | docx + jszip                         | Word-compatible `.docx` generation (lazy-loaded for export actions)  |
| **PWA**              | Service Worker + Web App Manifest v3 | Offline support, installability, app shortcuts                       |
| **i18n**             | Custom React Context system          | JSON locale files, EN fallback, `localStorage` persistence           |
| **Visualization**    | Force-directed graph                 | Interactive character relationship network                           |

---

## 📂 Project Structure

```text
StoryCraft-Studio/
├── components/           # All UI view components
│   └── ui/               # Reusable generic components (Button, Modal, Toast, …)
├── features/             # Redux Toolkit slices (project, settings, status, writer)
├── hooks/                # Custom hooks with all view business logic
├── contexts/             # React Context providers (i18n, per-view state sharing)
├── services/             # External API & storage adapters (gemini, db, storage)
├── locales/              # i18n source files (per language × per module)
├── public/
│   ├── locales/          # i18n runtime files (copied from locales/ at build)
│   ├── sw.js             # PWA Service Worker
│   └── manifest.json     # PWA Web App Manifest
├── app/                  # Redux store, listener middleware, utilities
└── types.ts              # Shared TypeScript interfaces and types
```

---

## Getting Started

### Prerequisites

A modern browser (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+) is all you need — no installation required.

### 🔐 Setting Up AI

StoryCraft Studio supports two AI providers — choose what fits your privacy needs:

#### Option A: Google Gemini (cloud, free tier available)

1. **Get your key** at [Google AI Studio](https://aistudio.google.com/app/apikey) — it's free
2. **Open Settings** → AI Provider → select **Gemini**
3. **Enter your API key** — encrypted with AES-256-GCM and stored only in your browser's IndexedDB

**Security best practices:**
- ✅ Your key never leaves your device
- ✅ Encrypted at rest via the Web Crypto API
- 🔒 **Recommended:** Restrict your key to `*.github.io` in Google AI Studio

#### Option B: Ollama (local, fully private)

1. **Install Ollama** and pull a model: `ollama pull qwen3:8b`
2. **Open Settings** → AI Provider → select **Ollama**
3. **Set server URL** (default `http://localhost:11434`) — models are auto-detected
4. All inference runs on your machine; no internet required

### 🚀 Deploying to GitHub Pages

1. **Fork** this repository
2. **Enable GitHub Pages:** Settings → Pages → Source: **GitHub Actions**
3. **Push to `main`** — deployment runs automatically via GitHub Actions
4. **Access your app** at `https://YOUR-USERNAME.github.io/StoryCraft-Studio/`

### 💻 Local Development

```bash
# Clone the repository
git clone https://github.com/qnbs/StoryCraft-Studio.git
cd StoryCraft-Studio

# Install dependencies
pnpm install

# Start the development server (http://localhost:3000)
pnpm run dev

# Build for production
pnpm run build

# Preview the production build locally
pnpm run preview
```

> Note: The production build uses Vite manual chunking and lazy-loaded export libraries (`docx` / `jszip`) to keep the main app bundle smaller and improve load performance.

### 🧪 CI & Local Validation

This repository uses a **single** workflow, [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Authoritative job graph and local parity commands: **[`docs/CI.md`](docs/CI.md)**.

| Job          | When / needs        | What it does |
| ------------ | -------------------- | ------------ |
| `security`   | every run            | `pnpm audit --audit-level=high`; PRs: dependency review |
| `quality`    | after `security`     | Biome, `tsc`, Vitest + coverage (Node **LTS** + **current**) |
| `build`      | after `quality`      | Production Vite build; on `main` (non-PR): Pages artifact |
| `e2e`        | after `quality`      | Playwright (Chromium, `CI=true`) |
| `lighthouse` | after `build`        | LHCI against `dist` (assertions in **`.lighthouserc.cjs`**) |
| `storybook`  | after `quality`      | Static Storybook build artifact |
| `deploy`     | `main` only          | GitHub Pages after **`build` + `e2e`** succeed |

Simulate parts of the pipeline with [Act](https://github.com/nektos/act) (job ids must match `ci.yml`):

```bash
npm install -g act
act pull_request --job security --job quality
act push --job build --job e2e
```

Optional Codecov: `act … -s CODECOV_TOKEN=<token>`.

### 🌐 Custom Domain Setup

1. Create a `CNAME` file in `public/` with your domain:

   ```bash
   echo "storycraft.yourdomain.com" > public/CNAME
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
| Language resets on reload | Clear site data and re-select — should now persist via `localStorage` |

---

## 🚀 A Creative Workflow

1. **Conceive** — Start in the **Welcome Portal** with a Template, the AI Outline Generator, or a blank manuscript.
2. **Build** — Create **Characters** and **Worlds** with AI. Visualize your cast in the **Character Relationship Graph**.
3. **Structure** — Refine your plot in the **Outline Generator** or arrange scenes visually on the **Scene Board**.
4. **Write** — Immerse yourself in the **Manuscript** editor. `@mentions` link characters and worlds. Progress is saved automatically.
5. **Enhance** — Use the **AI Writing Studio** to continue, improve, generate dialogue, or brainstorm.
6. **Review** — Run the **AI Critic** for literary feedback, the **Plot-Hole Detector** for logic issues, and the **Consistency Checker** for continuity.
7. **Snapshot** — Save a project version in Settings before major revisions. Restore anytime.
8. **Publish** — Export as Markdown, plain text, or a formatted **PDF** with an AI-generated synopsis.

---

## 🤝 Contributing

- **🐛 Report Bugs** — Open a GitHub Issue with details and reproduction steps
- **💡 Suggest Features** — Open a Discussion or Issue
- **🌍 Improve Translations** — `locales/` contains all i18n JSON files; PRs for FR/ES/IT are especially welcome

---

## 📚 Documentation Hub

| Document | Description |
| -------- | ----------- |
| [`README.md`](README.md) | Product overview, features, getting started (this file) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Dev setup, Biome/Vitest/Playwright, architecture notes |
| [`docs/CI.md`](docs/CI.md) | GitHub Actions jobs, Node/pnpm parity, Act examples |
| [`AUDIT.md`](AUDIT.md) | Security & quality audit trail + scorecard |
| [`ROADMAP.md`](ROADMAP.md) / [`TODO.md`](TODO.md) | Planning and sprint tasks |
| [`CHANGELOG.md`](CHANGELOG.md) | Keep a Changelog–style release notes |
| [`docs/graphify.md`](docs/graphify.md) | Optional knowledge-graph (Graphify) setup |
| [`.cursorrules`](.cursorrules) | **QNBS v3** — Cursor AI behavior for qnbs repos (context-first, StoryCraft “soul”) |
| [`CLAUDE.md`](CLAUDE.md) | Guidance for Claude Code |
| [`.github/copilot-instructions.md`](.github/copilot-instructions.md) | GitHub Copilot Chat context |
| [`.github/SECURITY.md`](.github/SECURITY.md) | Vulnerability reporting |

---

# 📖 StoryCraft Studio (Deutsch)

StoryCraft Studio ist eine hochmoderne, KI-gestützte Anwendung für Autoren, Drehbuchautoren und Kreative. Sie verwandelt das Schreiben in eine nahtlose, inspirierende Reise — von der ersten Idee bis zum fertigen Manuskript. Durch die Integration der Google Gemini API mit einer intuitiven, offline-fähigen Benutzeroberfläche ist StoryCraft Studio Ihr kreativer All-in-One-Copilot.

## 🚀 Funktionen

### 📊 Dynamisches Projekt-Dashboard

Ihre Kommandozentrale. Wortziele verfolgen, Projektstatistiken einsehen, Titel und Logline mit KI verwalten — alles auf einen Blick.

### ✍️ Drei-Fenster-Manuskript-Editor

Ablenkungsfreie Schreibumgebung mit Kapitel-**Navigator** und Projekt-**Inspektor**. Echtzeit-Hervorhebung für `@Charakter`- und `#Welt`-Erwähnungen.

### 🎬 Szenen-Board _(Visuelle Story-Planung)_

Kanban-Board zum Drag-and-Drop-Anordnen von Szenen. Tempo und Struktur visuell erkunden.

### 🕸️ Charakter-Beziehungsgraph _(Interaktive Visualisierung)_

Kräftebasierter Graph aller Charakter-Beziehungen — unverzichtbar für komplexe Mehrfach-Handlungsstränge.

### 📚 Intelligente Story-Vorlagen

Klassische Strukturen (Drei-Akt, Heldenreise, Save the Cat!, Fichtean-Kurve) und Genre-Vorlagen. Anpassen und mit KI personalisieren.

### 🤖 KI-Gliederungsgenerator

Detaillierte, interaktive Kapitelgliederung aus einer Idee — mit Genre, Tempo, Wendungen.

### 👥 Charakter-Dossiers

KI-Profilgenerator, Beziehungen & Charakterentwicklung, KI-generierte Porträts in verschiedenen Stilen.

### 🌍 Weltenbau-Atlas

KI-generierte Lore, Zeitachsen, Orte, atmosphärische Stimmungsbilder.

### ✨ KI-Schreibstudio _(10 spezialisierte Werkzeuge)_

| Werkzeug                    | Funktion                                             |
| --------------------------- | ---------------------------------------------------- |
| **Weiterschreiben**         | Nahtlose Fortsetzung in Ihrem Stil                   |
| **Verbessern**              | Klarheit, Fluss und Wirkung verbessern               |
| **Ton ändern**              | Stimmung und Register anpassen                       |
| **Dialog generieren**       | Figurengerechte Gespräche                            |
| **Ideen brainstormen**      | Kreative Plot-Möglichkeiten                          |
| **Synopse generieren**      | Präzise Zusammenfassung                              |
| **Grammatik & Stil**        | Fehler erkennen und stilistisch verbessern           |
| **KI-Kritiker**             | Strukturierte literarische Kritik                    |
| **Handlungsloch-Detektor**  | Logische Widersprüche aufdecken                      |
| **Konsistenz-Prüfer (RAG)** | Manuskript gegen Charakter- und Weltdaten abgleichen |

### 🔍 RAG-Konsistenz-Prüfer

Nutzt **Retrieval-Augmented Generation** für tiefgehende Konsistenzprüfung über das gesamte Projekt.

### 📱 Progressive Web App (PWA) v3.0

Installierbar auf Desktop und Smartphone. Offline-fähig. App-Shortcuts vom Home-Bildschirm.

### 🌐 Mehrsprachigkeit

- 🇩🇪 **Deutsch** — vollständig (in der App wählbar)
- 🇬🇧 **Englisch** — vollständig (in der App wählbar)
- 🇫🇷 Französisch, 🇪🇸 Spanisch, 🇮🇹 Italienisch — Locale-Dateien für spätere Aktivierung vorhanden

Sprachauswahl dauerhaft in `localStorage` gespeichert.

---

## 💡 Unsere Philosophie

- **Datenschutz an erster Stelle** — Alle Daten bleiben lokal; keine Konten, keine Cloud.
- **KI als Partner** — Die KI erweitert Ihre Kreativität, ersetzt Sie nicht.
- **Nahtloser Workflow** — Werkzeuge, die nicht im Weg stehen.
- **Qualität vor Quantität** — Jedes KI-Werkzeug hat eine klare, spezifische Aufgabe.

---

## 🛠️ Technologie-Stack

| Schicht            | Technologie                                        |
| ------------------ | -------------------------------------------------- |
| UI-Framework       | React 19 + TypeScript                              |
| Build              | Vite 8                                             |
| Zustandsverwaltung | Redux Toolkit + Redux-Undo                         |
| Styling            | Tailwind CSS + CSS-Variablen                       |
| KI (Cloud)         | Google Gemini API (`@google/genai`)                |
| KI (Lokal)         | Ollama HTTP-Client (localhost:11434)               |
| Speicher           | IndexedDB (eigener dbService)                      |
| Verschlüsselung    | Web Crypto API (AES-256-GCM)                       |
| PDF-Export         | jsPDF                                              |
| PWA                | Service Worker + Manifest v3                       |
| i18n               | Eigenes Context-System mit localStorage-Persistenz |

---

## Erste Schritte

### 🔐 Gemini API-Schlüssel einrichten

1. Kostenlosen Schlüssel bei [Google AI Studio](https://aistudio.google.com/app/apikey) holen
2. Einstellungen → Gemini API-Schlüssel → Eingeben und Speichern

### 💻 Lokale Entwicklung

```bash
git clone https://github.com/qnbs/StoryCraft-Studio.git
cd StoryCraft-Studio
pnpm install
pnpm run dev
```

---

## 🚀 Kreativer Arbeitsablauf

1. **Konzipieren** — Willkommensportal: Template, KI-Gliederung oder leeres Manuskript
2. **Erschaffen** — Charaktere, Welten und Beziehungen mit KI aufbauen
3. **Strukturieren** — Gliederungsgenerator oder Szenen-Board
4. **Schreiben** — Manuskript-Editor mit `@Erwähnungen` und Auto-Speichern
5. **Verbessern** — KI-Schreibstudio für alle kreativen Aufgaben
6. **Prüfen** — KI-Kritiker, Handlungsloch-Detektor, Konsistenz-Prüfer
7. **Sichern** — Snapshot erstellen vor großen Änderungen
8. **Exportieren** — Markdown, Text oder PDF

---

## 🤝 Mitwirken

- **🐛 Fehler melden** — GitHub Issue mit Beschreibung
- **💡 Features vorschlagen** — GitHub Issue oder Discussion
- **🌍 Übersetzungen verbessern** — `locales/`-Ordner; PRs für FR/ES/IT willkommen

**Entwickler-Dokumentation (engl.):** Siehe den Abschnitt *Documentation Hub* im englischen Teil dieser README sowie [`CONTRIBUTING.md`](CONTRIBUTING.md) und [`docs/CI.md`](docs/CI.md) für CI-Details.

---

## Fehlerverhalten & Hinweise

- Alle KI-Funktionen zeigen klare Fehlermeldungen bei API- oder Netzwerkproblemen.
- Die `ErrorBoundary` fängt globale Fehler ab und zeigt eine verständliche Meldung.
- Nutzer erhalten klare Hinweise, falls Export, KI oder Speicherung fehlschlägt.
- Die Sprachauswahl wird dauerhaft in `localStorage` gespeichert und beim nächsten Öffnen wiederhergestellt.
