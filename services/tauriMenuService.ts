import { isTauriRuntime } from './tauriRuntime';

export type TauriMenuAction = 'menu-export' | 'menu-settings' | 'menu-help' | 'menu-quit';

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
      if (
        id === 'menu-export' ||
        id === 'menu-settings' ||
        id === 'menu-help' ||
        id === 'menu-quit'
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
