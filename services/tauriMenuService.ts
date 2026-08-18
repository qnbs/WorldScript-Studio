import { desktopPlatform } from './desktopPlatform';

// QNBS-v3 (#187): 'menu-quit' is intentionally NOT in this union — Quit is a PredefinedMenuItem
// handled natively by the OS and never emitted as a 'menu-action', so exposing it would invite
// consumers to implement unreachable handlers (API contract mismatch).
export type TauriMenuAction =
  | 'menu-export'
  | 'menu-settings'
  | 'menu-help'
  | 'menu-command-palette';

type MenuHandler = (action: TauriMenuAction) => void;

let handler: MenuHandler | null = null;
let unlisten: (() => void) | null = null;
// QNBS-v3 (CodeAnt/CodeRabbit #363): generation guard, mirroring desktopMenu.ts's menuInstallToken —
// registerTauriMenuHandler is async (onMenuAction() subscription), so an unregister (or a second,
// overlapping call) can land while a prior call is still pending. Without this, a stale completion
// could install a listener after cleanup, or two overlapping calls could both end up registered,
// double-dispatching a single menu click.
let registrationToken = 0;

/** Registers a handler for native menu events emitted from the Tauri shell. */
export async function registerTauriMenuHandler(onAction: MenuHandler): Promise<void> {
  if (!desktopPlatform.runtime.isDesktop) return;
  handler = onAction;
  if (unlisten) return;
  const myToken = ++registrationToken;
  try {
    // QNBS-v3: subscribes through desktopPlatform.menu instead of the direct @tauri-apps/api/event listen() it replaced
    const stop = await desktopPlatform.menu.onMenuAction((id) => {
      // QNBS-v3: 'menu-quit' is intentionally absent — Quit is a PredefinedMenuItem in the Rust menu,
      // handled natively by the OS (it never emits a 'menu-action' event), so forwarding it would be a
      // dead branch that misrepresents the backend contract.
      if (
        id === 'menu-export' ||
        id === 'menu-settings' ||
        id === 'menu-help' ||
        id === 'menu-command-palette'
      ) {
        handler?.(id);
      }
    });
    if (myToken !== registrationToken) {
      // A newer call (or an unregister) landed while this one was pending — discard this listener
      // rather than let a stale completion overwrite `unlisten` or leak a second live subscription.
      stop();
      return;
    }
    unlisten = stop;
  } catch {
    /* menu events unavailable */
  }
}

export function unregisterTauriMenuHandler(): void {
  handler = null;
  unlisten?.();
  unlisten = null;
  registrationToken++;
}
