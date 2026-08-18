import { logger } from '../../../../services/logger';
import type {
  DesktopClipboard,
  DesktopDeepLinks,
  DesktopDiagnostics,
  DesktopDialogs,
  DesktopFilesystem,
  DesktopLifecycle,
  DesktopMenu,
  DesktopNotifications,
  DesktopOsKind,
  DesktopPersistence,
  DesktopPlatform,
  DesktopTasks,
  DesktopTray,
  DesktopUpdater,
  DesktopWindow,
  LoraAbortOutcome,
  LoraMergeRequest,
  LoraOllamaModelfileRequest,
  LoraTrainingEnvironmentResult,
  LoraTrainingProgressEvent,
  LoraTrainRequest,
} from '../types';

// QNBS-v3: every facet reuses the exact dynamic-import-inside-try/catch pattern the 14 files being migrated (Wave 1 PR B) already use — relocates the pattern, doesn't invent a new one.

function detectOs(): DesktopOsKind | null {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/windows/i.test(ua)) return 'windows';
  if (/mac/i.test(ua)) return 'macos';
  if (/linux|x11|cros/i.test(ua)) return 'linux';
  return null;
}

// --- filesystem + persistence -----------------------------------------------------------------

const atomicWriteTails = new Map<string, Promise<void>>();

function temporaryPath(path: string): string {
  const suffix =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
  return `${path}.tmp-${suffix}`;
}

async function retryFs<T>(fn: () => Promise<T>, retries = 2, delayMs = 500): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      const isTransient =
        msg.includes('busy') ||
        msg.includes('temporarily') ||
        msg.includes('locked') ||
        msg.includes('try again') ||
        msg.includes('resource unavailable');
      if (!isTransient || attempt >= retries) break;
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
  throw lastError;
}

async function writeAndReplace(
  path: string,
  write: (temporary: string) => Promise<void>,
  rename: (from: string, to: string) => Promise<void>,
  remove: (path: string) => Promise<void>,
): Promise<void> {
  const previous = atomicWriteTails.get(path);
  const current = (previous?.catch(() => undefined) ?? Promise.resolve()).then(async () => {
    const temporary = temporaryPath(path);
    try {
      await retryFs(() => write(temporary));
      await retryFs(() => rename(temporary, path));
    } catch (error) {
      try {
        await retryFs(() => remove(temporary));
      } catch {
        // QNBS-v3: cleanup best-effort — the original write/rename error is what the caller must see.
      }
      throw error;
    }
  });
  atomicWriteTails.set(path, current);
  try {
    await current;
  } finally {
    if (atomicWriteTails.get(path) === current) atomicWriteTails.delete(path);
  }
}

const filesystem: DesktopFilesystem = {
  readTextFile: async (path) => {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    return readTextFile(path);
  },
  writeTextFile: async (path, content, opts) => {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, content, opts);
  },
  writeTextFileAtomic: async (path, content) => {
    const { writeTextFile, rename, remove } = await import('@tauri-apps/plugin-fs');
    await writeAndReplace(path, (tmp) => writeTextFile(tmp, content), rename, remove);
  },
  readFile: async (path) => {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    return readFile(path);
  },
  writeFile: async (path, data, opts) => {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(path, data, opts);
  },
  writeFileAtomic: async (path, data) => {
    const { writeFile, rename, remove } = await import('@tauri-apps/plugin-fs');
    await writeAndReplace(path, (tmp) => writeFile(tmp, data), rename, remove);
  },
  mkdir: async (path, opts) => {
    const { mkdir } = await import('@tauri-apps/plugin-fs');
    await mkdir(path, opts);
  },
  exists: async (path) => {
    const { exists } = await import('@tauri-apps/plugin-fs');
    return exists(path);
  },
  readDir: async (path) => {
    const { readDir } = await import('@tauri-apps/plugin-fs');
    return readDir(path);
  },
  remove: async (path, opts) => {
    const { remove } = await import('@tauri-apps/plugin-fs');
    await remove(path, opts);
  },
  rename: async (oldPath, newPath) => {
    const { rename } = await import('@tauri-apps/plugin-fs');
    await rename(oldPath, newPath);
  },
};

const persistence: DesktopPersistence = {
  appDataDir: async () => {
    const { appDataDir } = await import('@tauri-apps/api/path');
    return appDataDir();
  },
  join: async (...parts) => {
    const { join } = await import('@tauri-apps/api/path');
    return join(...parts);
  },
};

// --- dialogs ------------------------------------------------------------------------------------

const dialogs: DesktopDialogs = {
  openFilePicker: async (opts) => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const result = await open(opts);
    return typeof result === 'string' ? result : null;
  },
  saveFilePicker: async (opts) => {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const result = await save(opts);
    return result ?? null;
  },
};

// --- window / menu / tray -------------------------------------------------------------------------

const windowFacet: DesktopWindow = {
  show: async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().show();
  },
  hide: async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().hide();
  },
  setFocus: async () => {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setFocus();
  },
};

