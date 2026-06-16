# StoryCraft Studio — Checkpoint
**Date:** 2026-05-31 (updated)  
**Last commits (2026-05-31):** `2cb3b55` → `394af8c` → `5966fa2` → `4e69c0d` → `4bfc253` → `0c18198`  
**Active branch:** main  

## ✅ 2026-05-31 Session — i18n Audit + Settings + CI Fixes

### DE→EN Developer Comment Translation
- All German inline comments, JSDoc, and developer-facing docs translated to English (`0c18198`)
- README.md: removed duplicate German section (–181 lines)
- 49 files changed

### i18n — Community Templates Localized
- `public/community-templates/index.de.json` + `index.fr.json` + `index.es.json` + `index.it.json`
- All 14 community templates translated (names, descriptions, section titles, AI-prompt descriptions)
- `communityTemplateService.ts`: locale-aware loading (tries `index.<lang>.json`, falls back to EN)
- `TemplateView.tsx`: passes `language` from I18n context, re-fetches on language change
- 12 new tests for locale loading, fallback, per-locale cache isolation (`4e69c0d`)

### DE i18n Quality Fixes
- 27 Voice settings keys translated to German (activationMode, TTSMuted, cloudFallback, privacy consent, etc.)
- `proforge.pipeline.title`, `sceneboard.canvas.modeLabel`, `vc.newBranch`, `sidebar.mindmap`, PWA install help translated
- All 5 locales: 2117 → 2129 keys (12 new keys for factory reset + onboarding features)

### Settings — New Features
- **Factory Reset**: Danger Zone section in DataSection; wipes all IDB databases, localStorage, SW caches, reloads
- **Repeat Onboarding**: button dispatches `storycraft:openPortal` event; `useApp.ts` listener re-opens WelcomePortal
- `services/factoryResetService.ts`: `wipeAllAppData()` with `indexedDB.databases()` API + known-list fallback
- Confirmation modal with irreversibility warning in `SettingsModals.tsx` (`5966fa2`)

### Mobile Command Palette — Focus Trap Fix
- `useFocusTrap.ts`: changed selector to `input:not([tabindex="-1"])` — was including tabIndex=-1 inputs
- This was root cause of virtual keyboard appearing on mobile when palette opened
- CommandPalette already had `tabIndex={isTouchDevice ? -1 : 0}` but focusTrap overrode it

### CI Fixes
- `deploy-cloudflare-pages.yml`: paused automatic push triggers (manual-only now); gate job added
- Cloudflare phantom 0-job failure eliminated from push-triggered CI runs
- Fixed 3 TypeScript errors: `size="md"` invalid Modal prop + `mock.calls[0]` null-check (`2cb3b55`)
- E2E/Build/Storybook no longer cascade-skipped once Quality Gate passes

---

## Previous checkpoint (2026-05-24)  
**Last commit:** `33cb544`  
**Git tag:** `v1.17.0` (pushed)  

---

## ✅ Completed P0 items in this session

### P0 #5 — Versioning & release consolidation (COMPLETE)
- `package.json` → `1.17.0`
- `src-tauri/Cargo.toml` → `1.17.0`
- `src-tauri/tauri.conf.json` → `1.17.0` (had been stuck at 1.7.0 for 10 releases)
- `CHANGELOG.md`: `[Unreleased]` → `## [1.17.0] — 2026-05-24` with all sprint highlights
- Comparison links in CHANGELOG updated (`[1.17.0]`, `[1.11.0]`, … `[1.0.0]`)
- Git tag `v1.17.0` created and pushed
- GitHub Release could not be created via API (authentication was missing at session start, fixed later — release must be created manually or via `gh release create v1.17.0`)

**Commits:**
- `da61b5a` — chore(release): consolidate versioning to v1.17.0 + y-webrtc patch
- `12fda28` — fix(vercel): update pnpm-lock.yaml for y-webrtc patchedDependencies

