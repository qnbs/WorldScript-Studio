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
} from '../types';

// QNBS-v3: every facet reuses the exact dynamic-import-inside-try/catch pattern the 14 files being
// migrated (Wave 1 PR B) already use — this adapter relocates that pattern, it does not invent a new
// one. Behavior is preserved byte-for-byte; only the import site moves.

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
  writeTextFile: async (path, content) => {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, content);
  },
  writeTextFileAtomic: async (path, content) => {
    const { writeTextFile, rename, remove } = await import('@tauri-apps/plugin-fs');
    await writeAndReplace(path, (tmp) => writeTextFile(tmp, content), rename, remove);
  },
  readFile: async (path) => {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    return readFile(path);
  },
  writeFile: async (path, data) => {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(path, data);
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
    } catch {
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
    } catch {
      return null;
    }
  },
};

// --- notifications --------------------------------------------------------------------------------

const notifications: DesktopNotifications = {
  isPermissionGranted: async () => {
    const { isPermissionGranted } = await import('@tauri-apps/plugin-notification');
    return isPermissionGranted();
  },
  requestPermission: async () => {
    const { isPermissionGranted, requestPermission } = await import(
      '@tauri-apps/plugin-notification'
    );
    if (await isPermissionGranted()) return true;
    const permission = await requestPermission();
    return permission === 'granted';
  },
  send: async (title, body) => {
    const { isPermissionGranted, sendNotification } = await import(
      '@tauri-apps/plugin-notification'
    );
    if (!(await isPermissionGranted())) return false;
    sendNotification({ title, body });
    return true;
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
        await handler({ preventDefault: () => event.preventDefault() });
      });
    } catch {
      return () => {};
    }
  },
};

// --- tasks ---------------------------------------------------------------------------------------

const tasks: DesktopTasks = {
  submitTask: async (request) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('worldscript_task_supervisor_submit', {
      request: request as Record<string, unknown>,
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
    } catch {
      return null;
    }
  },
  // QNBS-v3: LoRA commands wrap invoke() with the same signature loraTrainingService.ts uses today;
  // exact request/result types are tightened when that file migrates in Wave 1 PR B.
  trainLora: async (request) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('train_lora', request as Record<string, unknown>);
  },
  abortLoraTraining: async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('abort_lora_training');
  },
  mergeLora: async (request) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('merge_lora', request as Record<string, unknown>);
  },
  checkLoraEnvironment: async () => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('check_lora_environment');
  },
  setLoraPythonPath: async (pythonPath) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('set_lora_python_path', { pythonPath });
  },
  generateOllamaModelfile: async (request) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('generate_ollama_modelfile', request as Record<string, unknown>);
  },
};

// --- diagnostics ----------------------------------------------------------------------------------

const diagnostics: DesktopDiagnostics = {
  getAppVersion: async () => {
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      return await getVersion();
    } catch {
      return null;
    }
  },
  openDataDirectory: async () => {
    try {
      const { appDataDir, join } = await import('@tauri-apps/api/path');
      const { open } = await import('@tauri-apps/plugin-shell');
      const dir = await appDataDir();
      const path = await join(dir, '');
      await open(path);
      return true;
    } catch {
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
        void handler(urls.filter((url): url is string => Boolean(url)));
      });
      return stop;
    } catch {
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
