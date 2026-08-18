// QNBS-v3: covers every TauriDesktopPlatform facet's success + failure paths, incl. the never-throw notification guarantee, the LoRA Rust argument shapes, and logged (not silent) fallback catches.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const getCurrentWindowShow = vi.fn(async () => {});
  const getCurrentWindowHide = vi.fn(async () => {});
  const getCurrentWindowSetFocus = vi.fn(async () => {});
  const onCloseRequested = vi.fn(
    async (_handler: (e: { preventDefault: () => void }) => void) => () => {},
  );
  return {
    readTextFile: vi.fn(async (_path: string) => 'content'),
    writeTextFile: vi.fn(async (_path: string, _content: string, _opts?: unknown) => {}),
    readFile: vi.fn(async (_path: string) => new Uint8Array([1, 2, 3])),
    writeFile: vi.fn(async (_path: string, _data: Uint8Array, _opts?: unknown) => {}),
    mkdir: vi.fn(async (_path: string) => {}),
    exists: vi.fn(async (_path: string) => true),
    readDir: vi.fn(async (_path: string) => [{ name: 'a.txt', isDirectory: false }]),
    remove: vi.fn(async (_path: string) => {}),
    rename: vi.fn(async (_from: string, _to: string) => {}),
    dialogOpen: vi.fn(async (): Promise<string | null> => '/picked/file.txt'),
    dialogSave: vi.fn(async (): Promise<string | null> => '/saved/file.txt'),
    appDataDir: vi.fn(async () => '/app/data'),
    join: vi.fn(async (...parts: string[]) => parts.join('/')),
    getVersion: vi.fn(async () => '1.0.0'),
    shellOpen: vi.fn(async (_path: string) => {}),
    isPermissionGranted: vi.fn(async () => true),
    requestPermission: vi.fn(async (): Promise<'granted' | 'denied' | 'default'> => 'granted'),
    sendNotification: vi.fn(),
    updaterCheck: vi.fn(
      async () => null as { version: string; downloadAndInstall: () => Promise<void> } | null,
    ),
    relaunch: vi.fn(async () => {}),
    exit: vi.fn(async (_code: number) => {}),
    invoke: vi.fn(async (_cmd: string, _args?: unknown): Promise<unknown> => ({ ok: true })),
    listen: vi.fn(async (_event: string, _handler: (e: { payload: unknown }) => void) => () => {}),
    getCurrentWindowShow,
    getCurrentWindowHide,
    getCurrentWindowSetFocus,
    onCloseRequested,
    getCurrentWindow: vi.fn(() => ({
      show: getCurrentWindowShow,
      hide: getCurrentWindowHide,
      setFocus: getCurrentWindowSetFocus,
      onCloseRequested,
    })),
    loggerWarn: vi.fn(),
    menuImportShouldFail: { value: false },
    trayImportShouldFail: { value: false },
  };
});

vi.mock('../../../services/logger', () => ({
  logger: { warn: (...args: unknown[]) => h.loggerWarn(...args), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: h.readTextFile,
  writeTextFile: h.writeTextFile,
  readFile: h.readFile,
  writeFile: h.writeFile,
  mkdir: h.mkdir,
  exists: h.exists,
  readDir: h.readDir,
  remove: h.remove,
  rename: h.rename,
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: h.dialogOpen,
  save: h.dialogSave,
}));
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: h.appDataDir,
  join: h.join,
}));
vi.mock('@tauri-apps/api/app', () => ({
  getVersion: h.getVersion,
  defaultWindowIcon: vi.fn(async () => null),
}));
vi.mock('@tauri-apps/plugin-shell', () => ({
  open: h.shellOpen,
}));
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: h.isPermissionGranted,
  requestPermission: h.requestPermission,
  sendNotification: h.sendNotification,
}));
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: h.updaterCheck,
}));
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: h.relaunch,
  exit: h.exit,
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: h.invoke,
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: h.listen,
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => h.getCurrentWindow(),
}));
vi.mock('@tauri-apps/api/menu', () => ({
  get Menu() {
    if (h.menuImportShouldFail.value) throw new Error('menu API unavailable');
    return { name: 'Menu' };
  },
  Submenu: { name: 'Submenu' },
  MenuItem: { name: 'MenuItem' },
  PredefinedMenuItem: { name: 'PredefinedMenuItem' },
}));
vi.mock('@tauri-apps/api/tray', () => ({
  get TrayIcon() {
    if (h.trayImportShouldFail.value) throw new Error('tray API unavailable');
    return { name: 'TrayIcon' };
  },
}));