### P0 #1 — Full RTCDataChannel in-flight E2E encryption (COMPLETE)
- `pnpm patch y-webrtc@10.3.0` created and committed (`patches/y-webrtc@10.3.0.patch`)
- Patch encrypts all three critical sites in `y-webrtc.js`:
  1. `sendWebrtcConn()` — encrypts before `peer.send()`
  2. `broadcastWebrtcConn()` — encrypts before broadcasting
  3. `peer.on('data')` — decrypts before `readPeerMessage()`
- Uses existing `room.key` (AES-256-GCM, PBKDF2 100k iterations)
- Async encrypt/decrypt with `cryptoutils.encrypt/decrypt`
- Plaintext fallback when no password is set (`room.key` absent)
- **Smoke tests:** `tests/unit/yWebrtcPatch.test.ts` (5 tests) verifies patch application
- **i18n:** All 5 locales updated — badge now shows "E2E Encrypted (AES-256-GCM) — signaling + data channel"
- **CHANGELOG:** Entry for RTCDataChannel encryption added

**Commits:**
- `e4fdac7` — feat(collab): full RTCDataChannel E2E encryption via y-webrtc patch + smoke tests + i18n

### P0 #4 — DS-5: Remove legacy CSS bridge block (MARKED AS DONE)
- After analysis of sprint docs (`SPRINT-HANDOFF-2026-05-22.md`, `SPRINT-V1.16.md`):
  - Bridge block was already removed in previous sprints
  - Remaining aliases (`--nav-*`, `--glass-*`, `--border-interactive`, `--ring-focus`) are **intentional semantic tokens**, not legacy bridges
- `TODO.md` updated: DS-5 marked ✅ done

**No separate commit needed** (change in `TODO.md` was included in the `e4fdac7` commit)

### P0 #2 — Storage resilience & recovery (SUBSTANTIALLY COMPLETE)
- **retryDb improved:**
  - Exponential backoff: 500ms → 1000ms → 2000ms
  - Jitter: up to 200ms random delay (prevents thundering herd)
- **retryDb applied to additional methods:**
  - `loadState()` (critical app startup path!)
  - `createSnapshot()`, `listSnapshots()`, `getSnapshotData()`, `deleteSnapshot()`
  - `deleteProject()`
- **Proactive low-storage warning:**
  - `checkStorageHealth()` in `services/dbInitialization.ts`
  - Uses `navigator.storage.estimate()`
  - Warns at ≥85% quota usage
  - Integrated into `listenerMiddleware.ts` auto-save path
  - Dispatches `statusActions.addNotification()` with error toast
- **Tests:**
  - `dbServiceRetry.test.ts`: +1 test for exponential backoff timing (8 tests total)
  - `dbInitialization.test.ts`: +4 tests for `checkStorageHealth` (12 tests total)

**Commits:**
- `99d1ebb` — feat(storage): harden retryDb with exponential backoff + jitter; protect loadState & snapshots
- `33cb544` — feat(storage): proactive low-storage warning via checkStorageHealth

