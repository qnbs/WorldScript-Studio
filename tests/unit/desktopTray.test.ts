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
  closeCb: null as ((e: { preventDefault: () => void }) => void) | null,
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
    onCloseRequested: vi.fn(async (cb: (e: { preventDefault: () => void }) => void) => {
      h.closeCb = cb;
      return () => {};
    }),
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
    expect(await installDesktopTray((k) => k, vi.fn())).toBe(false);
  });

  it('creates a tray with localized tooltip and three custom items', async () => {
    const ok = await installDesktopTray((k) => `T:${k}`, vi.fn());
    expect(ok).toBe(true);
    expect(h.trayOpts?.tooltip).toBe('T:desktop.tray.tooltip');
    expect(h.itemCalls.map((c) => c.id)).toEqual([
      'tray-show',
      'tray-settings',
      'tray-command-palette',
    ]);
  });

  it('relabels the existing tray on a re-call instead of recreating it', async () => {
    expect(await installDesktopTray((k) => `A:${k}`, vi.fn())).toBe(true);
    expect(h.trayNew).toHaveBeenCalledTimes(1);
    // A second call (e.g. language change) relabels via setMenu/setTooltip — no second TrayIcon.
    expect(await installDesktopTray((k) => `B:${k}`, vi.fn())).toBe(true);
    expect(h.trayNew).toHaveBeenCalledTimes(1);
    expect(h.setMenu).toHaveBeenCalledTimes(1);
    expect(h.setTooltip).toHaveBeenCalledWith('B:desktop.tray.tooltip');
  });

  it('rejects a concurrent second install (in-flight guard, no double tray)', async () => {
    const results = await Promise.all([
      installDesktopTray((k) => k, vi.fn()),
      installDesktopTray((k) => k, vi.fn()),
    ]);
    // Exactly one call wins; the other is rejected by the in-flight guard before it creates anything.
    expect(results.filter(Boolean)).toHaveLength(1);
    // Only one tray's worth of items was created (3, not 6) — no duplicate creation.
    expect(h.itemCalls).toHaveLength(3);
  });

  it('left-click focuses the window; command items route to executeCommand', async () => {
    const run = vi.fn();
    await installDesktopTray((k) => k, run);
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
    expect(await installCloseToTray(() => true)).toBeNull();
  });

  it('hides + prevents close when minimizeToTray is on', async () => {
    await installCloseToTray(() => true);
    const preventDefault = vi.fn();
    h.closeCb?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(h.hide).toHaveBeenCalled();
  });

  it('lets the window close when minimizeToTray is off', async () => {
    await installCloseToTray(() => false);
    const preventDefault = vi.fn();
    h.closeCb?.({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(h.hide).not.toHaveBeenCalled();
  });
});
