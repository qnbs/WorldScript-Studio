/** Desktop (Tauri) runtime helpers — dynamic imports keep web bundle lean. */

export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' && Boolean((window as Window & { __TAURI__?: unknown }).__TAURI__)
  );
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
