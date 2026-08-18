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

import type { TauriTrayBuilderApi } from '@domain/desktop-contracts';
import { desktopPlatform } from '../desktopPlatform';
import { createLogger } from '../logger';
import { setTauriMainWindowVisible } from '../tauriTrayService';
import { DESKTOP_COMMANDS } from './desktopEvents';

const log = createLogger('desktop-tray');
const TRAY_ID = 'worldscript-main-tray';

export type MenuTranslate = (key: string) => string;
export type TrayCommandRunner = (commandId: string) => void;
/** Flushes pending state, then exits the process — must not resolve if it did not actually quit. */
export type DesktopQuitFn = () => Promise<void>;

let trayInstalled = false;
// QNBS-v3 (#190): in-flight guard. `trayInstalled` only flips true AFTER the async imports + tray
// creation finish, so two concurrent installDesktopTray() calls could both pass the early check and
// race to create the same tray. This flag rejects the second caller while the first is still running.
let trayInstalling = false;
// QNBS-v3 (#190): the created tray handle, kept so a re-call can relabel it (setMenu/setTooltip) on
// language change instead of being a no-op that leaves labels stuck in the old locale until restart.
// QNBS-v3: TrayIcon has a private constructor (Tauri's real class is only constructible via the
// static TrayIcon.new() factory) — InstanceType<> rejects that, so derive the handle type from
// new()'s own return type instead.
let trayHandle: Awaited<ReturnType<TauriTrayBuilderApi['TrayIcon']['new']>> | null = null;

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
  quitApp: DesktopQuitFn,
): Promise<boolean> {
  if (!desktopPlatform.runtime.isDesktop || trayInstalling) return false;
  trayInstalling = true;
  try {
    // QNBS-v3: loads the builder through desktopPlatform.tray instead of the direct @tauri-apps/api/tray+menu+app imports it replaced
    const builder = await desktopPlatform.tray.loadTrayBuilder();
    if (!builder) return false;
    const { TrayIcon, Menu, MenuItem, PredefinedMenuItem, defaultWindowIcon } = builder;

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
        // QNBS-v3 (#332/D3): custom item (not PredefinedMenuItem) so Quit routes through quitApp's flush — the predefined item calls the OS exit directly, bypassing onCloseRequested entirely.
        await MenuItem.new({
          id: 'tray-quit',
          text: t('desktop.tray.quit'),
          action: () => {
            void quitApp();
          },
        }),
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
 *
 * QNBS-v3 (#332/D3): when the window is actually allowed to close (minimize-to-tray off, the
 * default), `flushPendingState` is awaited first — Tauri's `onCloseRequested` supports and awaits
 * async handlers before the window closes — so the 1s debounced project/settings autosave can't be
 * silently dropped by a quit that lands mid-debounce. A rejected flush keeps the window open
 * (fail closed) instead of letting a failed save through as if it were a successful pre-close save.
 */
export async function installCloseToTray(
  shouldMinimizeToTray: () => boolean,
  flushPendingState: () => Promise<void>,
): Promise<(() => void) | null> {
  if (!desktopPlatform.runtime.isDesktop) return null;
  try {
    return await desktopPlatform.lifecycle.onCloseRequested(async (event) => {
      if (shouldMinimizeToTray()) {
        event.preventDefault();
        try {
          await desktopPlatform.window.hide();
        } catch (err) {
          log.warn('Failed to hide window for close-to-tray', { error: String(err) });
        }
        return;
      }
      try {
        await flushPendingState();
      } catch (err) {
        event.preventDefault();
        log.warn('Pre-close flush failed — keeping the window open instead of quitting', {
          error: String(err),
        });
      }
    });
  } catch (err) {
    log.warn('Failed to install close-to-tray handler', { error: String(err) });
    return null;
  }
}
