# Sprint Handoff — 2026-05-30: IDB Encryption Fix + A11y Sweep + CI Correction Loop

## Status

**Branch:** `main` · HEAD: `540ce0b`  
**CI:** Quality Gate — still failing (ongoing correction loop, new push needed in Codespaces)  
**Security Audit:** ✅ GREEN on all commits  
**Deployment:** Vercel auto-deploys on every push; current deploy is `540ce0b`.

---

## What Was Done This Session

### Bug Fix: IDB At-Rest Encryption (4 root causes)

**Commit:** `e74ff69 fix(b1): IDB encryption — sentinel verification, opt-in gate, escape hatch`

| Root cause | Fix |
|---|---|
| Modal blocked all users with no passphrase set | `App.tsx` startup effect now checks IDB sentinel; if flag on but no sentinel → auto-disables flag silently |
| Any arbitrary passphrase "worked" as unlock | `IdbUnlockModal` uses `verifyAndInitIdbEncryption()` which decrypts sentinel with derived key; AES-GCM auth-tag throws on wrong passphrase |
| Raw toggle in Experimental Flags bypassed proper setup | Removed `enableIdbAtRestEncryption` from `FeatureFlagsSection.tsx` |
| `change`/`disable` flows never verified current passphrase | `useSettingsView` now uses `rotateIdbPassphrase`/`verifyAndInitIdbEncryption` |

**New file:** `services/storage/idbPassphraseSentinel.ts` — stores AES-GCM encrypted sentinel in IDB via `PassphraseSentinelStore extends IdbConnectionManager`. Methods live inside class so protected `getObjectStore` is called via `this`.

**New functions in `storageEncryptionService.ts`:**
- `setupIdbEncryption(passphrase)` — derives key, writes sentinel, sets `_activeKey`
- `verifyAndInitIdbEncryption(passphrase)` — decrypts sentinel to verify, sets `_activeKey`
- `hasPassphraseSentinel()` — IDB read to check if passphrase was ever set up
- `clearIdbPassphrase()` — deletes sentinel + clears key (disable flow)
- `rotateIdbPassphrase(old, new)` — verify old + re-encrypt sentinel with new key

**IdbUnlockModal a11y improvements:**
- WCAG 2.4.3 focus management (`cancelBtnRef` + `useEffect` on `showForgotConfirm`)
- `role="alert"` pre-rendered with `minHeight` (NVDA/JAWS live-region fix)
- `aria-invalid` + `aria-describedby` on password input
- `aria-busy` on unlock button
- `onForgotPassphrase` escape hatch (two-step confirm, clears sentinel + disables flag)
- `isDismissible={false}` passed to Modal

**PassphraseModal hardening:**
- `variant="alertdialog"` for disable mode (WCAG destructive confirmations)
- Pre-rendered `role="alert"` error container
- `aria-invalid`/`aria-describedby` on all 3 password inputs
- `aria-busy` on submit button
- `focus-visible:ring-[var(--sc-border-focus)]` token fix

**i18n:** 3 new keys added to all 5 locales (de/en/es/fr/it):
- `settings.privacy.encryptionForgotPassphrase`
- `settings.privacy.encryptionForgotPassphraseWarning`
- `settings.privacy.encryptionDisableConfirm`

---

### A11y Sweep — `focus:ring` → `focus-visible:ring` (WCAG 2.4.7)

**Commit:** `94d29b9 fix(a11y): focus-visible sweep + pre-rendered alerts + modal hardening`

**Zero remaining `focus:ring-2` violations** in `components/`. Files fixed:
`Input.tsx`, `Textarea.tsx`, `Select.tsx`, `Checkbox.tsx`, `Toast.tsx`, `BottomSheet.tsx`, `SettingsShared.tsx` (ToggleSwitch), `CommandPalette.tsx`, `CharacterInterviewsView.tsx`, `ToolsPanel.tsx`, `ProjectAiPresetSection.tsx`, `ProForgeDashboard.tsx`

**Modal.tsx hardening:**
- `useId()` for unique `aria-labelledby` per instance (eliminates duplicate-ID when 2 modals are mounted)
- New props: `isDismissible?: boolean` (hides backdrop + close X, keyboard-safe), `variant?: 'dialog' | 'alertdialog'`
- Non-dismissible modals: backdrop `tabIndex={-1}` + `aria-hidden`, close button hidden

**Other a11y fixes:**
- `CollaborationPanel.tsx` — `connectionError` pre-rendered `role="alert"` wrapper
- `TauriUpdaterBanner.tsx` — error pre-rendered `role="alert"`, `text-red-500` → `--sc-danger-fg`
- `DataSection.tsx` — `aria-busy` on export button
- `SettingsShared.tsx` — ToggleSwitch thumb `bg-white` → `bg-[var(--sc-surface-base)]`

**Status announcements (WCAG 4.1.3):**
- `App.tsx handleForgotPassphrase` — `announce(t('...encryptionDisabledStatus'), 'assertive')` after disabling
- `useSettingsView handlePassphraseConfirm` — `toast.success/info` after set/change/disable

