/**
 * Tests for services/desktop/desktopMenu.ts
 * QNBS-v3 (T1): Mocks @tauri-apps/api/menu + isTauriRuntime — asserts the localized menu structure,
 * the app-menu install, and that custom items route to executeCommand with the right command ids.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ItemOpts {
  id?: string;
  text?: string;
  accelerator?: string;
  action?: () => void;
}
interface SubmenuOpts {
  text?: string;
}

const h = vi.hoisted(() => ({
  itemCalls: [] as ItemOpts[],
  submenuCalls: [] as SubmenuOpts[],
  predefinedCalls: [] as Array<{ item?: string }>,
  setAsAppMenu: vi.fn(),
  isTauri: { value: true },
}));

vi.mock('../../services/tauriRuntime', () => ({ isTauriRuntime: () => h.isTauri.value }));

vi.mock('@tauri-apps/api/menu', () => ({
  Menu: { new: vi.fn(async (o: unknown) => ({ ...(o as object), setAsAppMenu: h.setAsAppMenu })) },
  Submenu: {
    new: vi.fn(async (o: SubmenuOpts) => {
      h.submenuCalls.push(o);
      return { ...o };
    }),
  },
  MenuItem: {
    new: vi.fn(async (o: ItemOpts) => {
      h.itemCalls.push(o);
      return { ...o };
    }),
  },
  PredefinedMenuItem: {
    new: vi.fn(async (o: { item?: string }) => {
      h.predefinedCalls.push(o);
      return { ...o };
    }),
  },
}));

import {
  _resetMenuInstallTokenForTest,
  installDesktopMenu,
} from '../../services/desktop/desktopMenu';

describe('installDesktopMenu', () => {
  beforeEach(() => {
    h.itemCalls.length = 0;
    h.submenuCalls.length = 0;
    h.predefinedCalls.length = 0;
    h.setAsAppMenu.mockClear();
    h.isTauri.value = true;
    _resetMenuInstallTokenForTest();
  });

  it('returns false on the web (no Tauri runtime)', async () => {
    h.isTauri.value = false;
    const ok = await installDesktopMenu((k) => k, vi.fn());
    expect(ok).toBe(false);
    expect(h.setAsAppMenu).not.toHaveBeenCalled();
  });

  it('builds five localized submenus and sets the app menu', async () => {
    const ok = await installDesktopMenu((k) => `T:${k}`, vi.fn());
    expect(ok).toBe(true);
    expect(h.setAsAppMenu).toHaveBeenCalledTimes(1);
    expect(h.submenuCalls.map((s) => s.text)).toEqual([
      'T:desktop.menu.file',
      'T:desktop.menu.edit',
      'T:desktop.menu.view',
      'T:desktop.menu.window',
      'T:desktop.menu.help',
    ]);
  });

  it('creates exactly the four custom items (Edit/Window use predefined items)', async () => {
    await installDesktopMenu((k) => k, vi.fn());
    expect(h.itemCalls.map((c) => c.id)).toEqual([
      'menu-export',
      'menu-settings',
      'menu-command-palette',
      'menu-help',
    ]);
    // Command Palette keeps its accelerator.
    expect(h.itemCalls.find((c) => c.id === 'menu-command-palette')?.accelerator).toBe(
      'CmdOrCtrl+K',
    );
  });

  it('routes custom item actions to executeCommand with the right command id', async () => {
    const run = vi.fn();
    await installDesktopMenu((k) => k, run);
    const byId = Object.fromEntries(h.itemCalls.map((c) => [c.id, c]));
    byId['menu-export']?.action?.();
    byId['menu-settings']?.action?.();
    byId['menu-command-palette']?.action?.();
    byId['menu-help']?.action?.();
    expect(run).toHaveBeenCalledWith('nav-export');
    expect(run).toHaveBeenCalledWith('nav-settings');
    expect(run).toHaveBeenCalledWith('global-open-command-palette');
    expect(run).toHaveBeenCalledWith('nav-help');
  });

  it('discards a stale concurrent install — only the latest applies setAsAppMenu', async () => {
    const results = await Promise.all([
      installDesktopMenu((k) => k, vi.fn()),
      installDesktopMenu((k) => k, vi.fn()),
    ]);
    // Core guarantee: a superseded (stale) call must NEVER apply its menu — at most one of the two
    // overlapping calls reaches setAsAppMenu, so a stale locale can't overwrite the newer menu.
    expect(h.setAsAppMenu.mock.calls.length).toBeLessThanOrEqual(1);
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(1);
    // And the earlier call is the one discarded: its result is false.
    expect(results[0]).toBe(false);
  });

  it('returns false (and does not throw) when the menu API rejects', async () => {
    const mod = await import('@tauri-apps/api/menu');
    vi.mocked(mod.Menu.new).mockRejectedValueOnce(new Error('boom'));
    const ok = await installDesktopMenu((k) => k, vi.fn());
    expect(ok).toBe(false);
  });
});
