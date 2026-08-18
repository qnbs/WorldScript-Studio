import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  readTextFile: vi.fn(async (_path: string) => 'content'),
  writeTextFile: vi.fn(async (_path: string, _content: string) => {}),
  readFile: vi.fn(async (_path: string) => new Uint8Array([1, 2, 3])),
  writeFile: vi.fn(async (_path: string, _data: Uint8Array) => {}),
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
  getCurrentWindowShow: vi.fn(async () => {}),
  getCurrentWindowHide: vi.fn(async () => {}),
  getCurrentWindowSetFocus: vi.fn(async () => {}),
  onCloseRequested: vi.fn(
    async (_handler: (e: { preventDefault: () => void }) => void) => () => {},
  ),
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
  getCurrentWindow: () => ({
    show: h.getCurrentWindowShow,
    hide: h.getCurrentWindowHide,
    setFocus: h.getCurrentWindowSetFocus,
    onCloseRequested: h.onCloseRequested,
  }),
}));
vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { name: 'Menu' },
  Submenu: { name: 'Submenu' },
  MenuItem: { name: 'MenuItem' },
  PredefinedMenuItem: { name: 'PredefinedMenuItem' },
}));
vi.mock('@tauri-apps/api/tray', () => ({
  TrayIcon: { name: 'TrayIcon' },
}));

import { tauriDesktopPlatform } from '../src/adapters/tauriDesktopPlatform';

describe('tauriDesktopPlatform', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports a desktop runtime', () => {
    expect(tauriDesktopPlatform.runtime.isDesktop).toBe(true);
  });

  describe('filesystem', () => {
    it('delegates plain reads/writes to the plugin', async () => {
      await expect(tauriDesktopPlatform.filesystem.readTextFile('/p')).resolves.toBe('content');
      await tauriDesktopPlatform.filesystem.writeTextFile('/p', 'x');
      expect(h.writeTextFile).toHaveBeenCalledWith('/p', 'x');
      await expect(tauriDesktopPlatform.filesystem.exists('/p')).resolves.toBe(true);
      await expect(tauriDesktopPlatform.filesystem.readDir('/p')).resolves.toEqual([
        { name: 'a.txt', isDirectory: false },
      ]);
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
  });

  describe('window', () => {
    it('delegates show/hide/setFocus to the current window', async () => {
      await tauriDesktopPlatform.window.show();
      expect(h.getCurrentWindowShow).toHaveBeenCalled();
      await tauriDesktopPlatform.window.hide();
      expect(h.getCurrentWindowHide).toHaveBeenCalled();
    });
  });

  describe('menu + tray', () => {
    it('loadMenuBuilder returns the real menu module', async () => {
      const builder = await tauriDesktopPlatform.menu.loadMenuBuilder();
      expect(builder?.Menu).toBeDefined();
      expect(builder?.Submenu).toBeDefined();
    });

    it('onMenuAction subscribes via listen() and forwards the payload', async () => {
      const received: string[] = [];
      await tauriDesktopPlatform.menu.onMenuAction((id) => received.push(id));
      expect(h.listen).toHaveBeenCalledWith('menu-action', expect.any(Function));
      const handler = h.listen.mock.calls[0]?.[1] as (e: { payload: unknown }) => void;
      handler({ payload: 'menu-settings' });
      expect(received).toEqual(['menu-settings']);
    });

    it('loadTrayBuilder returns the real tray + menu + app modules', async () => {
      const builder = await tauriDesktopPlatform.tray.loadTrayBuilder();
      expect(builder?.TrayIcon).toBeDefined();
      expect(builder?.defaultWindowIcon).toBeDefined();
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
  });

  describe('tasks', () => {
    it('submitTask/pingSupervisor invoke the named Rust commands', async () => {
      await tauriDesktopPlatform.tasks.submitTask({ taskId: '1' });
      expect(h.invoke).toHaveBeenCalledWith('worldscript_task_supervisor_submit', {
        request: { taskId: '1' },
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

    it('convertMarkdownToEpub resolves null on failure or empty response', async () => {
      h.invoke.mockRejectedValueOnce(new Error('pandoc unavailable'));
      await expect(tauriDesktopPlatform.tasks.convertMarkdownToEpub('# x')).resolves.toBeNull();
    });
  });

  describe('diagnostics', () => {
    it('getAppVersion returns the plugin version, null on failure', async () => {
      await expect(tauriDesktopPlatform.diagnostics.getAppVersion()).resolves.toBe('1.0.0');
      h.getVersion.mockRejectedValueOnce(new Error('unavailable'));
      await expect(tauriDesktopPlatform.diagnostics.getAppVersion()).resolves.toBeNull();
    });

    it('openDataDirectory resolves the app dir and opens it via the shell plugin', async () => {
      await expect(tauriDesktopPlatform.diagnostics.openDataDirectory()).resolves.toBe(true);
      expect(h.shellOpen).toHaveBeenCalledWith('/app/data/');
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
  });
});