---

### Security + CI Pipeline Fixes

**Commit:** `e46e745 fix(security+ci): tar 0.4.46, SHA-pin workflows, fix matrix condition`

- `tar` Rust crate: 0.4.45 → 0.4.46 (GHSA-3pv8-6f4r-ffg2 / Dependabot #15 — PAX header desync)
- `deploy-cloudflare-pages.yml` — SHA-pin all 3 actions (checkout v6, pnpm-action-setup v5, setup-node v5)
- `docker.yml` — SHA-pin all 5 docker actions
- `ci.yml` — SHA-pin `actions/download-artifact` in vrt job; fix matrix condition `'lts/*'` → `'22'` (coverage upload was always skipped)

---

### Parity Check Fix + Dead Code

**Commit:** `c37831d fix(ci+parity): add tsx devDep, remove dead switch cases`

- Added `tsx` to devDependencies (was missing; `pnpm run parity:check` → `tsx: not found`)
- Removed dead `enablePlotBoardV2` switch case from `useSettingsView.ts` (flag removed from UI in v1.6)
- Removed dead `enableIdbAtRestEncryption` switch case (now managed via Privacy settings only)

---

### TypeScript Error Fixes (surfaced by stricter CI)

**Commits:** `c91456f`, `2f6bf56`, `94fddea`

- `idbPassphraseSentinel.ts` TS2445 — protected `getObjectStore` was called from outside class (fixed by moving functions into class methods)
- `featureFlagsSlice.test.ts` TS2322 — `it.each` array typed as specific action creator → widened to `{ payload: boolean; type: string }`
- `cloudSyncBackend.test.ts` TS2353 — test used `accountId/bucketName/apiToken` but interface has `endpoint/token`
- `PassphraseModal.test.tsx` TS2339 — `vi.fn<T>()` typed mocks; `let onConfirm: Mock<OnConfirm>` instead of raw `OnConfirm`
- `PrivacySection.test.tsx` TS2352 — partial stub cast via `as unknown as ReturnType<...>` (double-cast pattern)

---

### Pre-existing Test Failures Fixed

**Commits:** `eac9ad6`, `540ce0b`

| Test file | Root cause | Fix |
|---|---|---|
| `useVoice.test.ts` | Missing `featureFlags` in `useAppSelector` mock state → `undefined.enableVoiceWasm` | Added all 20 flags to mock state |
| `useStoryCraftAI.test.ts` | Missing `featureFlags` + `lora` in mock state → `undefined.enableLoraAdapters`, `undefined.adapters` | Added featureFlags + `lora: { adapters: [], activeAdapterId: null }` |
| `collaborationService.test.ts` | Test expected `iterations: 310_000` but service uses `600_000` (OWASP 2024) | Updated assertion to `600_000` |
| `yWebrtcPatch.test.ts` | Test read `node_modules/y-webrtc/src/y-webrtc.js` (unpatched); encryption is in `packages/collab-transport/src/y-webrtc.js` | Updated path to vendor fork |
| `referencePlugins.test.ts` | `PluginRegistry` defaults to disabled; test never called `setEnabled(true)` | Added `registry.setEnabled(true)` before execute |

---

## Open: Blank Screen on Live Demo

**Status:** Unresolved. Vercel builds succeed (`state: success`) but user reports blank screen.

**Investigation so far:**
- Not from TypeScript errors (Vite strips types, doesn't check)
- Not from build failure (deployment shows "completed")
- `useId()` in React 19 is valid
- `idbPassphraseSentinel.ts` module-level `new PassphraseSentinelStore()` — constructor only sets `null` fields, no browser API calls
- `App.tsx` async encryption effect — valid `void (async () => { ... })()` pattern
- `ErrorBoundary` wraps views, so component errors would show retry UI, not blank screen

**Likely candidates to investigate in Codespaces:**
1. Browser DevTools console errors on `https://worldscript-studio.vercel.app/`
2. Check if circular import caused by `storageEncryptionService → idbPassphraseSentinel → idbCore` creates a Vite bundle issue
3. Check if the Vercel build uses edge/SSR config that fails at runtime with IDB access

---

## Remaining Work for Codespaces

### CI Correction Loop (PRIORITY)

The quality gate is still failing. Run in Codespaces (full hardware):

```bash
pnpm exec vitest run 2>&1 | grep "^FAIL " | sort -u
```

Fix any remaining pre-existing failures. Pattern to check each failure:
- `featureFlags` missing in mock → add all 20 flags
- Wrong iteration count → check service source
- Wrong file path → check where the actual file is
- `PluginRegistry` not enabled → call `setEnabled(true)`
- Mock type mismatches → use `vi.fn<T>()` pattern

### Blank Screen Debug

```bash
# Open DevTools on the live URL and check Console for errors
# Also check Network tab for failed JS chunks
```

### Cloudflare Pages Deploy (pre-existing failure)

The `deploy-cloudflare-pages.yml` fails on every push because the workflow file is invalid. The `if: ${{ secrets.X != '' }}` at job level might not be supported, OR the workflow only runs on `v*` tags but GitHub validates it on every push and shows it as failed.

**Investigation:**
```bash
# Check if this was already failing before today
gh api repos/qnbs/WorldScript-Studio/deployments --jq '.[0:10] | .[].sha'
```

### After CI is Green

1. Run `pnpm run test:coverage` and update README badges
2. Update `AUDIT.md` quality-gate line with new numbers
3. Run `pnpm run build` to verify production bundle is clean
4. Investigate blank screen with fresh browser session

---

## Key Files Changed This Session

```
services/storage/idbPassphraseSentinel.ts          (NEW)
services/storage/storageEncryptionService.ts        (MODIFIED — 5 new exports)
services/storage/index.ts                           (MODIFIED — new barrel export)
App.tsx                                             (MODIFIED — encryption effect, escape hatch)
components/settings/IdbUnlockModal.tsx              (MODIFIED — verifyAndInit, escape hatch)
components/settings/PassphraseModal.tsx             (MODIFIED — alertdialog, aria)
components/settings/FeatureFlagsSection.tsx         (MODIFIED — removed encryption toggle)
components/settings/SettingsShared.tsx              (MODIFIED — focus-visible, bg token)
components/settings/TauriUpdaterBanner.tsx          (MODIFIED — pre-rendered alert)
components/settings/DataSection.tsx                 (MODIFIED — aria-busy)
components/ui/Modal.tsx                             (MODIFIED — useId, isDismissible, variant)
components/ui/Input.tsx                             (MODIFIED — focus-visible)
components/ui/Textarea.tsx                          (MODIFIED — focus-visible)
components/ui/Select.tsx                            (MODIFIED — focus-visible)
components/ui/Checkbox.tsx                          (MODIFIED — focus-visible)
components/ui/Toast.tsx                             (MODIFIED — focus-visible)
components/ui/BottomSheet.tsx                       (MODIFIED — focus-visible)
components/CommandPalette.tsx                       (MODIFIED — focus-visible)
components/CharacterInterviewsView.tsx              (MODIFIED — focus-visible)
components/writing/ToolsPanel.tsx                   (MODIFIED — focus-visible)
components/CollaborationPanel.tsx                   (MODIFIED — pre-rendered alert)
components/proForge/ProForgeDashboard.tsx           (MODIFIED — focus-visible)
components/settings/ProjectAiPresetSection.tsx      (MODIFIED — focus-visible)
hooks/useSettingsView.ts                            (MODIFIED — new passphrase handlers)
locales/{de,en,es,fr,it}/settings.json             (MODIFIED — 3 new keys each)
public/locales/*/bundle.json                        (REBUILT)
.github/workflows/ci.yml                           (MODIFIED — SHA pin, matrix fix)
.github/workflows/deploy-cloudflare-pages.yml      (MODIFIED — SHA pins)
.github/workflows/docker.yml                       (MODIFIED — SHA pins)
src-tauri/Cargo.lock                               (MODIFIED — tar 0.4.46)
package.json + pnpm-lock.yaml                      (MODIFIED — tsx devDep)
tests/unit/storageEncryptionService.test.ts        (MODIFIED — 12 new sentinel tests)
tests/unit/settings/IdbUnlockModal.test.tsx        (MODIFIED — verifyAndInit + escape hatch)
tests/unit/settings/FeatureFlagsSection.test.tsx   (MODIFIED — 18 flags not 19)
tests/unit/settings/PassphraseModal.test.tsx       (MODIFIED — Mock<T> types)
tests/unit/settings/PrivacySection.test.tsx        (MODIFIED — as unknown as cast)
tests/unit/hooks/useVoice.test.ts                  (MODIFIED — featureFlags mock)
tests/unit/hooks/useStoryCraftAI.test.ts           (MODIFIED — featureFlags + lora mock)
tests/unit/collaborationService.test.ts            (MODIFIED — 600k iterations)
tests/unit/yWebrtcPatch.test.ts                    (MODIFIED — correct path)
tests/unit/plugins/referencePlugins.test.ts        (MODIFIED — setEnabled(true))
tests/unit/featureFlagsSlice.test.ts               (MODIFIED — widened action type)
tests/unit/cloudSyncBackend.test.ts                (MODIFIED — correct field names)
```

---

## Quick Start in Codespaces

```bash
# 1. Pull latest
git pull origin main

# 2. Install deps (tsx is now in devDeps)
pnpm install

# 3. Verify local quality gate
pnpm run lint && pnpm run i18n:check && pnpm run typecheck

# 4. Run full test suite to find remaining failures
pnpm exec vitest run 2>&1 | grep "^FAIL " | sort -u

# 5. Fix each failure (see patterns above), then:
pnpm exec vitest run tests/unit/THE_FAILING_FILE.test.ts

# 6. Push and monitor CI
git push origin main
gh run watch  # or gh api repos/qnbs/WorldScript-Studio/actions/runs

# 7. Once CI green — run coverage + update badges
pnpm run test:coverage
```
