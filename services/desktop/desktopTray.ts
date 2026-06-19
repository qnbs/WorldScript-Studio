/**
 * QNBS-v3 (T2): System tray, built in JS via `@tauri-apps/api/tray` (localized labels, ADR-D1).
 *
 * Left-click focuses the window; right-click opens a localized context menu (Show / Settings /
 * Command Palette / Quit). Custom items route through `executeCommand` (ADR-D3); Quit is a
 * predefined OS item. The Rust side only enables the `tray-icon` Cargo feature + tray capability.
 *
 * No-op on the web (guarded by `isTauriRuntime()`), so the PWA is untouched. Created once per
 * session (idempotent) — relabel-on-language-change is a future refinement.
 */

import { createLogger } from '../logger';
import { isTauriRuntime } from '../tauriRuntime';
import { setTauriMainWindowVisible } from '../tauriTrayService';
import { DESKTOP_COMMANDS } from './desktopEvents';

const log = createLogger('desktop-tray');
const TRAY_ID = 'worldscript-main-tray';

export type MenuTranslate = (key: string) => string;
export type TrayCommandRunner = (commandId: string) => void;

let trayInstalled = false;

/** @internal test-only reset for the once-per-session guard. */
export function _resetTrayInstalledForTest(): void {
  trayInstalled = false;
}

/**
 * Create the system tray. Returns `true` when created, `false` on the web, if already created, or
 * if the tray API is unavailable (never throws — a tray failure must not break startup).
 */
export async function installDesktopTray(
  t: MenuTranslate,
  runCommand: TrayCommandRunner,
): Promise<boolean> {
  if (!isTauriRuntime() || trayInstalled) return false;
  try {
    const [{ TrayIcon }, { Menu, MenuItem, PredefinedMenuItem }, { defaultWindowIcon }] =
      await Promise.all([
        import('@tauri-apps/api/tray'),
        import('@tauri-apps/api/menu'),
        import('@tauri-apps/api/app'),
      ]);

    const menu = await Menu.new({
      items: [
        await MenuItem.new({
          id: 'tray-show',
          text: t('desktop.tray.show'),
          action: () => {
            void setTauriMainWindowVisible(true);
          },
        }),
        await MenuItem.new({
          id: 'tray-settings',
          text: t('desktop.tray.settings'),
          action: () => runCommand(DESKTOP_COMMANDS.settings),
        }),
        await MenuItem.new({
          id: 'tray-command-palette',
          text: t('desktop.tray.commandPalette'),
          action: () => runCommand(DESKTOP_COMMANDS.commandPalette),
        }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({ item: 'Quit' }),
      ],
    });

    const icon = await defaultWindowIcon();
    await TrayIcon.new({
      id: TRAY_ID,
      tooltip: t('desktop.tray.tooltip'),
      // Only set the icon when the app exposes one (null on some setups); `icon` rejects undefined.
      ...(icon ? { icon } : {}),
      menu,
      // Left-click focuses the window; the menu opens on right-click only.
      showMenuOnLeftClick: false,
      action: (event: { type: string; button?: string }) => {
        if (event.type === 'Click' && event.button === 'Left') {
          void setTauriMainWindowVisible(true);
        }
      },
    });
    trayInstalled = true;
    return true;
  } catch (err) {
    log.warn('Failed to create system tray', { error: String(err) });
    return false;
  }
}

/**
 * Intercept the window close button: when `shouldMinimizeToTray()` is true, hide to the tray instead
 * of quitting. Returns an unlisten fn (or null on web / failure). The getter is read live so a
 * settings change takes effect without re-registering.
 */
export async function installCloseToTray(
  shouldMinimizeToTray: () => boolean,
): Promise<(() => void) | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const win = getCurrentWindow();
    return await win.onCloseRequested((event) => {
      if (shouldMinimizeToTray()) {
        event.preventDefault();
        void win.hide();
      }
    });
  } catch (err) {
    log.warn('Failed to install close-to-tray handler', { error: String(err) });
    return null;
  }
}
