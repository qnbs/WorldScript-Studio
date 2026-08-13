/**
 * Tests for services/desktop/desktopTray.ts
 * QNBS-v3 (T2): Mocks @tauri-apps/api/{tray,menu,app,window} + isTauriRuntime + tauriTrayService —
 * asserts tray creation, left-click focus, the close-to-tray handler, and web no-op.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ItemOpts {
  id?: string;
  text?: string;
  action?: () => void;
}

const h = vi.hoisted(() => ({
  itemCalls: [] as ItemOpts[],
  trayOpts: null as {
    tooltip?: string;
    action?: (e: { type: string; button?: string }) => void;
  } | null,
  setVisible: vi.fn(),
  closeCb: null as ((e: { preventDefault: () => void }) => void | Promise<void>) | null,
  hide: vi.fn(),
  setMenu: vi.fn(),
  setTooltip: vi.fn(),
  trayNew: vi.fn(),
  isTauri: { value: true },
}));

vi.mock('../../services/tauriRuntime', () => ({ isTauriRuntime: () => h.isTauri.value }));
vi.mock('../../services/tauriTrayService', () => ({
  setTauriMainWindowVisible: (v: boolean) => h.setVisible(v),
}));
vi.mock('@tauri-apps/api/tray', () => ({
  TrayIcon: {
    new: vi.fn(async (o: typeof h.trayOpts) => {
      h.trayOpts = o;
      h.trayNew();
      return { setMenu: h.setMenu, setTooltip: h.setTooltip };
    }),
  },
}));
vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: vi.fn(async (o: unknown) => ({ ...(o as object) })) },
  MenuItem: {
    new: vi.fn(async (o: ItemOpts) => {
      h.itemCalls.push(o);
      return { ...o };
    }),
  },
  PredefinedMenuItem: { new: vi.fn(async (o: unknown) => ({ ...(o as object) })) },
}));
vi.mock('@tauri-apps/api/app', () => ({ defaultWindowIcon: vi.fn(async () => null) }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: vi.fn(
      async (cb: (e: { preventDefault: () => void }) => void | Promise<void>) => {
        h.closeCb = cb;
        return () => {};
      },
    ),
    hide: () => h.hide(),
  }),
}));

import {
  _resetTrayInstalledForTest,
  installCloseToTray,
  installDesktopTray,
} from '../../services/desktop/desktopTray';

describe('installDesktopTray', () => {
  beforeEach(() => {
    h.itemCalls.length = 0;
    h.trayOpts = null;
    h.setVisible.mockClear();
    h.setMenu.mockClear();
    h.setTooltip.mockClear();
    h.trayNew.mockClear();
    h.isTauri.value = true;
    _resetTrayInstalledForTest();
  });

  it('returns false on the web (no Tauri runtime)', async () => {
    h.isTauri.value = false;
    expect(
      await installDesktopTray(
        (k) => k,
        vi.fn(),
        vi.fn(async () => {}),
      ),
    ).toBe(false);
  });

  it('creates a tray with localized tooltip and four custom items, including Quit', async () => {
    const ok = await installDesktopTray(
      (k) => `T:${k}`,
      vi.fn(),
      vi.fn(async () => {}),
    );
    expect(ok).toBe(true);
    expect(h.trayOpts?.tooltip).toBe('T:desktop.tray.tooltip');
    expect(h.itemCalls.map((c) => c.id)).toEqual([
      'tray-show',
      'tray-settings',
      'tray-command-palette',
      'tray-quit',
    ]);
  });

  it('routes the tray Quit item action to quitApp, not a predefined OS action', async () => {
    const quitApp = vi.fn(async () => {});
    await installDesktopTray((k) => k, vi.fn(), quitApp);
    const byId = Object.fromEntries(h.itemCalls.map((c) => [c.id, c]));
    byId['tray-quit']?.action?.();
    expect(quitApp).toHaveBeenCalledTimes(1);
  });

  it('relabels the existing tray on a re-call instead of recreating it', async () => {
    expect(
      await installDesktopTray(
        (k) => `A:${k}`,
        vi.fn(),
        vi.fn(async () => {}),
      ),
    ).toBe(true);
    expect(h.trayNew).toHaveBeenCalledTimes(1);
    // A second call (e.g. language change) relabels via setMenu/setTooltip — no second TrayIcon.
    expect(
      await installDesktopTray(
        (k) => `B:${k}`,
        vi.fn(),
        vi.fn(async () => {}),
      ),
    ).toBe(true);
    expect(h.trayNew).toHaveBeenCalledTimes(1);
    expect(h.setMenu).toHaveBeenCalledTimes(1);
    expect(h.setTooltip).toHaveBeenCalledWith('B:desktop.tray.tooltip');
  });

  it('rejects a concurrent second install (in-flight guard, no double tray)', async () => {
    const results = await Promise.all([
      installDesktopTray(
        (k) => k,
        vi.fn(),
        vi.fn(async () => {}),
      ),
      installDesktopTray(
        (k) => k,
        vi.fn(),
        vi.fn(async () => {}),
      ),
    ]);
    // Exactly one call wins; the other is rejected by the in-flight guard before it creates anything.
    expect(results.filter(Boolean)).toHaveLength(1);
    // Only one tray's worth of items was created (4, not 8) — no duplicate creation.
    expect(h.itemCalls).toHaveLength(4);
  });

  it('left-click focuses the window; command items route to executeCommand', async () => {
    const run = vi.fn();
    await installDesktopTray(
      (k) => k,
      run,
      vi.fn(async () => {}),
    );
    h.trayOpts?.action?.({ type: 'Click', button: 'Left' });
    expect(h.setVisible).toHaveBeenCalledWith(true);
    const byId = Object.fromEntries(h.itemCalls.map((c) => [c.id, c]));
    byId['tray-settings']?.action?.();
    byId['tray-command-palette']?.action?.();
    expect(run).toHaveBeenCalledWith('nav-settings');
    expect(run).toHaveBeenCalledWith('global-open-command-palette');
  });
});

describe('installCloseToTray', () => {
  beforeEach(() => {
    h.hide.mockClear();
    h.closeCb = null;
    h.isTauri.value = true;
  });

  it('returns null on the web', async () => {
    h.isTauri.value = false;
    expect(await installCloseToTray(() => true, vi.fn())).toBeNull();
  });

  it('hides + prevents close when minimizeToTray is on, without flushing', async () => {
    const flush = vi.fn(async () => {});
    await installCloseToTray(() => true, flush);
    const preventDefault = vi.fn();
    await h.closeCb?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(h.hide).toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it('lets the window close when minimizeToTray is off', async () => {
    const flush = vi.fn(async () => {});
    await installCloseToTray(() => false, flush);
    const preventDefault = vi.fn();
    await h.closeCb?.({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(h.hide).not.toHaveBeenCalled();
  });

  it('keeps the window open (fail closed) when the flush rejects, instead of quitting anyway', async () => {
    const flush = vi.fn(async () => {
      throw new Error('write failed');
    });
    await installCloseToTray(() => false, flush);
    const preventDefault = vi.fn();
    await h.closeCb?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
  });

  it('awaits the flush callback before letting the window close (QNBS-v3 #332/D3)', async () => {
    let resolveFlush: (() => void) | undefined;
    const flush = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFlush = resolve;
        }),
    );
    await installCloseToTray(() => false, flush);
    const preventDefault = vi.fn();
    const closePromise = h.closeCb?.({ preventDefault }) as Promise<void> | undefined;
    expect(flush).toHaveBeenCalledTimes(1);
    // The handler is still pending until the flush resolves.
    let settled = false;
    void closePromise?.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveFlush?.();
    await closePromise;
    expect(settled).toBe(true);
  });
});
