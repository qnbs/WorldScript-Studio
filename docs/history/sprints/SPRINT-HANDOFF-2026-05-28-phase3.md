# Sprint Handoff — 2026-05-28 (Phase 3)

**Branch:** `main` | **Base version:** `v1.19.0` | **Session:** Phase 3 — v2.0 Foundation (C-1..C-5)

## What was completed

| Ticket | Description | Status |
|--------|-------------|--------|
| Vercel fix | `packages/collab-transport/src/crypto.js` missing from vendor fork — UNRESOLVED_IMPORT on Vercel build | ✅ Fixed |
| Docs audit | README, CHANGELOG, ROADMAP, TODO, SECURITY.md, CI.md, AGENTS.md, copilot-instructions.md — comprehensive v1.19.0 pass | ✅ Done |
| C-1 | `packages/collab-transport/src/crypto.js` security hardening: PBKDF2 100k→600k, extractable:true→false, `return promise.reject()` | ✅ Done |
| C-2 | Reference plugins: `services/plugins/wordCountOverlay.plugin.ts` + `sceneAppender.plugin.ts`; 8 unit tests | ✅ Done |
| C-3 | LoRA Ollama inference wiring: `LoraAdapter.ollamaModelTag`, `AIRequestOptions.loraModelPath`, `selectActiveLoraOllamaTag`, `streamProvider()` model-tag override | ✅ Done |
| C-4 | Cloud-Sync audit: `services/cloudSync/` confirmed complete (3 files, 39 tests, AES-256-GCM, `enableCloudSync`) | ✅ Verified |
| C-5 | GitHub Issue Templates (`bug_report.yml`, `feature_request.yml`, `translation_pr.yml`) + AGENTS.md v1.19.0 refs | ✅ Done |

## Key decisions / fixes

### Vercel UNRESOLVED_IMPORT
`y-webrtc.js` imports `./crypto.js` (relative). During B-3 vendor fork, only `crypto.d.ts` was copied, not `crypto.js`. Rolldown on Vercel resolved the ESM alias (`@domain/collab-transport`) to the index.ts, which imported `y-webrtc.js`, which then tried to resolve `./crypto.js` in the vendored src dir — not found. Fix: copy `crypto.js` alongside `y-webrtc.js`. Future rule: always grep for `from './` in the main JS source and verify all relative targets are present in the vendor package.

### C-1 crypto.js findings
Three bugs in upstream y-webrtc `crypto.js` (not our patch):
1. `iterations: 100000` → raised to `600000` (OWASP 2024 minimum for PBKDF2-HMAC-SHA-256)
2. `extractable: true` → `false` (SEC-RULE-5; prevented key export via exportKey())
3. `promise.reject(...)` without `return` in `decrypt()` → error swallowed, decrypt continued with garbage ciphertext

### C-3 LoRA wiring scope
LoRA adapter training remains a Python sidecar workflow (outside the browser). The C-3 wiring only covers the inference side: when `enableLoraAdapters` is on and an adapter has `ollamaModelTag` set, that tag is used as the Ollama model name in all AI calls. Users must run `ollama create <tag> -f Modelfile` to create the Ollama model that incorporates their adapter.

## Quality gate (at session end)

- lint ✅ — Biome 0 errors (1000 files)
- typecheck ✅ — tsc --noEmit 0 errors
- collab tests ✅ — 38/38
- plugin tests ✅ — 35/35 (registry) + 8/8 (reference plugins)
- cloud sync tests ✅ — 39/39

## What's next (C-6 / C-7 / PLANbib)

### C-6 — RTL full translation (ar/he)
- Stubs exist in `locales/ar/` and `locales/he/`; `enableRtlLayout` flag wired
- Requires native Arabic and Hebrew speakers for translation content
- RTL-specific Tailwind (`ps-*`/`pe-*`) and BiDi E2E tests deferred until content ready
- **Not a coding task** — needs community or translator involvement

### C-7 — Coverage 85% / Branches 75% / Functions 80%
- Current CI baseline (2026-05-26): 73%L / 65%F / 59%B
- Gap: ~12% lines, ~10% branches, ~15% functions
- Strategy: targeted tests for AI streaming paths (geminiService, openAIService), collaboration (encryptUpdate/decryptUpdate), voice (WasmSttEngine initialize/transcribe), and ProForge agent paths
- Stryker break: raise 75 → 80 after CI confirms mutation score ≥ 80

### PLANbib v1.7
- 9 phases: Objects → MindMap → Interviews → Timeline → Wizard → Analysis → ReadMode → Guide → Desktop
- Awaiting go-ahead from user — significant feature sprint, not started

### IDB at-rest encryption UX (C-SEC-5)
- `storageEncryptionService.ts` is ready (B-1)
- Passphrase unlock modal, forgot-passphrase export flow, key rotation UI — all Phase 3 follow-on
- Do NOT enable `enableIdbAtRestEncryption` in production until UX is complete
