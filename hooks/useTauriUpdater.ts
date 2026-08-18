import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppSelector } from '../app/hooks';
import { sendDesktopNotification } from '../services/desktop/desktopNotifications';
import { desktopPlatform } from '../services/desktopPlatform';
import { isTauriRuntime } from '../services/tauriRuntime';
import { useTranslation } from './useTranslation';

export type TauriUpdateInfo = {
  version: string;
  currentVersion: string;
  available: boolean;
};

export function useTauriUpdater(options?: { autoCheck?: boolean }) {
  const autoCheck = options?.autoCheck ?? false;
  const { t } = useTranslation();
  // QNBS-v3: read via a ref so translation-bundle reloads don't change checkForUpdate's identity and retrigger the autoCheck mount effect.
  const tRef = useRef(t);
  // QNBS-v3: sync in an effect, not during render, so a discarded render can't leak a stale translator into the ref.
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  // QNBS-v3 (T3): gate the "update ready" native notification behind the opt-in desktop setting.
  const desktopNotificationsEnabled = useAppSelector(
    (state) => state.settings.desktop?.desktopNotifications ?? false,
  );
  const [update, setUpdate] = useState<TauriUpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // QNBS-v3: last version a notification was sent for, so repeated checks don't re-notify.
  const lastNotifiedVersionRef = useRef<string | null>(null);

  const checkForUpdate = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setChecking(true);
    setError(null);
    try {
      // QNBS-v3: routes through desktopPlatform.updater instead of the direct @tauri-apps/plugin-updater/api-app imports it replaced
      const currentVersion = (await desktopPlatform.updater.getAppVersion()) ?? '';
      const result = await desktopPlatform.updater.check();
      if (result) {
        setUpdate({
          version: result.version,
          currentVersion,
          available: true,
        });
        if (desktopNotificationsEnabled && lastNotifiedVersionRef.current !== result.version) {
          // QNBS-v3: gate and deduplicate localized update-ready notifications.
          await sendDesktopNotification(
            tRef.current('desktop.notify.updateReadyTitle'),
            tRef.current('desktop.notify.updateReadyBody', { version: result.version }),
          );
          lastNotifiedVersionRef.current = result.version;
        }
      } else {
        setUpdate({ version: currentVersion, currentVersion, available: false });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setUpdate(null);
    } finally {
      setChecking(false);
    }
    // QNBS-v3: re-check notification-dedup state when the notification preference changes.
  }, [desktopNotificationsEnabled]);

  const installUpdate = useCallback(async () => {
    if (!isTauriRuntime()) return;
    setInstalling(true);
    setError(null);
    try {
      const pending = await desktopPlatform.updater.check();
      if (!pending) return;
      await pending.downloadAndInstall();
      await desktopPlatform.updater.relaunch();
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
