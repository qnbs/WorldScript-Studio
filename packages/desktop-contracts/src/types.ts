// QNBS-v3: Wave 1 renderer-neutral DesktopPlatform contract — every desktop capability access should route through this interface instead of a direct @tauri-apps/* import.
import { z } from 'zod';

/**
 * DesktopPlatform contract (docs/native/ROADMAP-QT-GPUI-DESKTOP.md).
 * Renderer-neutral typed interface all desktop capability access should route through.
 * Wave 1 scope: relocate today's exact Tauri behavior behind this interface (`tauriDesktopPlatform`)
 * plus a safe no-op web/PWA implementation (`webDesktopPlatform`). No Qt or GPUI adapter exists yet —
 * those are admitted later per the roadmap's gates. HTTP (`services/ai/fetchAdapter.ts`,
 * `services/localServerHttp.ts`) is intentionally NOT a facet here — this interface has no HTTP
 * facet by design; those files keep importing `@tauri-apps/plugin-http` directly, a permanent,
 * documented exception in the import-boundary guardrail.
 */

import type { RustTaskRequest, RustTaskResultEvent } from '@domain/worker-bus';

export type DesktopOsKind = 'windows' | 'macos' | 'linux';

export interface RuntimeInfo {
  readonly isDesktop: boolean;
  readonly os: DesktopOsKind | null;
}

export const PROJECT_VALIDATE_CONTRACT_VERSION = '1.0.0' as const;

// --- filesystem + persistence -----------------------------------------------------------------

// QNBS-v3: required (not optional) — Tauri's real DirEntry.name/.isDirectory are always present and the adapter passes them straight through; the web adapter's empty array never needs to construct one.
export interface DesktopDirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

/** Matches Tauri plugin-fs's real WriteFileOptions subset — services/logger.ts needs `{ append: true, create: true }` for JSONL log writes. */
export interface DesktopWriteOptions {
  append?: boolean;
  create?: boolean;
}

/** Low-level filesystem primitives — mirrors services/fs/fsCore.ts's `TauriApis` fs subset exactly. */
export interface DesktopFilesystem {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string, opts?: DesktopWriteOptions): Promise<void>;
  /** Same-directory temp-write-then-rename so readers never observe a partial file. */
  writeTextFileAtomic(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array, opts?: DesktopWriteOptions): Promise<void>;
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

/** Matches src-tauri/src/lora.rs's `LoraTrainPayload` field-for-field (snake_case, no serde rename). */
export interface LoraTrainRequest {
  model_id: string;
  dataset_path: string;
  output_dir: string;
  preset: string;
  rank: number | null;
  alpha: number | null;
  epochs: number | null;
  max_seq_len: number | null;
}

/** Matches `merge_lora`'s flat, default-camelCase-bound Tauri args (no serde rename on the Rust side). */
export interface LoraMergeRequest {
  baseModel: string;
  adapterPath: string;
  outputPath: string;
}

/** Matches `generate_ollama_modelfile`'s flat, default-camelCase-bound Tauri args. */
export interface LoraOllamaModelfileRequest {
  baseModel: string;
  adapterPath: string;
  name: string;
}

// QNBS-v3: these three types replace what were previously Promise<unknown>/unchecked-cast task results, closing the "validate native responses before trusting result shapes" gap for LoRA.
/** Matches `check_lora_environment` / `set_lora_python_path`'s native response shape (snake_case, no serde rename). Validated at the adapter boundary — never an unchecked cast of the raw invoke() result. */
export interface LoraTrainingEnvironmentResult {
  python_available: boolean;
  unsloth_available: boolean;
  cuda_available: boolean;
  vram_gb: number;
  python_version: string;
  python_path?: string | null;
  last_error?: string | null;
}

/** Matches `abort_lora_training`'s three-way native result — 'pending_start_cancelled' means the run was still starting (no process yet) but the cancellation was recorded, unlike 'nothing_to_cancel' which is a true no-op. */
export type LoraAbortOutcome = 'confirmed' | 'pending_start_cancelled' | 'nothing_to_cancel';

/** Shape of the native `lora-progress` event payload — validated at the adapter boundary before reaching the handler, never an unchecked cast of the raw event payload. */
export interface LoraTrainingProgressEvent {
  event: 'loading_model' | 'dataset_loaded' | 'progress' | 'completed' | 'error';
  model?: string;
  size?: number;
  epoch?: number;
  step?: number;
  loss?: number;
  progress_percent?: number;
  adapter_path?: string;
  gguf_path?: string;
  message?: string;
}

export interface DesktopTasks {
  /** Dispatches a typed task to the Rust TaskSupervisor (`worldscript_task_supervisor_submit`). */
  submitTask(request: RustTaskRequest): Promise<RustTaskResultEvent>;
  /** Health-check (`worldscript_task_supervisor_ping`). */
  pingSupervisor(): Promise<void>;
  /** Native Pandoc Markdown→EPUB conversion (`pandoc_markdown_to_epub`). Null on failure/unavailable. */
  convertMarkdownToEpub(markdown: string): Promise<Uint8Array | null>;
  /** LoRA training (`train_lora`) — Rust expects the whole request wrapped under a top-level `payload` key; the adapter does that wrapping, not the caller. */
  trainLora(request: LoraTrainRequest): Promise<string>;
  /** Subscribes to LoRA training progress events (`lora-progress`); returns an unsubscribe function. Malformed native payloads are logged and dropped, never forwarded to the handler. */
  onLoraTrainingProgress(
    handler: (payload: LoraTrainingProgressEvent) => void,
  ): Promise<() => void>;
  abortLoraTraining(): Promise<LoraAbortOutcome>;
  mergeLora(request: LoraMergeRequest): Promise<void>;
  checkLoraEnvironment(): Promise<LoraTrainingEnvironmentResult>;
  setLoraPythonPath(pythonPath: string): Promise<LoraTrainingEnvironmentResult>;
  generateOllamaModelfile(request: LoraOllamaModelfileRequest): Promise<string>;
}

export interface ProjectValidationResult {
  contractVersion: string;
  valid: boolean;
  schemaVersion?: number;
  error?: string;
}

export interface DesktopProject {
  validateProject(envelopeJson: string): Promise<ProjectValidationResult>;
}

export const ProjectValidationResultSchema = z
  .object({
    contractVersion: z.literal(PROJECT_VALIDATE_CONTRACT_VERSION),
    valid: z.boolean(),
    schemaVersion: z.number().int().nonnegative().optional(),
    error: z.string().optional(),
  })
  .transform(({ contractVersion, valid, schemaVersion, error }) => ({
    contractVersion,
    valid,
    ...(schemaVersion === undefined ? {} : { schemaVersion }),
    ...(error === undefined ? {} : { error }),
  }));

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
  readonly filesystem: DesktopFilesystem;
  readonly persistence: DesktopPersistence;
  readonly dialogs: DesktopDialogs;
  readonly window: DesktopWindow;
  readonly menu: DesktopMenu;
  readonly tray: DesktopTray;
  readonly notifications: DesktopNotifications;
  readonly updater: DesktopUpdater;
  readonly lifecycle: DesktopLifecycle;
  readonly tasks: DesktopTasks;
  readonly project: DesktopProject;
  readonly diagnostics: DesktopDiagnostics;
  readonly clipboard: DesktopClipboard;
  readonly deepLinks: DesktopDeepLinks;
}
