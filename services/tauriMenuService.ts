import { isTauriRuntime } from './tauriRuntime';

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

/** Registers a handler for native menu events emitted from the Tauri shell. */
export async function registerTauriMenuHandler(onAction: MenuHandler): Promise<void> {
  if (!isTauriRuntime()) return;
  handler = onAction;
  if (unlisten) return;
  try {
    const { listen } = await import('@tauri-apps/api/event');
    const stop = await listen<string>('menu-action', (event) => {
      const id = event.payload;
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
    unlisten = stop;
  } catch {
    /* menu events unavailable */
  }
}

export function unregisterTauriMenuHandler(): void {
  handler = null;
  unlisten?.();
  unlisten = null;
}