const menu: DesktopMenu = {
  loadMenuBuilder: async () => {
    try {
      const { Menu, Submenu, MenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu');
      return { Menu, Submenu, MenuItem, PredefinedMenuItem };
    } catch (error) {
      logger.warn('desktopPlatform.menu: failed to load the native menu builder', { error });
      return null;
    }
  },
  onMenuAction: async (handler) => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const stop = await listen<string>('menu-action', (event) => handler(event.payload));
      return stop;
    } catch {
      return () => {};
    }
  },
};

const tray: DesktopTray = {
  loadTrayBuilder: async () => {
    try {
      const [{ TrayIcon }, { Menu, MenuItem, PredefinedMenuItem }, { defaultWindowIcon }] =
        await Promise.all([
          import('@tauri-apps/api/tray'),
          import('@tauri-apps/api/menu'),
          import('@tauri-apps/api/app'),
        ]);
      return { TrayIcon, Menu, MenuItem, PredefinedMenuItem, defaultWindowIcon };
    } catch (error) {
      logger.warn('desktopPlatform.tray: failed to load the native tray builder', { error });
      return null;
    }
  },
};

// --- notifications --------------------------------------------------------------------------------

// QNBS-v3: mirrors services/desktop/desktopNotifications.ts's pre-migration never-throw guarantee at the facet level too, since desktopPlatform is now a directly-consumable API, not just this one wrapper.
const notifications: DesktopNotifications = {
  isPermissionGranted: async () => {
    try {
      const { isPermissionGranted } = await import('@tauri-apps/plugin-notification');
      return await isPermissionGranted();
    } catch (error) {
      logger.warn('desktopPlatform.notifications: failed to read permission state', { error });
      return false;
    }
  },
  requestPermission: async () => {
    try {
      const { isPermissionGranted, requestPermission } = await import(
        '@tauri-apps/plugin-notification'
      );
      if (await isPermissionGranted()) return true;
      const permission = await requestPermission();
      return permission === 'granted';
    } catch (error) {
      logger.warn('desktopPlatform.notifications: failed to request permission', { error });
      return false;
    }
  },
  send: async (title, body) => {
    try {
      const { isPermissionGranted, sendNotification } = await import(
        '@tauri-apps/plugin-notification'
      );
      if (!(await isPermissionGranted())) return false;
      sendNotification({ title, body });
      return true;
    } catch (error) {
      logger.warn('desktopPlatform.notifications: failed to send', { error });
      return false;
    }
  },
};

// --- updater ------------------------------------------------------------------------------------

const updater: DesktopUpdater = {
  getAppVersion: async () => {
    const { getVersion } = await import('@tauri-apps/api/app');
    return getVersion();
  },
  check: async () => {
    const { check } = await import('@tauri-apps/plugin-updater');
    const result = await check();
    if (!result) return null;
    return { version: result.version, downloadAndInstall: () => result.downloadAndInstall() };
  },
  relaunch: async () => {
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  },
};

// --- lifecycle ------------------------------------------------------------------------------------

const lifecycle: DesktopLifecycle = {
  quit: async () => {
    const { exit } = await import('@tauri-apps/plugin-process');
    await exit(0);
  },
  onCloseRequested: async (handler) => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      return await win.onCloseRequested(async (event) => {
        try {
          await handler({ preventDefault: () => event.preventDefault() });
        } catch (error) {
          logger.warn('desktopPlatform.lifecycle: onCloseRequested handler failed', { error });
        }
      });
    } catch (error) {
      logger.warn('desktopPlatform.lifecycle: failed to install the close-requested handler', {
        error,
      });
      return () => {};
    }
  },
};

// --- tasks ---------------------------------------------------------------------------------------

// QNBS-v3: validate native Rust responses at the adapter boundary rather than trusting an unchecked cast — a malformed response throws here and is handled by the caller's existing error path, instead of a bogus shape being trusted downstream.
function isLoraAbortOutcome(value: unknown): value is LoraAbortOutcome {
  return (
    value === 'confirmed' || value === 'pending_start_cancelled' || value === 'nothing_to_cancel'
  );
}

// QNBS-v3: python_path/last_error are optional-but-typed on the wire (string | null | absent) — a present value of any other type must reject, not silently pass through as a truthy non-string.
function isOptionalStringOrNull(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

const LORA_PROGRESS_EVENT_KINDS = new Set([
  'loading_model',
  'dataset_loaded',
  'progress',
  'completed',
  'error',
]);

function isLoraTrainingProgressEvent(value: unknown): value is LoraTrainingProgressEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['event'] === 'string' && LORA_PROGRESS_EVENT_KINDS.has(v['event']);
}

function isLoraTrainingEnvironmentResult(value: unknown): value is LoraTrainingEnvironmentResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['python_available'] === 'boolean' &&
    typeof v['unsloth_available'] === 'boolean' &&
    typeof v['cuda_available'] === 'boolean' &&
    typeof v['vram_gb'] === 'number' &&
    typeof v['python_version'] === 'string' &&
    isOptionalStringOrNull(v['python_path']) &&
    isOptionalStringOrNull(v['last_error'])
  );
}

