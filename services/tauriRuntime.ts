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
