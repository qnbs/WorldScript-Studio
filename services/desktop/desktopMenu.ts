/**
 * QNBS-v3 (T1): Localized native application menu, built in JS via `@tauri-apps/api/menu`.
 *
 * Replaces the hardcoded-English Rust menu (the Rust `install_app_menu` remains as a pre-paint
 * fallback; `setAsAppMenu()` overrides it once the React tree has a translator). Building in JS is
 * the only way to localize labels — there is no `t()` outside React (ADR-D1). Custom items route
 * through `executeCommand` (ADR-D3); Edit/Window use predefined OS-localized items, so the OS
 * handles undo/redo/clipboard/window controls natively with no wiring.
 *
 * No-op on the web (guarded by `isTauriRuntime()`), so the PWA is untouched.
 */

import { createLogger } from '../logger';
import { isTauriRuntime } from '../tauriRuntime';
import { DESKTOP_COMMANDS } from './desktopEvents';

const log = createLogger('desktop-menu');

/** Minimal translator shape — accepts the app's `t` (extra params are ignored for menu labels). */
export type MenuTranslate = (key: string) => string;
/** Routes a native menu action to an app command (the App-level `executeCommand`). */
export type MenuCommandRunner = (commandId: string) => void;

// QNBS-v3 (#189): monotonic request token. installDesktopMenu is async and re-runs on every language
// change; without this, two overlapping calls race and whichever finishes setAsAppMenu() LAST wins —
// even if it started earlier with a stale locale. Each call captures the latest token and bails before
// applying if a newer call has since started.
let menuInstallToken = 0;

/** @internal test-only reset for the request-token guard. */
export function _resetMenuInstallTokenForTest(): void {
  menuInstallToken = 0;
}

/**
 * Build and install the localized application menu. Returns `true` when installed, `false` on the
 * web, if superseded by a newer call, or if the menu API is unavailable (never throws — a menu
 * failure must not break startup).
 */
export async function installDesktopMenu(
  t: MenuTranslate,
  runCommand: MenuCommandRunner,
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  const myToken = ++menuInstallToken;
  try {
    const { Menu, Submenu, MenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu');

    const fileMenu = await Submenu.new({
      text: t('desktop.menu.file'),
      items: [
        await MenuItem.new({
          id: 'menu-export',
          text: t('desktop.menu.export'),
          action: () => runCommand(DESKTOP_COMMANDS.export),
        }),
        await MenuItem.new({
          id: 'menu-settings',
          text: t('desktop.menu.settings'),
          action: () => runCommand(DESKTOP_COMMANDS.settings),
        }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({ item: 'Quit' }),
      ],
    });

    // Predefined items carry OS-native (already localized) labels and are routed by the OS to the
    // focused WebView — no app wiring needed.
    const editMenu = await Submenu.new({
      text: t('desktop.menu.edit'),
      items: [
        await PredefinedMenuItem.new({ item: 'Undo' }),
        await PredefinedMenuItem.new({ item: 'Redo' }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({ item: 'Cut' }),
        await PredefinedMenuItem.new({ item: 'Copy' }),
        await PredefinedMenuItem.new({ item: 'Paste' }),
        await PredefinedMenuItem.new({ item: 'SelectAll' }),
      ],
    });

    const viewMenu = await Submenu.new({
      text: t('desktop.menu.view'),
      items: [
        await MenuItem.new({
          id: 'menu-command-palette',
          text: t('desktop.menu.commandPalette'),
          accelerator: 'CmdOrCtrl+K',
          action: () => runCommand(DESKTOP_COMMANDS.commandPalette),
        }),
      ],
    });

    const windowMenu = await Submenu.new({
      text: t('desktop.menu.window'),
      items: [
        await PredefinedMenuItem.new({ item: 'Minimize' }),
        await PredefinedMenuItem.new({ item: 'Maximize' }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({ item: 'Fullscreen' }),
        await PredefinedMenuItem.new({ item: 'CloseWindow' }),
      ],
    });

    const helpMenu = await Submenu.new({
      text: t('desktop.menu.help'),
      items: [
        await MenuItem.new({
          id: 'menu-help',
          text: t('desktop.menu.helpCenter'),
          action: () => runCommand(DESKTOP_COMMANDS.help),
        }),
      ],
    });

    const menu = await Menu.new({
      items: [fileMenu, editMenu, viewMenu, windowMenu, helpMenu],
    });
    // QNBS-v3 (#189): a newer installDesktopMenu call has started since this one began — discard this
    // stale build instead of letting it overwrite the newer menu via setAsAppMenu().
    if (myToken !== menuInstallToken) return false;
    await menu.setAsAppMenu();
    return true;
  } catch (err) {
    log.warn('Failed to install localized desktop menu; keeping the Rust fallback', {
      error: String(err),
    });
    return false;
  }
}