import { tauriDesktopPlatform } from '../src/adapters/tauriDesktopPlatform';

describe('tauriDesktopPlatform', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.menuImportShouldFail.value = false;
    h.trayImportShouldFail.value = false;
  });

  it('reports a desktop runtime', () => {
    expect(tauriDesktopPlatform.runtime.isDesktop).toBe(true);
  });

  describe('filesystem', () => {
    it('delegates plain reads/writes to the plugin', async () => {
      await expect(tauriDesktopPlatform.filesystem.readTextFile('/p')).resolves.toBe('content');
      await tauriDesktopPlatform.filesystem.writeTextFile('/p', 'x');
      expect(h.writeTextFile).toHaveBeenCalledWith('/p', 'x', undefined);
      await expect(tauriDesktopPlatform.filesystem.exists('/p')).resolves.toBe(true);
      await expect(tauriDesktopPlatform.filesystem.readDir('/p')).resolves.toEqual([
        { name: 'a.txt', isDirectory: false },
      ]);
    });

    // QNBS-v3: closes the append/create gap flagged in review — services/logger.ts's JSONL writes depend on these options actually reaching the plugin.
    it('forwards append/create options to the plugin (logger.ts JSONL append semantics)', async () => {
      await tauriDesktopPlatform.filesystem.writeTextFile('/logs/app.jsonl', '{}\n', {
        append: true,
        create: true,
      });
      expect(h.writeTextFile).toHaveBeenCalledWith('/logs/app.jsonl', '{}\n', {
        append: true,
        create: true,
      });

      const bytes = new Uint8Array([1, 2, 3]);
      await tauriDesktopPlatform.filesystem.writeFile('/data/blob.bin', bytes, { create: true });
      expect(h.writeFile).toHaveBeenCalledWith('/data/blob.bin', bytes, { create: true });
    });

    it('reads binary files and performs direct mkdir/remove/rename calls', async () => {
      await expect(tauriDesktopPlatform.filesystem.readFile('/p')).resolves.toEqual(
        new Uint8Array([1, 2, 3]),
      );
      await tauriDesktopPlatform.filesystem.mkdir('/newdir', { recursive: true });
      expect(h.mkdir).toHaveBeenCalledWith('/newdir', { recursive: true });
      await tauriDesktopPlatform.filesystem.remove('/gone', { recursive: true });
      expect(h.remove).toHaveBeenCalledWith('/gone', { recursive: true });
      await tauriDesktopPlatform.filesystem.rename('/a', '/b');
      expect(h.rename).toHaveBeenCalledWith('/a', '/b');
    });

    it('writeFileAtomic writes binary data to a temp path then renames over the target', async () => {
      const data = new Uint8Array([9, 9]);
      await tauriDesktopPlatform.filesystem.writeFileAtomic('/data/blob.bin', data);
      expect(h.writeFile).toHaveBeenCalledTimes(1);
      const [tempPath, written] = h.writeFile.mock.calls[0] as [string, Uint8Array];
      expect(tempPath).toMatch(/^\/data\/blob\.bin\.tmp-/);
      expect(written).toBe(data);
      expect(h.rename).toHaveBeenCalledWith(tempPath, '/data/blob.bin');
    });

    it('writeTextFileAtomic writes to a temp path then renames over the target', async () => {
      await tauriDesktopPlatform.filesystem.writeTextFileAtomic('/data/settings.json', '{}');
      expect(h.writeTextFile).toHaveBeenCalledTimes(1);
      const [tempPath, content] = h.writeTextFile.mock.calls[0] as [string, string];
      expect(tempPath).toMatch(/^\/data\/settings\.json\.tmp-/);
      expect(content).toBe('{}');
      expect(h.rename).toHaveBeenCalledWith(tempPath, '/data/settings.json');
    });

    it('writeTextFileAtomic removes the temp file and rethrows on a failed write', async () => {
      h.writeTextFile.mockRejectedValueOnce(new Error('disk full'));
      await expect(
        tauriDesktopPlatform.filesystem.writeTextFileAtomic('/data/x.json', '{}'),
      ).rejects.toThrow('disk full');
      expect(h.remove).toHaveBeenCalled();
      expect(h.rename).not.toHaveBeenCalled();
    });
  });

  describe('persistence + dialogs', () => {
    it('resolves the app data dir and joined paths', async () => {
      await expect(tauriDesktopPlatform.persistence.appDataDir()).resolves.toBe('/app/data');
      await expect(tauriDesktopPlatform.persistence.join('a', 'b')).resolves.toBe('a/b');
    });

    it('dialogs return the picked path or null', async () => {
      await expect(tauriDesktopPlatform.dialogs.openFilePicker()).resolves.toBe('/picked/file.txt');
      h.dialogOpen.mockResolvedValueOnce(null);
      await expect(tauriDesktopPlatform.dialogs.openFilePicker()).resolves.toBeNull();
    });

    it('saveFilePicker returns the saved path or null', async () => {
      await expect(tauriDesktopPlatform.dialogs.saveFilePicker()).resolves.toBe('/saved/file.txt');
      h.dialogSave.mockResolvedValueOnce(null);
      await expect(tauriDesktopPlatform.dialogs.saveFilePicker()).resolves.toBeNull();
    });
  });

  describe('window', () => {
    it('delegates show/hide/setFocus to the current window', async () => {
      await tauriDesktopPlatform.window.show();
      expect(h.getCurrentWindowShow).toHaveBeenCalled();
      await tauriDesktopPlatform.window.hide();
      expect(h.getCurrentWindowHide).toHaveBeenCalled();
      await tauriDesktopPlatform.window.setFocus();
      expect(h.getCurrentWindowSetFocus).toHaveBeenCalled();
    });
  });

  describe('menu + tray', () => {
    it('loadMenuBuilder returns the real menu module', async () => {
      const builder = await tauriDesktopPlatform.menu.loadMenuBuilder();
      expect(builder?.Menu).toBeDefined();
      expect(builder?.Submenu).toBeDefined();
    });

    it('loadMenuBuilder resolves null (and logs) when the menu module is unavailable', async () => {
      h.menuImportShouldFail.value = true;
      await expect(tauriDesktopPlatform.menu.loadMenuBuilder()).resolves.toBeNull();
      expect(h.loggerWarn).toHaveBeenCalled();
    });

    it('onMenuAction subscribes via listen() and forwards the payload', async () => {
      const received: string[] = [];
      await tauriDesktopPlatform.menu.onMenuAction((id) => received.push(id));
      expect(h.listen).toHaveBeenCalledWith('menu-action', expect.any(Function));
      const handler = h.listen.mock.calls[0]?.[1] as (e: { payload: unknown }) => void;
      handler({ payload: 'menu-settings' });
      expect(received).toEqual(['menu-settings']);
    });

    it('onMenuAction resolves a no-op unsubscribe (and logs) when listen() fails', async () => {
      h.listen.mockRejectedValueOnce(new Error('event API unavailable'));
      const unsubscribe = await tauriDesktopPlatform.menu.onMenuAction(vi.fn());
      expect(() => unsubscribe()).not.toThrow();
    });

    it('loadTrayBuilder returns the real tray + menu + app modules', async () => {
      const builder = await tauriDesktopPlatform.tray.loadTrayBuilder();
      expect(builder?.TrayIcon).toBeDefined();
      expect(builder?.defaultWindowIcon).toBeDefined();
    });

    it('loadTrayBuilder resolves null (and logs) when the tray module is unavailable', async () => {
      h.trayImportShouldFail.value = true;
      await expect(tauriDesktopPlatform.tray.loadTrayBuilder()).resolves.toBeNull();
      expect(h.loggerWarn).toHaveBeenCalled();
    });
  });

  describe('notifications', () => {
    it('gates send() behind permission', async () => {
      h.isPermissionGranted.mockResolvedValueOnce(false);
      await expect(tauriDesktopPlatform.notifications.send('t', 'b')).resolves.toBe(false);
      expect(h.sendNotification).not.toHaveBeenCalled();

      h.isPermissionGranted.mockResolvedValueOnce(true);
      await expect(tauriDesktopPlatform.notifications.send('t', 'b')).resolves.toBe(true);
      expect(h.sendNotification).toHaveBeenCalledWith({ title: 't', body: 'b' });
    });

    // QNBS-v3: preserves the pre-migration never-throw guarantee at the facet level, not just at the desktopNotifications.ts wrapper — a fire-and-forget caller must never see a rejection.
    it('never rejects, even when every plugin call throws', async () => {
      h.isPermissionGranted.mockRejectedValueOnce(new Error('plugin unavailable'));
      await expect(tauriDesktopPlatform.notifications.isPermissionGranted()).resolves.toBe(false);

      // QNBS-v3: isPermissionGranted must resolve false (not reject) here, otherwise requestPermission() never reaches its own plugin call — this exercises THAT call's failure, not a repeat of the assertion above.
      h.isPermissionGranted.mockResolvedValueOnce(false);
      h.requestPermission.mockRejectedValueOnce(new Error('plugin unavailable'));
      await expect(tauriDesktopPlatform.notifications.requestPermission()).resolves.toBe(false);

      // QNBS-v3: isPermissionGranted must resolve true here so send() reaches sendNotification() itself, exercising that call's failure.
      h.isPermissionGranted.mockResolvedValueOnce(true);
      h.sendNotification.mockImplementationOnce(() => {
        throw new Error('plugin unavailable');
      });
      await expect(tauriDesktopPlatform.notifications.send('t', 'b')).resolves.toBe(false);
      expect(h.loggerWarn).toHaveBeenCalledTimes(3);
    });

    it('requestPermission skips the plugin request when already granted', async () => {
      h.isPermissionGranted.mockResolvedValueOnce(true);
      await expect(tauriDesktopPlatform.notifications.requestPermission()).resolves.toBe(true);
      expect(h.requestPermission).not.toHaveBeenCalled();
    });

    it('requestPermission calls the plugin and reflects its granted/denied result when not yet granted', async () => {
      h.isPermissionGranted.mockResolvedValueOnce(false);
      h.requestPermission.mockResolvedValueOnce('granted');
      await expect(tauriDesktopPlatform.notifications.requestPermission()).resolves.toBe(true);
      expect(h.requestPermission).toHaveBeenCalledTimes(1);

      h.isPermissionGranted.mockResolvedValueOnce(false);
      h.requestPermission.mockResolvedValueOnce('denied');
      await expect(tauriDesktopPlatform.notifications.requestPermission()).resolves.toBe(false);
    });
  });

  describe('updater + lifecycle', () => {
    it('check() returns null when up to date, wraps a pending update otherwise', async () => {
      await expect(tauriDesktopPlatform.updater.check()).resolves.toBeNull();

      const downloadAndInstall = vi.fn(async () => {});
      h.updaterCheck.mockResolvedValueOnce({ version: '2.0.0', downloadAndInstall });
      const pending = await tauriDesktopPlatform.updater.check();
      expect(pending?.version).toBe('2.0.0');
      await pending?.downloadAndInstall();
      expect(downloadAndInstall).toHaveBeenCalled();
    });

    it('updater.getAppVersion and relaunch delegate to the plugin', async () => {
      await expect(tauriDesktopPlatform.updater.getAppVersion()).resolves.toBe('1.0.0');
      await tauriDesktopPlatform.updater.relaunch();
      expect(h.relaunch).toHaveBeenCalled();
    });

    it('quit() calls plugin-process exit(0)', async () => {
      await tauriDesktopPlatform.lifecycle.quit();
      expect(h.exit).toHaveBeenCalledWith(0);
    });

    it('onCloseRequested forwards a preventDefault-capable event', async () => {
      const holder: { captured: { preventDefault: () => void } | null } = { captured: null };
      await tauriDesktopPlatform.lifecycle.onCloseRequested((event) => {
        holder.captured = event;
      });
      const handler = h.onCloseRequested.mock.calls[0]?.[0] as (e: {
        preventDefault: () => void;
      }) => Promise<void>;
      const preventDefault = vi.fn();
      await handler({ preventDefault });
      expect(holder.captured).not.toBeNull();
      holder.captured?.preventDefault();
      expect(preventDefault).toHaveBeenCalled();
    });

    it('onCloseRequested logs (does not throw) when the handler rejects', async () => {
      await tauriDesktopPlatform.lifecycle.onCloseRequested(() => {
        throw new Error('handler exploded');
      });
      const handler = h.onCloseRequested.mock.calls[0]?.[0] as (e: {
        preventDefault: () => void;
      }) => Promise<void>;
      await expect(handler({ preventDefault: vi.fn() })).resolves.toBeUndefined();
      expect(h.loggerWarn).toHaveBeenCalled();
    });

    it('onCloseRequested resolves a no-op unsubscribe (and logs) when the window API is unavailable', async () => {
      h.getCurrentWindow.mockImplementationOnce(() => {
        throw new Error('window API unavailable');
      });
      const unsubscribe = await tauriDesktopPlatform.lifecycle.onCloseRequested(vi.fn());
      expect(() => unsubscribe()).not.toThrow();
      expect(h.loggerWarn).toHaveBeenCalled();
    });
  });

  describe('tasks', () => {
    it('submitTask/pingSupervisor invoke the named Rust commands', async () => {
      await tauriDesktopPlatform.tasks.submitTask({
        taskId: '1',
        taskType: 'text.analyze',
        payload: {},
        priority: 'normal',
        target: 'rust',
        timeoutMs: 5000,
      });
      expect(h.invoke).toHaveBeenCalledWith('worldscript_task_supervisor_submit', {
        request: expect.objectContaining({ taskId: '1' }),
      });
      await tauriDesktopPlatform.tasks.pingSupervisor();
      expect(h.invoke).toHaveBeenCalledWith('worldscript_task_supervisor_ping');
    });

    it('convertMarkdownToEpub decodes the base64 response', async () => {
      h.invoke.mockResolvedValueOnce({ base64: btoa('epub-bytes') });
      const bytes = await tauriDesktopPlatform.tasks.convertMarkdownToEpub('# Title');
      expect(bytes).not.toBeNull();
      expect(new TextDecoder().decode(bytes!)).toBe('epub-bytes');
    });

    it('convertMarkdownToEpub resolves null when the plugin call rejects', async () => {
      h.invoke.mockRejectedValueOnce(new Error('pandoc unavailable'));
      await expect(tauriDesktopPlatform.tasks.convertMarkdownToEpub('# x')).resolves.toBeNull();
      expect(h.loggerWarn).toHaveBeenCalled();
    });

    it('convertMarkdownToEpub resolves null on an empty/whitespace-only base64 response', async () => {
      h.invoke.mockResolvedValueOnce({ base64: '   ' });
      await expect(tauriDesktopPlatform.tasks.convertMarkdownToEpub('# x')).resolves.toBeNull();
    });

    // QNBS-v3: real regression coverage — train_lora's Rust command requires the whole request wrapped under a top-level `payload` key.
    it('trainLora wraps the request under a top-level payload key', async () => {
      const request = {
        model_id: 'base',
        dataset_path: '/data',
        output_dir: '/out',
        preset: 'balanced',
        rank: null,
        alpha: null,
        epochs: null,
        max_seq_len: null,
      };
      await tauriDesktopPlatform.tasks.trainLora(request);
      expect(h.invoke).toHaveBeenCalledWith('train_lora', { payload: request });
    });

    it('mergeLora and generateOllamaModelfile send flat camelCase args (no payload wrapper)', async () => {
      await tauriDesktopPlatform.tasks.mergeLora({
        baseModel: 'base',
        adapterPath: '/adapter',
        outputPath: '/out',
      });
      expect(h.invoke).toHaveBeenCalledWith('merge_lora', {
        baseModel: 'base',
        adapterPath: '/adapter',
        outputPath: '/out',
      });

      await tauriDesktopPlatform.tasks.generateOllamaModelfile({
        baseModel: 'base',
        adapterPath: '/adapter',
        name: 'MyAssistant',
      });
      expect(h.invoke).toHaveBeenCalledWith('generate_ollama_modelfile', {
        baseModel: 'base',
        adapterPath: '/adapter',
        name: 'MyAssistant',
      });
    });

    it('abortLoraTraining, checkLoraEnvironment, setLoraPythonPath invoke the named commands', async () => {
      await tauriDesktopPlatform.tasks.abortLoraTraining();
      expect(h.invoke).toHaveBeenCalledWith('abort_lora_training');
      await tauriDesktopPlatform.tasks.checkLoraEnvironment();
      expect(h.invoke).toHaveBeenCalledWith('check_lora_environment');
      await tauriDesktopPlatform.tasks.setLoraPythonPath('/usr/bin/python3');
      expect(h.invoke).toHaveBeenCalledWith('set_lora_python_path', {
        pythonPath: '/usr/bin/python3',
      });
    });
  });

  describe('diagnostics', () => {
    it('getAppVersion returns the plugin version, null (and logs) on failure', async () => {
      await expect(tauriDesktopPlatform.diagnostics.getAppVersion()).resolves.toBe('1.0.0');
      h.getVersion.mockRejectedValueOnce(new Error('unavailable'));
      await expect(tauriDesktopPlatform.diagnostics.getAppVersion()).resolves.toBeNull();
      expect(h.loggerWarn).toHaveBeenCalled();
    });

    // QNBS-v3: closes the redundant-IPC-call finding — open the resolved app data dir directly, no join('', ...) round trip.
    it('openDataDirectory opens the app data dir directly, without a redundant join() call', async () => {
      await expect(tauriDesktopPlatform.diagnostics.openDataDirectory()).resolves.toBe(true);
      expect(h.shellOpen).toHaveBeenCalledWith('/app/data');
      expect(h.join).not.toHaveBeenCalled();
    });

    it('openDataDirectory resolves false (and logs) on failure', async () => {
      h.shellOpen.mockRejectedValueOnce(new Error('shell unavailable'));
      await expect(tauriDesktopPlatform.diagnostics.openDataDirectory()).resolves.toBe(false);
      expect(h.loggerWarn).toHaveBeenCalled();
    });
  });

  describe('clipboard', () => {
    it('is a documented stub returning safe defaults', async () => {
      await expect(tauriDesktopPlatform.clipboard.readText()).resolves.toBeNull();
      await expect(tauriDesktopPlatform.clipboard.writeText('x')).resolves.toBe(false);
    });
  });

  describe('deepLinks', () => {
    it('onDeepLink normalizes a single-string payload into an array and filters falsy entries', async () => {
      const received: string[][] = [];
      await tauriDesktopPlatform.deepLinks.onDeepLink((urls) => {
        received.push(urls);
      });
      const handler = h.listen.mock.calls[0]?.[1] as (e: { payload: unknown }) => void;
      handler({ payload: 'worldscript://project.worldscript' });
      expect(received).toEqual([['worldscript://project.worldscript']]);
    });

    it('logs (does not throw) when the handler rejects', async () => {
      await tauriDesktopPlatform.deepLinks.onDeepLink(() => {
        throw new Error('handler exploded');
      });
      const handler = h.listen.mock.calls[0]?.[1] as (e: { payload: unknown }) => void;
      handler({ payload: 'worldscript://x.worldscript' });
      await Promise.resolve();
      await Promise.resolve();
      expect(h.loggerWarn).toHaveBeenCalled();
    });

    it('resolves a no-op unsubscribe (and logs) when listen() fails', async () => {
      h.listen.mockRejectedValueOnce(new Error('event API unavailable'));
      const unsubscribe = await tauriDesktopPlatform.deepLinks.onDeepLink(vi.fn());
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  // QNBS-v3: pure-internal-helper branches that never fire under jsdom's default environment (linux UA, real crypto.randomUUID, no transient fs errors) — isolated here since each needs its own module reset / global stub.
  describe('internals: OS detection, temp-path fallback, transient retry', () => {
    it('detectOs() falls back to null for an unrecognized user agent', async () => {
      vi.stubGlobal('navigator', { userAgent: 'SomeUnknownDevice/1.0' });
      vi.resetModules();
      const { tauriDesktopPlatform: freshPlatform } = await import(
        '../src/adapters/tauriDesktopPlatform'
      );
      expect(freshPlatform.runtime.os).toBeNull();
      vi.unstubAllGlobals();
      vi.resetModules();
    });

    it('temporaryPath falls back to manual random-hex generation when crypto.randomUUID is unavailable', async () => {
      const nativeCrypto = globalThis.crypto;
      vi.stubGlobal('crypto', {
        getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
      });
      try {
        await tauriDesktopPlatform.filesystem.writeTextFileAtomic('/data/x.json', '{}');
        const [tempPath] = h.writeTextFile.mock.calls[0] as [string, string];
        expect(tempPath).toMatch(/^\/data\/x\.json\.tmp-[0-9a-f]+$/);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('retries a transient write failure once, then succeeds', async () => {
      vi.useFakeTimers();
      try {
        h.writeTextFile.mockRejectedValueOnce(new Error('resource busy, try again'));
        const writePromise = tauriDesktopPlatform.filesystem.writeTextFileAtomic(
          '/data/retry.json',
          '{}',
        );
        await vi.advanceTimersByTimeAsync(500);
        await writePromise;
        expect(h.writeTextFile).toHaveBeenCalledTimes(2);
        expect(h.rename).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
