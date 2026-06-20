/**
 * QNBS-v3 (T2): System tray, built in JS via `@tauri-apps/api/tray` (localized labels, ADR-D1).
 *
 * Left-click focuses the window; right-click opens a localized context menu (Show / Settings /
 * Command Palette / Quit). Custom items route through `executeCommand` (ADR-D3); Quit is a
 * predefined OS item. The Rust side only enables the `tray-icon` Cargo feature + tray capability.
 *
 * No-op on the web (guarded by `isTauriRuntime()`), so the PWA is untouched. Created once per
 * session; subsequent calls RELABEL the existing tray (e.g. on language change) rather than recreating.
 */

import type { TrayIcon as TrayIconHandle } from '@tauri-apps/api/tray';
import { createLogger } from '../logger';
import { isTauriRuntime } from '../tauriRuntime';
import { setTauriMainWindowVisible } from '../tauriTrayService';
import { DESKTOP_COMMANDS } from './desktopEvents';

const log = createLogger('desktop-tray');
const TRAY_ID = 'worldscript-main-tray';

export type MenuTranslate = (key: string) => string;
export type TrayCommandRunner = (commandId: string) => void;

let trayInstalled = false;
// QNBS-v3 (#190): in-flight guard. `trayInstalled` only flips true AFTER the async imports + tray
// creation finish, so two concurrent installDesktopTray() calls could both pass the early check and
// race to create the same tray. This flag rejects the second caller while the first is still running.
let trayInstalling = false;
// QNBS-v3 (#190): the created tray handle, kept so a re-call can relabel it (setMenu/setTooltip) on
// language change instead of being a no-op that leaves labels stuck in the old locale until restart.
let trayHandle: TrayIconHandle | null = null;

/** @internal test-only reset for the once-per-session guard. */
export function _resetTrayInstalledForTest(): void {
  trayInstalled = false;
  trayInstalling = false;
  trayHandle = null;
}

/**
 * Create the system tray, or relabel it on a re-call (e.g. language change). Returns `true` when
 * created/relabelled, `false` on the web, while another call is in flight, or if the tray API is
 * unavailable (never throws — a tray failure must not break startup).
 */
export async function installDesktopTray(
  t: MenuTranslate,
  runCommand: TrayCommandRunner,
): Promise<boolean> {
  if (!isTauriRuntime() || trayInstalling) return false;
  trayInstalling = true;
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

    // QNBS-v3 (#190): already created — relabel the existing tray (new localized menu + tooltip)
    // instead of no-op'ing, so a language change is reflected without a restart.
    if (trayInstalled && trayHandle) {
      await trayHandle.setMenu(menu);
      await trayHandle.setTooltip(t('desktop.tray.tooltip'));
      return true;
    }

    const icon = await defaultWindowIcon();
    trayHandle = await TrayIcon.new({
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
  } finally {
    trayInstalling = false;
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
