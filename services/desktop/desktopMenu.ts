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

/**
 * Build and install the localized application menu. Returns `true` when installed, `false` on the
 * web or if the menu API is unavailable (never throws — a menu failure must not break startup).
 */
export async function installDesktopMenu(
  t: MenuTranslate,
  runCommand: MenuCommandRunner,
): Promise<boolean> {
  if (!isTauriRuntime()) return false;
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
    await menu.setAsAppMenu();
    return true;
  } catch (err) {
    log.warn('Failed to install localized desktop menu; keeping the Rust fallback', {
      error: String(err),
    });
    return false;
  }
}
