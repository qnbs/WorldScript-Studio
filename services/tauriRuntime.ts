/** Desktop (Tauri) runtime helpers — dynamic imports keep web bundle lean. */

export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' && Boolean((window as Window & { __TAURI__?: unknown }).__TAURI__)
  );
}

export type DesktopOs = 'windows' | 'macos' | 'linux';

/** Best-effort OS detection for the Tauri WebView, from the user-agent. Null on the web. */
export function getDesktopOs(): DesktopOs | null {
  if (!isTauriRuntime()) return null;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/windows/i.test(ua)) return 'windows';
  if (/mac/i.test(ua)) return 'macos';
  return 'linux';
}

/**
 * Tags `document.body` for desktop-scoped styling: adds `is-desktop` and `data-os` so the
 * `.is-desktop` CSS layer (index.css) can refine the desktop UI without touching the PWA.
 * Idempotent and a no-op on the web — safe to call unconditionally on mount.
 */
export function applyDesktopRuntimeFlags(): void {
  if (!isTauriRuntime() || typeof document === 'undefined') return;
  document.body.classList.add('is-desktop');
  const os = getDesktopOs();
  if (os) document.body.dataset['os'] = os;
}

export async function getTauriAppVersion(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return getVersion();
  } catch {
    return null;
  }
}

/** Opens the application data directory in the system file manager. */
export async function openTauriDataDirectory(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const { appDataDir, join } = await import('@tauri-apps/api/path');
    const { open } = await import('@tauri-apps/plugin-shell');
    const dir = await appDataDir();
    const path = await join(dir, '');
    await open(path);
    return true;
  } catch {
    return false;
  }
}
