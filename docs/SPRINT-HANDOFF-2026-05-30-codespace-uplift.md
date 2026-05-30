# Sprint Handoff — 2026-05-30 (Codespace Uplift + Vercel Fix)

**Branch:** `main` | **Base version:** `v1.19.0` | **Session:** Codespace Uplift + Vercel Blank Screen Fix + CI Verification

## What was completed

| Ticket | Description | Status |
|--------|-------------|--------|
| Codespace uplift | CLAUDE.md: environment-aware shell rules (parallel OK on 8-core Codespaces) | ✅ Done |
| Codespace uplift | `.devcontainer/devcontainer.json`: re-activated from `.disabled`; `hostRequirements: 8-core/16gb`; `postAttachCommand` + `openFiles` updated | ✅ Done |
| Codespace uplift | `.devcontainer/README.md`: "Optimal Modus Operandi" section — session checklist, daily workflow, quality gate, triage table, timeout prevention | ✅ Done |
| Devcontainer cleanup | Root `devcontainer.json` (empty schema redirect) deleted — `.devcontainer/` takes precedence | ✅ Done |
| Vercel blank screen | `index.html`: hardcoded `/StoryCraft-Studio/` paths → `%BASE_URL%` (manifest, favicon, apple-touch-icon, og:image, twitter:image) | ✅ Fixed |
| Vercel blank screen | `index.tsx`: `window.addEventListener('error')` safety net — static recovery UI if React never mounts | ✅ Done |
| CI verification | Full test suite: 382 files / 4567 tests — **0 failures** (tests were already green from prior session) | ✅ Verified |
| Lint | Biome lint 1013 files — **0 errors** | ✅ Green |
| Typecheck | `tsc --noEmit` — **0 errors** | ✅ Green |
| Docs | CHANGELOG `[Unreleased]` + AUDIT.md chain + TODO.md completed items + README test badge updated | ✅ Done |

## Key decisions / fixes

### CLAUDE.md: Environment-Aware Shell Rules

The "CRITICAL: Sequential Shell Execution (LOW-END HARDWARE)" block was written for a local machine with ~3.7 GB RAM. GitHub Codespaces with 8-core/16GB doesn't have this constraint. The block was replaced with an environment-aware section:
- **Codespaces** (`CODESPACES=true`): parallel Bash calls allowed, `run_in_background` allowed.
- **Low-end local**: sequential rules retained (same text, now explicitly scoped).

A new "Codespaces Modus Operandi" section was added with the session-start checklist, daily workflow, full quality gate command, and test failure triage patterns.

### Devcontainer Re-Activation

`ed30fe5` had disabled the devcontainer by renaming it to `.disabled`. This session reverses that. The `.devcontainer/devcontainer.json` specifies `hostRequirements: { cpus: 8, memory: "16gb", storage: "32gb" }` which signals Codespaces to provision the correct machine type. Without it, Codespaces picks the default (2-core/4GB), which causes OOM on the full test suite.

The root `devcontainer.json` was a schema-only stub with no real configuration. Since `.devcontainer/devcontainer.json` takes precedence in all tooling, the root file was confusing and has been deleted.

### Vercel Blank Screen — Root Cause and Fix

**Root cause:** `index.html` had hardcoded `/StoryCraft-Studio/` paths for `<link rel="manifest">`, `<link rel="icon">`, `<link rel="apple-touch-icon">`, `og:image`, and `twitter:image`. When Vercel builds with `build:edge` (setting `base: '/'`), Vite correctly rewrites JS bundle paths — but the HTML's existing absolute paths stay as-is, pointing to `/StoryCraft-Studio/manifest.json` → 404.

**Fix:** Replace with Vite's `%BASE_URL%` template:
- `build:edge` (Vercel/CF): `%BASE_URL%` → `/` → `/manifest.json` ✓
- `build` (GitHub Pages): `%BASE_URL%` → `/StoryCraft-Studio/` → `/StoryCraft-Studio/manifest.json` ✓

Verified: `pnpm run build:edge && grep manifest dist/index.html` → `/manifest.json`.

**Note:** `og:url` (Zeile 28) was intentionally NOT changed — it's the canonical public URL and must remain absolute.

### window.addEventListener('error') Safety Net

If the top-level JS bundle fails to evaluate (circular import, missing chunk, CSP violation), the async IIFE in `index.tsx` never runs and the page stays blank. The safety net fires synchronously from `window.onerror` and writes a static recovery UI if `#root` has no children at the time of the error.

## Quality gate

| Check | Result |
|-------|--------|
| lint (Biome) | ✅ 0 errors |
| typecheck (tsc --noEmit) | ✅ 0 errors |
| i18n:check | ✅ (not re-run this session — no key changes) |
| vitest run | ✅ 4567 tests / 382 files / 0 failures |
| build:edge (Vercel) | ✅ dist/index.html has `/manifest.json` |
| build (GitHub Pages) | ✅ dist/index.html has `/StoryCraft-Studio/manifest.json` |

## What's next

| Ticket | Description | Priority |
|--------|-------------|----------|
| C-7 remainder | Coverage → L85%/B75%/F80%; Stryker break 75→80 | Medium |
| C-6 | Full ar/he translation content (requires native translators) | Low |
| B-2 continuation | Whisper WASM STT model download UI → `WasmSttEngine.initialize()` | Medium |
| PLANbib v1.7 | 9 feature phases (Objects→MindMap→Interviews→…); **user go-ahead required** | Pending |
| IDB encryption Phase 4 | Integrate `storageEncryptionService` read/write path into `idbProjectStore` etc. | Low |

## Quick start

```bash
# Quality gate
pnpm run lint && pnpm run i18n:check && pnpm run typecheck && pnpm exec vitest run

# Run dev server
pnpm run dev

# Edge build (Vercel)
pnpm run build:edge

# Coverage run
pnpm exec vitest run --coverage
```
