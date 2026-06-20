# Tauri Native Desktop — Remaining Work Runbook (T3–T7 + Recent Projects)

> Deferred work from the **Tauri v2 Native Desktop Perfection** plan. T0–T2 shipped as PRs
> (#188 foundations, #189 JS menu, #190 system tray). The CodeAnt correction loop over **all** open
> PRs runs first; the phases below are executed **later**, the same way — each a PR (≤100 files,
> lockstep tests + i18n + docs), CodeAnt deferred until a combined pass.
>
> Execute in order T3 → T7 (each stacked on the previous, or rebased on `main` after the desktop
> PRs merge). Locked decisions still apply: **keep native chrome**, **menus in JS**
> (`@tauri-apps/api/menu`), **Core+power scope**, **signing out of scope**.

## Conventions established in T0–T2 (reuse these)

- **Detection:** always `isTauriRuntime()` (T0 hardened it to accept `__TAURI_INTERNALS__` — Tauri v2
  doesn't set `__TAURI__` without `withGlobalTauri`). Never raw `window.__TAURI__`.
- **Native surfaces in JS from a React hook/effect** (no `t()` outside React, ADR-D1). Build logic in
  `services/desktop/*.ts`, gated by `isTauriRuntime()` (no-op on web → zero PWA regression).
- **Command sink:** route every native action through `executeCommand(commandId)` (App.tsx,
  `runCommandById`); ids centralized in `services/desktop/desktopEvents.ts` (`DESKTOP_COMMANDS`).
- **i18n:** new keys in `locales/<17>/desktop.json` (5 core translated, copy `en`→12 Beta/RTL);
  module already registered in `scripts/check-i18n-keys.mjs` + `scripts/build-i18n.mjs`; run
  `pnpm run i18n:check`. Namespaces: `desktop.menu/tray/settings/...` — add `desktop.notify/updater/pandoc/shortcuts`.
- **Settings:** extend the `desktop` group (`types.ts DesktopSettings`, `settingsSlice` default +
  `setDesktopSettings`, `idbProjectStore normalizePersistedSettings` backfill, a `*Section.tsx`
  toggle). Pattern: `components/settings/DesktopSection.tsx`.
- **Tests:** mock `@tauri-apps/*` dynamic imports with `vi.hoisted` shared spies (see
  `tests/unit/desktopMenu.test.ts`, `desktopTray.test.ts`). Never add a `biome-ignore` (suppression
  ratchet) — use typed `unknown`, not `any`.
- **Rust:** no PR-CI gate → after any `src-tauri` change run `gh workflow run tauri-build.yml --ref <branch>`.
  Runtime/capability behavior is verified on a real desktop (no Tauri shell on the dev host).

---

## T3 — Native notifications (PR)

**Goal:** OS notifications for background-task completion, permission-gated + user-toggle.

- Add `tauri-plugin-notification` (Cargo + register in `src-tauri/src/lib.rs` + `notification:default`
  capability + JS dep `@tauri-apps/plugin-notification`).
- `services/desktop/desktopNotifications.ts` + `hooks/useNativeNotifications.ts`: permission flow
  (`isPermissionGranted`/`requestPermission`), `notify(title, body)` gated by `isTauriRuntime()` +
  setting + granted permission.
- Fire on: AI generation done, export finished, encrypted-backup complete, update-ready. Hook into
  the thunks / `app/listenerMiddleware.ts` where those already dispatch in-app `statusActions.addNotification`.
- Setting: `desktop.desktopNotifications` boolean (extend `DesktopSettings`) + toggle in `DesktopSection`.
- i18n: `desktop.notify.*`. Tests: notification service (mock plugin) + permission flow + setting.

## T4 — First-class updater modal (PR)

**Goal:** replace the Settings-only banner with a real updater UX.

- Extend `hooks/useTauriUpdater.ts`: **reuse the `Update` handle** (kill the double `check()` in
  `installUpdate`); wire `downloadAndInstall((event) => …)` **progress**; read **`Update.body`**
  changelog (extend `types/tauri-plugins.d.ts` to include `body`/`date`); add **cancel** + a
  **restart confirmation** (drop the unconditional `relaunch()`).
- `components/desktop/UpdaterModal.tsx` (focus-trap + live region) + a top-level **update-available
  prompt** (toast/badge) so updates are discoverable outside Settings. Keep `TauriUpdaterBanner` as a
  secondary entry that opens the modal.
- i18n: `desktop.updater.*`. Tests: hook (mock plugin progress events) + modal render/interaction + a11y.
- No Rust change.

## T5 — Pandoc UX + LoRA run-scoped abort (PR)

**Goal:** stop swallowing Pandoc errors; make LoRA abort run-scoped.

- **Pandoc:** add Rust `pandoc_available()` (cheap `which`/`--version`); `services/pandocTauri.ts`
  returns a **structured result** (available / missing / failed), not bare `null`. Export view
  pre-check + an "Install Pandoc" guidance modal (localized, platform links) + progress/phase feedback.
- **LoRA:** make `abort_lora_training` **run-scoped** — hold the child in
  `tauri::State<Mutex<Option<Child>>>` (or `runId→Child` map), abort that child; **fix the Windows
  "kills all python3.exe" bug** (`src-tauri/src/lora.rs`). Tag `lora-progress` with `runId`;
  `services/lora/loraTrainingService.ts` returns a handle whose `abort` targets that run.
- i18n: `desktop.pandoc.*`. Tests: pandoc service (mock invoke: available/missing/failed) + lora abort.
- Rust change → `tauri-build.yml` dispatch.

## T6 — Global shortcuts + Rust-compute expansion (PR)

**Goal:** opt-in system-wide hotkeys + real progress/cancel for Rust tasks.

- **Global shortcuts:** add `tauri-plugin-global-shortcut` (Cargo + register + capability + JS).
  `services/desktop/globalShortcuts.ts` + `hooks/useGlobalShortcuts.ts`; register configurable
  hotkeys (**default off / opt-in**) → `executeCommand` (open palette, new project, show/focus).
  Conflict-safe unregister on teardown. Settings to enable/configure.
- **Rust-compute expansion** (`src-tauri/src/commands/task_supervisor.rs`): honor `timeout_ms`,
  add run-scoped **progress events** + **cancellation** (Tokio channel → Tauri event, ADR-D4), and
  2–3 high-value tasks (e.g. whole-manuscript batch `text.analyze`, a heavier metric/diff). Update
  `services/hybridRouter.ts` to stream real progress + support `cancel()` by `runId` (replace the
  empty generator / no-op). Typed wrappers à la `services/rustTaskSupervisor.ts`.
- i18n: `desktop.shortcuts.*`. Tests: shortcut service + hybridRouter progress/cancel + Rust
  `#[cfg(test)]`. Rust change → `tauri-build.yml` dispatch.

## T7 — Native theme sync + Flow-Mode fullscreen + docs (PR)

**Goal:** OS-native theme follow + immersive Flow Mode + docs.

- **Theme sync:** subscribe to the Tauri window theme-changed event; feed it into `applyTheme`
  (App.tsx) so `settings.theme === 'auto'` follows the OS natively (not only WebView `matchMedia`).
  New `services/desktop/desktopWindow.ts` helper.
- **Flow-Mode fullscreen:** on `flowMode` enter (Zustand `app/transientUiStore.ts`) call
  `getCurrentWindow().setFullscreen(true)` (restore on exit) — immersive distraction-free without a
  custom titlebar. Needs `core:window:allow-set-fullscreen` capability.
- **Docs:** new `docs/TAURI-DESKTOP.md` (the `services/desktop/` layer, event/command contract,
  Mermaid Rust↔TS flow diagrams) + refresh `docs/TAURI-CI.md` / `docs/TAURI-UPDATER.md`.
- Tests: theme-sync + flow-mode hooks. Rust capability change → `tauri-build.yml` dispatch.

---

## Deferred: dynamic Recent Projects (own PR, prerequisite for menu/tray Recent submenu)

T1 deferred this because the app is **single-active-project** — switched only by **importing a file**
(`importProjectThunk`). There is no runtime "open stored project by id → make active" path
(`storageService.loadProject(id)` exists but only feeds backup/dataset extraction; the active state is
a single global `dbService.loadState()` blob).

**To enable it, build a project-switch capability first:**
1. `openStoredProjectThunk(projectId)`: save the current project, `storageService.loadProject(id)`,
   then hydrate the `project` slice the same way `importProjectThunk.fulfilled` does (entity-adapter
   rehydration for characters/worlds + image handling), guarding unsaved changes.
2. Track recents (id + title + lastOpened) — `crossProjectIndexService.listIndexedProjects()` gives
   `{projectId, title, lastIndexed}`; or add a dedicated recents list in the `desktop` settings group.
3. Then add a **Recent Projects** submenu to the JS menu (T1 `desktopMenu.ts`) and the tray (T2
   `desktopTray.ts`), each item → `openStoredProjectThunk(id)`. Cap ~10, `log()` truncation.

This is a real feature with state-handoff/data-integrity risk — give it its own PR + tests, not a
menu sub-task.

---

## Definition of done (whole initiative)

Tray ✅(T2) · localized menu ✅(T1) · notifications (T3) · updater modal (T4) · Pandoc UX + LoRA
run-scoped abort (T5) · global shortcuts + Rust compute progress/cancel (T6) · theme sync + Flow-Mode
fullscreen + docs (T7) · Recent Projects (after the project-switch thunk). All as open PRs with
CodeAnt deferred to the combined loop. Zero PWA regression throughout (every surface
`isTauriRuntime()`-gated).
