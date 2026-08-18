# Tauri Coupling Inventory

**Companion to:** [`ROADMAP-CEF-DESKTOP-MIGRATION.md`](ROADMAP-CEF-DESKTOP-MIGRATION.md) §36 (capability parity) · [`tauri-coupling-inventory.json`](tauri-coupling-inventory.json) (machine-readable) · [ADR-0019](../adr/0019-cef-desktop-runtime-strategy.md)
**Verified:** 2026-08-18, against `main` (v1.27.1), via `rg` — not estimated or carried over from an earlier, less precise pass.
**Purpose (roadmap §90 step 4/5, Appendix G PR 2):** establish exactly how large and how centralized today's Tauri coupling is, before Wave 1 begins building the `DesktopPlatform` abstraction that will eventually replace it.

## Methodology

```bash
# Real @tauri-apps/* imports (static or dynamic)
rg -l "from ['\"]@tauri-apps|import\(['\"]@tauri-apps" -g '*.ts' -g '*.tsx' -g '!*.test.ts' -g '!*.test.tsx' -g '!tests/**' .

# Files that only check Tauri presence, with no direct API import — TWO detection methods, both
# required (the first pass only covered the raw-global check and undercounted; corrected 2026-08-18):
rg -l "isTauriRuntime\(\)" -g '*.ts' -g '*.tsx' -g '!*.test.ts' -g '!*.test.tsx' -g '!tests/**' .          # the helper function
rg -l "__TAURI_INTERNALS__|__TAURI__|__TAURI_METADATA__" -g '*.ts' -g '*.tsx' -g '!*.test.ts' -g '!*.test.tsx' -g '!tests/**' .  # raw globals (e.g. register-sw.ts)
# ...both diffed against the first list; comment-only matches (e.g. a docstring mentioning
# isTauriRuntime()) manually excluded after inspection.
```

Per-file API breakdown was extracted with `rg -oE "@tauri-apps/[a-zA-Z0-9/_-]*"` on each matched file. Full structured result: [`tauri-coupling-inventory.json`](tauri-coupling-inventory.json).

## Summary

Tauri coupling is **real but not centralized**. `services/tauriRuntime.ts` — the module whose name suggests it's the abstraction layer — is actually a thin 64-line, 5-function facade (`isTauriRuntime`, `getDesktopOs`, `applyDesktopRuntimeFlags`, `getTauriAppVersion`, `openTauriDataDirectory`). The real `@tauri-apps/*` API surface is imported directly across **16 non-config source files**, plus one build-config file (`vite.config.ts`, externalization only — not app-level coupling).

| Category | File count | Files |
|---|---|---|
| Direct `@tauri-apps/*` API imports | 16 | see table below |
| Build-time externalization only | 1 | `vite.config.ts` |
| Detection-only (`isTauriRuntime()`/`__TAURI__`, no direct API import) | 13 | `components/settings/AiProviderCard.tsx`, `components/settings/DataSection.tsx`, `components/settings/DesktopSection.tsx`, `components/settings/FeatureFlagsSection.tsx`, `components/settings/GeneralSections.tsx`, `hooks/useNativeNotifications.ts`, `register-sw.ts`, `services/ai/localAiDeviceProfiler.ts`, `services/aiProviderService.ts`, `services/appBootstrap.ts`, `services/factoryResetService.ts`, `services/ollamaService.ts`, `services/storageService.ts` |
| Ambient type declarations | 1 | `types/tauri-plugins.d.ts` |

## Direct API coupling by category

| Category | Files | `@tauri-apps/*` surface |
|---|---|---|
| **Filesystem + dialog + invoke** (largest single point) | `services/fs/fsCore.ts` | `api/core`, `api/path`, `plugin-dialog`, `plugin-fs` |
| **Invoke / native commands** | `services/tauriTaskBridge.ts`, `services/pandocTauri.ts`, `services/lora/loraTrainingService.ts` | `api/core` (+ `api/event`, `plugin-dialog` for LoRA) |
| **Events** | `services/tauriDeepLink.ts`, `services/tauriMenuService.ts` | `api/event` |
| **Filesystem (secondary)** | `services/logger.ts`, `services/tauriDeepLink.ts` | `api/path`, `plugin-fs` |
| **Window / menu / tray (native UI)** | `services/desktop/desktopMenu.ts`, `services/desktop/desktopTray.ts`, `services/tauriTrayService.ts` | `api/menu`, `api/tray`, `api/app`, `api/window` |
| **Notifications** | `services/desktop/desktopNotifications.ts` | `plugin-notification` |
| **Updater / process lifecycle** | `hooks/useTauriUpdater.ts`, `App.tsx` | `plugin-updater`, `api/app`, `plugin-process` |
| **HTTP (CORS bypass)** | `services/ai/fetchAdapter.ts`, `services/localServerHttp.ts` | `plugin-http` |
| **Runtime detection + version + shell** | `services/tauriRuntime.ts` | `api/app`, `api/path`, `plugin-shell` |

`services/tauriRuntime.ts` itself uses `api/app` (version) and `plugin-shell` (open data directory) — it is not merely a detection stub, but it is far from a comprehensive `DesktopPlatform`-style abstraction; most callers still reach past it into `@tauri-apps/*` directly.

## `src-tauri/` Rust scaffold

Standard, fairly small Tauri v2 layout as of `main`:

```text
src-tauri/
├── build.rs
├── capabilities/default.json
├── Cargo.toml / Cargo.lock
├── Entitlements.plist
├── fuzz/Cargo.toml            (filename-sanitization fuzz harness)
├── osv-scanner.toml
├── src/
│   ├── commands/
│   │   ├── mod.rs
│   │   └── task_supervisor.rs   (registers worldscript_task_supervisor_ping/submit — active native task-dispatch surface used by services/tauriTaskBridge.ts)
│   ├── lib.rs
│   ├── lora.rs
│   ├── main.rs
│   └── pandoc.rs
├── tauri.conf.json
└── icons/                     (11 image assets, no coupling)
```

6 Rust source files (corrected 2026-08-18 — the `commands/` module was omitted from the first pass). This is the entire native surface being migrated — small relative to the JS/TS coupling above, but it is where `WS-CEF-*` Rust work (§66 workstream catalogue) eventually lands.

## `package.json`

Existing scripts: `tauri`, `tauri:dev`, `tauri:build`, `dev:tauri`. No `cef:*` scripts exist — confirmed at Wave 0, and none are added by this PR (roadmap §81, Developer Experience, is Wave 2+ scope).

## How this maps to the roadmap

- §36 (Desktop capability parity inventory) cites this file's findings directly, file-path-annotated.
- §90 step 4/5 ("Inventory all direct `@tauri-apps/*` imports" / "Inventory all Tauri capabilities and runtime assumptions") — this document and the JSON ledger are that inventory.
- Wave 1 (`DesktopPlatform` boundary) is where this coupling starts getting funneled through typed adapters — not touched by this Wave 0 PR.

## Not in scope for this document

No behavior changes, no refactoring, no new abstractions. This is a snapshot, not an implementation — re-run the methodology above before relying on these counts once Wave 1 work begins moving files.
