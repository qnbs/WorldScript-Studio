/**
 * DesktopPlatform contract (roadmap §8, docs/cef/ROADMAP-CEF-DESKTOP-MIGRATION.md).
 * Renderer-neutral typed interface all desktop capability access should route through.
 * Wave 1 scope: relocate today's exact Tauri behavior behind this interface (TauriDesktopPlatform)
 * plus a safe no-op web/PWA implementation (WebDesktopPlatform). No CEF adapter exists yet — that's
 * Wave 2+. HTTP (`services/ai/fetchAdapter.ts`, `services/localServerHttp.ts`) is intentionally NOT a
 * facet here — the roadmap's own §8 sketch has no HTTP facet, and the coupling inventory tags both
 * files as Wave 10 scope; they keep importing `@tauri-apps/plugin-http` directly until then.
 */

export type DesktopOsKind = 'windows' | 'macos' | 'linux';

export interface RuntimeInfo {
  readonly isDesktop: boolean;
  readonly os: DesktopOsKind | null;
}

// --- filesystem + persistence -----------------------------------------------------------------

export interface DesktopDirEntry {
  name?: string;
  isDirectory?: boolean;
}

/** Low-level filesystem primitives — mirrors services/fs/fsCore.ts's `TauriApis` fs subset exactly. */
export interface DesktopFilesystem {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  /** Same-directory temp-write-then-rename so readers never observe a partial file. */
  writeTextFileAtomic(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  writeFileAtomic(path: string, data: Uint8Array): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  exists(path: string): Promise<boolean>;
  readDir(path: string): Promise<DesktopDirEntry[]>;
  remove(path: string, opts?: { recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

/** Path resolution — kept semantically separate from raw fs ops per roadmap §7.4.1's persistence framing. */
export interface DesktopPersistence {
  appDataDir(): Promise<string>;
  join(...parts: string[]): Promise<string>;
}

// --- dialogs ------------------------------------------------------------------------------------

export interface DesktopDialogs {
  openFilePicker(opts?: Record<string, unknown>): Promise<string | null>;
  saveFilePicker(opts?: Record<string, unknown>): Promise<string | null>;
}

// --- window / menu / tray (native shell) ---------------------------------------------------------

export interface DesktopWindow {
  show(): Promise<void>;
  hide(): Promise<void>;
  setFocus(): Promise<void>;
}

/**
 * Menu building stays imperative (Tauri's own builder API) — Wave 1 relocates the import point, it
 * does not invent a declarative cross-platform menu DSL (that redesign is Wave 8 "desktop integration
 * parity" scope). `loadMenuBuilder()` returns the real, typed Tauri menu module, or null on web/failure.
 */
export interface TauriMenuBuilderApi {
  Menu: typeof import('@tauri-apps/api/menu').Menu;
  Submenu: typeof import('@tauri-apps/api/menu').Submenu;
  MenuItem: typeof import('@tauri-apps/api/menu').MenuItem;
  PredefinedMenuItem: typeof import('@tauri-apps/api/menu').PredefinedMenuItem;
}

export interface DesktopMenu {
  loadMenuBuilder(): Promise<TauriMenuBuilderApi | null>;
  /** Subscribes to native menu-click events; returns an unsubscribe function. No-op unsubscribe on web. */
  onMenuAction(handler: (actionId: string) => void): Promise<() => void>;
}

export interface TauriTrayBuilderApi {
  TrayIcon: typeof import('@tauri-apps/api/tray').TrayIcon;
  Menu: typeof import('@tauri-apps/api/menu').Menu;
  MenuItem: typeof import('@tauri-apps/api/menu').MenuItem;
  PredefinedMenuItem: typeof import('@tauri-apps/api/menu').PredefinedMenuItem;
  defaultWindowIcon: typeof import('@tauri-apps/api/app').defaultWindowIcon;
}

export interface DesktopTray {
  loadTrayBuilder(): Promise<TauriTrayBuilderApi | null>;
}

// --- notifications --------------------------------------------------------------------------------

export interface DesktopNotifications {
  isPermissionGranted(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  send(title: string, body: string): Promise<boolean>;
}

// --- updater ------------------------------------------------------------------------------------

export interface DesktopPendingUpdate {
  readonly version: string;
  downloadAndInstall(): Promise<void>;
}

export interface DesktopUpdater {
  getAppVersion(): Promise<string | null>;
  /** Returns the pending update, or null when already up to date / on the web / on failure. */
  check(): Promise<DesktopPendingUpdate | null>;
  relaunch(): Promise<void>;
}

// --- lifecycle ------------------------------------------------------------------------------------

export interface DesktopCloseRequestedEvent {
  preventDefault(): void;
}

export interface DesktopLifecycle {
  /** Flushes-then-exits is the CALLER's job (app-level business logic); this only wraps the OS exit call. */
  quit(): Promise<void>;
  /** Subscribes to the native window close-button event; returns an unsubscribe function. */
  onCloseRequested(
    handler: (event: DesktopCloseRequestedEvent) => void | Promise<void>,
  ): Promise<() => void>;
}

// --- tasks (native Rust commands — named/typed per ADR-0019 point 7, never a generic invoke passthrough) --

export interface DesktopTasks {
  /** Dispatches a typed task to the Rust TaskSupervisor (`worldscript_task_supervisor_submit`). */
  submitTask<TRequest, TResult>(request: TRequest): Promise<TResult>;
  /** Health-check (`worldscript_task_supervisor_ping`). */
  pingSupervisor(): Promise<void>;
  /** Native Pandoc Markdown→EPUB conversion (`pandoc_markdown_to_epub`). Null on failure/unavailable. */
  convertMarkdownToEpub(markdown: string): Promise<Uint8Array | null>;
  /** LoRA training sidecar commands — exact param/result shapes finalized when loraTrainingService.ts migrates (Wave 1 PR B). */
  trainLora(request: unknown): Promise<unknown>;
  abortLoraTraining(): Promise<unknown>;
  mergeLora(request: unknown): Promise<unknown>;
  checkLoraEnvironment(): Promise<unknown>;
  setLoraPythonPath(pythonPath: string): Promise<unknown>;
  generateOllamaModelfile(request: unknown): Promise<string>;
}

// --- diagnostics ----------------------------------------------------------------------------------

export interface DesktopDiagnostics {
  getAppVersion(): Promise<string | null>;
  openDataDirectory(): Promise<boolean>;
}

// --- clipboard (stub — unused today; kept for §8 contract completeness, real impl is Wave 8) --------

export interface DesktopClipboard {
  readText(): Promise<string | null>;
  writeText(text: string): Promise<boolean>;
}

// --- deep links -------------------------------------------------------------------------------------

export interface DesktopDeepLinks {
  /** Subscribes to `deep-link://new-url`; returns an unsubscribe function. No-op unsubscribe on web. */
  onDeepLink(handler: (urls: string[]) => void | Promise<void>): Promise<() => void>;
}

// --- top-level contract -----------------------------------------------------------------------------

export interface DesktopPlatform {
  readonly runtime: RuntimeInfo;
  filesystem: DesktopFilesystem;
  persistence: DesktopPersistence;
  dialogs: DesktopDialogs;
  window: DesktopWindow;
  menu: DesktopMenu;
  tray: DesktopTray;
  notifications: DesktopNotifications;
  updater: DesktopUpdater;
  lifecycle: DesktopLifecycle;
  tasks: DesktopTasks;
  diagnostics: DesktopDiagnostics;
  clipboard: DesktopClipboard;
  deepLinks: DesktopDeepLinks;
}
