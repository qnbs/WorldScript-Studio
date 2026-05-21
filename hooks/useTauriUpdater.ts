import { useCallback, useEffect, useState } from 'react';
import { isTauriRuntime } from '../services/tauriRuntime';

export type TauriUpdateInfo = {
  version: string;
  currentVersion: string;
  available: boolean;
};

export function useTauriUpdater(options?: { autoCheck?: boolean }) {
  const autoCheck = options?.autoCheck ?? false;
  const [update, setUpdate] = useState<TauriUpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdate = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setChecking(true);
    setError(null);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const { getVersion } = await import('@tauri-apps/api/app');
      const currentVersion = await getVersion();
      const result = await check();
      if (result) {
        setUpdate({
          version: result.version,
          currentVersion,
          available: true,
        });
      } else {
        setUpdate({ version: currentVersion, currentVersion, available: false });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setUpdate(null);
    } finally {
      setChecking(false);
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setInstalling(true);
    setError(null);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const pending = await check();
      if (!pending) return;
      await pending.downloadAndInstall();
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  }, []);

  useEffect(() => {
    if (autoCheck && isTauriRuntime()) void checkForUpdate();
  }, [autoCheck, checkForUpdate]);

  return {
    isDesktop: isTauriRuntime(),
    update,
    checking,
    installing,
    error,
    checkForUpdate,
    installUpdate,
  };
}
