// QNBS-v3: covers every WebDesktopPlatform facet's safe-default/throw behavior, matching desktopNotifications.ts's pre-migration never-throw convention where a web equivalent exists.
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
    await expect(webDesktopPlatform.filesystem.readFile('x')).rejects.toThrow(/unavailable/);
    await expect(webDesktopPlatform.filesystem.writeTextFile('x', 'y')).rejects.toThrow(
      /unavailable/,
    );
    await expect(webDesktopPlatform.filesystem.writeFile('x', new Uint8Array())).rejects.toThrow(
      /unavailable/,
    );
    await expect(
      webDesktopPlatform.filesystem.writeFileAtomic('x', new Uint8Array()),
    ).rejects.toThrow(/unavailable/);
    await expect(webDesktopPlatform.filesystem.writeTextFileAtomic('x', 'y')).rejects.toThrow(
      /unavailable/,
    );
    await expect(webDesktopPlatform.filesystem.mkdir('x')).rejects.toThrow(/unavailable/);
    await expect(webDesktopPlatform.filesystem.remove('x')).rejects.toThrow(/unavailable/);
    await expect(webDesktopPlatform.filesystem.rename('x', 'y')).rejects.toThrow(/unavailable/);
  });

  it('persistence: join concatenates, appDataDir has no web equivalent and throws', async () => {
    await expect(webDesktopPlatform.persistence.join('a', 'b', 'c')).resolves.toBe('a/b/c');
    await expect(webDesktopPlatform.persistence.appDataDir()).rejects.toThrow(/unavailable/);
  });

  it('dialogs resolve null (no native picker on the web)', async () => {
    await expect(webDesktopPlatform.dialogs.openFilePicker()).resolves.toBeNull();
    await expect(webDesktopPlatform.dialogs.saveFilePicker()).resolves.toBeNull();
  });

  it('window/menu/tray/lifecycle facets are safe no-ops', async () => {
    await expect(webDesktopPlatform.window.show()).resolves.toBeUndefined();
    await expect(webDesktopPlatform.window.hide()).resolves.toBeUndefined();
    await expect(webDesktopPlatform.window.setFocus()).resolves.toBeUndefined();
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
    await expect(webDesktopPlatform.updater.relaunch()).resolves.toBeUndefined();
  });

  it('diagnostics resolve null/false', async () => {
    await expect(webDesktopPlatform.diagnostics.getAppVersion()).resolves.toBeNull();
    await expect(webDesktopPlatform.diagnostics.openDataDirectory()).resolves.toBe(false);
  });

  it('tasks: convertMarkdownToEpub resolves null, every native command throws', async () => {
    await expect(webDesktopPlatform.tasks.convertMarkdownToEpub('# x')).resolves.toBeNull();
    await expect(
      webDesktopPlatform.tasks.submitTask({
        contractVersion: '1.0.0',
        taskId: '1',
        taskType: 'text.analyze',
        payload: {},
        priority: 'normal',
        target: 'rust',
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/unavailable/);
    await expect(webDesktopPlatform.tasks.pingSupervisor()).rejects.toThrow(/unavailable/);
    await expect(
      webDesktopPlatform.tasks.trainLora({
        model_id: 'm',
        dataset_path: '/d',
        output_dir: '/o',
        preset: 'p',
        rank: null,
        alpha: null,
        epochs: null,
        max_seq_len: null,
      }),
    ).rejects.toThrow(/unavailable/);
    await expect(webDesktopPlatform.tasks.abortLoraTraining()).rejects.toThrow(/unavailable/);
    const unsubscribe = await webDesktopPlatform.tasks.onLoraTrainingProgress(() => {});
    expect(() => unsubscribe()).not.toThrow();
    await expect(
      webDesktopPlatform.tasks.mergeLora({
        baseModel: 'm',
        adapterPath: '/a',
        outputPath: '/o',
      }),
    ).rejects.toThrow(/unavailable/);
    await expect(webDesktopPlatform.tasks.checkLoraEnvironment()).rejects.toThrow(/unavailable/);
    await expect(webDesktopPlatform.tasks.setLoraPythonPath('/usr/bin/python3')).rejects.toThrow(
      /unavailable/,
    );
    await expect(
      webDesktopPlatform.tasks.generateOllamaModelfile({
        baseModel: 'm',
        adapterPath: '/a',
        name: 'n',
      }),
    ).rejects.toThrow(/unavailable/);
  });

  it('project validation rejects because the Core validator is native-only', async () => {
    await expect(webDesktopPlatform.project.validateProject('{}')).rejects.toThrow(
      /DesktopPlatform\.project is unavailable/,
    );
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
