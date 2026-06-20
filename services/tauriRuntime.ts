/** Desktop (Tauri) runtime helpers — dynamic imports keep web bundle lean. */

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  // QNBS-v3 (T0): Tauri v2 injects `__TAURI_INTERNALS__` unconditionally; `__TAURI__` is added only
  // when `app.withGlobalTauri` is enabled (default false — and this app does not set it). Checking
  // `__TAURI__` alone made isTauriRuntime() return false inside the real desktop shell, dead-ending
  // the entire JS desktop layer (menu/updater/deep-link bridges, `is-desktop` styling). Accept
  // either global — matches the robust detection already used in register-sw.ts.
  const w = window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown };
  return Boolean(w.__TAURI_INTERNALS__) || Boolean(w.__TAURI__);
}

export type DesktopOs = 'windows' | 'macos' | 'linux';

/** Best-effort OS detection for the Tauri WebView, from the user-agent. Null on the web. */
export function getDesktopOs(): DesktopOs | null {
  if (!isTauriRuntime()) return null;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/windows/i.test(ua)) return 'windows';
  if (/mac/i.test(ua)) return 'macos';
  if (/linux|x11|cros/i.test(ua)) return 'linux';
  // QNBS-v3 (#183): unknown/empty UA — return null rather than silently defaulting to 'linux', which
  // would apply the wrong per-OS desktop CSS quirks. Callers (applyDesktopRuntimeFlags) skip null.
  return null;
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