### Vercel deployment fix (RESOLVED)
- Problem: `pnpm-lock.yaml` did not contain a `patchedDependencies` section for `y-webrtc@10.3.0`
- Vercel aborted with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`
- Fix: ran `pnpm install --no-frozen-lockfile` locally, updated lockfile, pushed

**Commit:** `12fda28`

---

## ⏳ Open P0 items (for next session)

### P0 #3 — Add voice E2E tests (STILL OPEN)
**Status:** Analysis started, no implementation begun  
**What is missing:**
- Create Playwright spec for voice flows (`tests/e2e/voice.spec.ts`)
- Enable feature flag `enableVoiceSupport` in E2E
- Mock Web Speech API (SpeechRecognition / SpeechSynthesis)
- Simulate microphone permission
- Tests for:
  - VoiceSettingsSection rendering in Settings
  - VoiceControlPanel interactions
  - Push-to-talk (Ctrl+Shift+V)
  - Dictation in ManuscriptEditor
  - VoiceIndicator status overlay
- **Context:** Voice foundation was implemented in v1.17 (83 unit tests), but no E2E coverage yet

### P0 #1 follow-up — RTCDataChannel test integration (OPTIONAL)
- Currently only smoke tests (checking that the patch was applied)
- Real integration tests (syncing two Yjs documents) would be desirable but costly
- WebRTC not natively available in jsdom/Playwright → requires a mock provider or real browser test

---

## 🔧 Technical context for resumption

### y-webrtc patch
- Patch file: `patches/y-webrtc@10.3.0.patch`
- Registered in `package.json` under `pnpm.patchedDependencies`
- When upgrading y-webrtc the patch must be recreated (`pnpm patch y-webrtc@<new>`)
- Original source: `node_modules/y-webrtc/src/y-webrtc.js` (patched automatically by pnpm)

### retryDb improvements
- Location: `services/dbService.ts` line ~73
- Signature: `retryDb<T>(fn: () => Promise<T>, retries = 2, baseDelayMs = 500)`
- Formula: `delay = baseDelayMs * 2^attempt + jitter(0-200ms)`
- Protected methods: `saveProject`, `saveSettings`, `saveApiKey`, `getApiKey`, `clearApiKey`, `saveGeminiApiKey`, `getGeminiApiKey`, `clearGeminiApiKey`, `saveBinderAsset`, `getBinderAsset`, `deleteBinderAsset`, `listBinderAssetIds`, `loadState`, `createSnapshot`, `listSnapshots`, `getSnapshotData`, `deleteSnapshot`, `deleteProject`

### Storage health check
- Location: `services/dbInitialization.ts`
- Threshold: 85% quota usage
- Integration: `app/listenerMiddleware.ts` (auto-save listener, before the actual save)
- Fallback: if `navigator.storage.estimate()` is unavailable or fails → silently ok

### Git status
- Branch: `main`
- All changes pushed to `origin/main`
- Tag `v1.17.0` pushed
- No uncommitted changes in working tree

---

## 🚀 Next recommended steps (prioritized)

1. **P0 #3 Voice E2E tests** — Most critical, as the last open P0 item
   - Create `tests/e2e/voice.spec.ts`
   - Mock Web Speech API in Playwright
   - Test voice settings, ControlPanel, Indicator

2. **Create GitHub Release v1.17.0 manually** (if not followed up via `gh` CLI)
   - `gh release create v1.17.0 --title "v1.17.0 — Voice Full Support Foundation" --notes-file <changelog-excerpt>`

3. **Verify Vercel deployment**
   - Push to `main` should trigger automatically
   - Check whether build after `12fda28` completes successfully

4. **Further storage hardening (optional)**
   - Extend retryDb to `saveStoryCodex`, `saveRagVectors`, `saveImage`
   - Automatic data compression/archiving at >90% quota

5. **Address P1 items from audit**
   - Finalize RTL support
   - Mobile/PWA polish
   - Tauri auto-update + code signing

---

## 📊 Session statistics
- **Commits:** 5 (da61b5a, 12fda28, e4fdac7, 99d1ebb, 33cb544)
- **Files changed:** ~20 (incl. tests, i18n, patches, manifests)
- **New tests:** 10 (5 yWebrtcPatch + 1 dbServiceRetry + 4 checkStorageHealth)
- **P0 items completed:** 4 of 5
- **Remaining P0 items:** 1 (voice E2E tests)

---

## ⚠️ Known technical limitations

- **Plan-mode bug:** During the session a recurring conflict occurred between the `system-reminder` ("Plan mode still active") and actual behavior (`ExitPlanMode` threw "Not in plan mode"). Worked around by implementing directly after user confirmation.
- **GitHub API:** No authentication at session start → Release API failed. `gh auth login` was run later.
- **pnpm patch-commit:** First attempt with 60s timeout failed (peer-dependency issue). Resolved via manual `diff` + lockfile update.
- **Vercel:** `pnpm install --frozen-lockfile` aborted due to missing `patchedDependencies` in the lockfile. Fixed via `pnpm install --no-frozen-lockfile` + commit.