const tasks: DesktopTasks = {
  submitTask: async (request) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('worldscript_task_supervisor_submit', {
      request: request as unknown as Record<string, unknown>,
    });
  },
  pingSupervisor: async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('worldscript_task_supervisor_ping');
  },
  convertMarkdownToEpub: async (markdown) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<{ base64: string }>('pandoc_markdown_to_epub', { markdown });
      const b64 = res?.base64 ?? '';
      if (!b64.trim()) return null;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } catch (error) {
      logger.warn('desktopPlatform.tasks: convertMarkdownToEpub failed', { error });
      return null;
    }
  },
  // QNBS-v3: train_lora's Rust command binds args under a top-level `payload` key — matches loraTrainingService.ts's existing invoke shape exactly.
  trainLora: async (request: LoraTrainRequest) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('train_lora', { payload: request });
  },
  // QNBS-v3: deliberately does NOT catch-and-noop like the other subscription facets (menu/deepLinks/lifecycle) — a failed subscription here must abort startTraining before the long-running native job starts, matching the pre-migration tauriListen()'s uncaught-rejection behavior.
  onLoraTrainingProgress: async (handler) => {
    const { listen } = await import('@tauri-apps/api/event');
    const stop = await listen('lora-progress', (event) => {
      if (!isLoraTrainingProgressEvent(event.payload)) {
        logger.warn('desktopPlatform.tasks: ignoring malformed LoRA training progress payload', {
          payload: event.payload,
        });
        return;
      }
      handler(event.payload);
    });
    return stop;
  },
  abortLoraTraining: async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke('abort_lora_training');
    if (!isLoraAbortOutcome(result)) {
      throw new Error('abort_lora_training returned an unexpected response');
    }
    return result;
  },
  // QNBS-v3: merge_lora/generateOllamaModelfile bind flat camelCase args (no serde rename) — spread the request object directly, matching loraTrainingService.ts.
  mergeLora: async (request: LoraMergeRequest) => {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('merge_lora', { ...request });
  },
  checkLoraEnvironment: async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke('check_lora_environment');
    if (!isLoraTrainingEnvironmentResult(result)) {
      throw new Error('check_lora_environment returned an unexpected response');
    }
    return result;
  },
  setLoraPythonPath: async (pythonPath) => {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke('set_lora_python_path', { pythonPath });
    if (!isLoraTrainingEnvironmentResult(result)) {
      throw new Error('set_lora_python_path returned an unexpected response');
    }
    return result;
  },
  generateOllamaModelfile: async (request: LoraOllamaModelfileRequest) => {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke('generate_ollama_modelfile', { ...request });
    // QNBS-v3: validate the Rust response shape at the boundary, matching convertMarkdownToEpub's own guard, instead of trusting an unchecked cast.
    if (typeof result !== 'string') {
      throw new Error('generate_ollama_modelfile returned a non-string response');
    }
    return result;
  },
};

// --- diagnostics ----------------------------------------------------------------------------------

const diagnostics: DesktopDiagnostics = {
  getAppVersion: async () => {
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      return await getVersion();
    } catch (error) {
      logger.warn('desktopPlatform.diagnostics: failed to read the app version', { error });
      return null;
    }
  },
  openDataDirectory: async () => {
    try {
      const { appDataDir } = await import('@tauri-apps/api/path');
      const { open } = await import('@tauri-apps/plugin-shell');
      const dir = await appDataDir();
      await open(dir);
      return true;
    } catch (error) {
      logger.warn('desktopPlatform.diagnostics: failed to open the data directory', { error });
      return false;
    }
  },
};

// --- clipboard (stub — real impl is Wave 8) --------------------------------------------------------

const clipboard: DesktopClipboard = {
  readText: async () => null,
  writeText: async () => false,
};

// --- deep links -------------------------------------------------------------------------------------

const deepLinks: DesktopDeepLinks = {
  onDeepLink: async (handler) => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const stop = await listen<string[] | string>('deep-link://new-url', (event) => {
        const urls = Array.isArray(event.payload) ? event.payload : [event.payload];
        void (async () => {
          try {
            await handler(urls.filter((url): url is string => Boolean(url)));
          } catch (error) {
            logger.warn('desktopPlatform.deepLinks: handler failed', { error });
          }
        })();
      });
      return stop;
    } catch (error) {
      logger.warn('desktopPlatform.deepLinks: failed to subscribe', { error });
      return () => {};
    }
  },
};

/** Tauri-backed implementation — every method preserves today's exact behavior, just relocated. */
export const tauriDesktopPlatform: DesktopPlatform = {
  runtime: { isDesktop: true, os: detectOs() },
  filesystem,
  persistence,
  dialogs,
  window: windowFacet,
  menu,
  tray,
  notifications,
  updater,
  lifecycle,
  tasks,
  diagnostics,
  clipboard,
  deepLinks,
};
