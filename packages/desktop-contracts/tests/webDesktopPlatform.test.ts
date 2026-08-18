import { describe, expect, it } from 'vitest';
import { webDesktopPlatform } from '../src/adapters/webDesktopPlatform';

describe('webDesktopPlatform', () => {
  it('reports a non-desktop runtime with no OS', () => {
    expect(webDesktopPlatform.runtime).toEqual({ isDesktop: false, os: null });
  });

  it('filesystem: soft-default reads resolve safely, mutating calls throw', async () => {
    await expect(webDesktopPlatform.filesystem.exists('x')).resolves.toBe(false);
    await expect(webDesktopPlatform.filesystem.readDir('x')).resolves.toEqual([]);
    await expect(webDesktopPlatform.filesystem.readTextFile('x')).rejects.toThrow(/unavailable/);
    await expect(webDesktopPlatform.filesystem.writeTextFileAtomic('x', 'y')).rejects.toThrow(
      /unavailable/,
    );
  });

  it('persistence.join concatenates without a real filesystem', async () => {
    await expect(webDesktopPlatform.persistence.join('a', 'b', 'c')).resolves.toBe('a/b/c');
  });

  it('dialogs resolve null (no native picker on the web)', async () => {
    await expect(webDesktopPlatform.dialogs.openFilePicker()).resolves.toBeNull();
    await expect(webDesktopPlatform.dialogs.saveFilePicker()).resolves.toBeNull();
  });

  it('window/menu/tray/lifecycle facets are safe no-ops', async () => {
    await expect(webDesktopPlatform.window.show()).resolves.toBeUndefined();
    await expect(webDesktopPlatform.menu.loadMenuBuilder()).resolves.toBeNull();
    const unsubscribeMenu = await webDesktopPlatform.menu.onMenuAction(() => {});
    expect(() => unsubscribeMenu()).not.toThrow();
    await expect(webDesktopPlatform.tray.loadTrayBuilder()).resolves.toBeNull();
    await expect(webDesktopPlatform.lifecycle.quit()).resolves.toBeUndefined();
    const unsubscribeClose = await webDesktopPlatform.lifecycle.onCloseRequested(() => {});
    expect(() => unsubscribeClose()).not.toThrow();
  });

  it('notifications never grant/send on the web', async () => {
    await expect(webDesktopPlatform.notifications.isPermissionGranted()).resolves.toBe(false);
    await expect(webDesktopPlatform.notifications.requestPermission()).resolves.toBe(false);
    await expect(webDesktopPlatform.notifications.send('t', 'b')).resolves.toBe(false);
  });

  it('updater resolves no update and a null version', async () => {
    await expect(webDesktopPlatform.updater.getAppVersion()).resolves.toBeNull();
    await expect(webDesktopPlatform.updater.check()).resolves.toBeNull();
  });

  it('diagnostics resolve null/false', async () => {
    await expect(webDesktopPlatform.diagnostics.getAppVersion()).resolves.toBeNull();
    await expect(webDesktopPlatform.diagnostics.openDataDirectory()).resolves.toBe(false);
  });

  it('tasks: convertMarkdownToEpub resolves null, native commands throw', async () => {
    await expect(webDesktopPlatform.tasks.convertMarkdownToEpub('# x')).resolves.toBeNull();
    await expect(webDesktopPlatform.tasks.pingSupervisor()).rejects.toThrow(/unavailable/);
  });

  it('clipboard is a documented stub', async () => {
    await expect(webDesktopPlatform.clipboard.readText()).resolves.toBeNull();
    await expect(webDesktopPlatform.clipboard.writeText('x')).resolves.toBe(false);
  });

  it('deepLinks.onDeepLink resolves a no-op unsubscribe', async () => {
    const unsubscribe = await webDesktopPlatform.deepLinks.onDeepLink(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});
