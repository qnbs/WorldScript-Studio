/**
 * QNBS-v3 (T3): Bootstraps native OS notification permission when the user turns the
 * `desktop.desktopNotifications` setting on. No-op on the web; never prompts unless the setting is
 * on, so opening Settings alone never triggers an OS permission dialog.
 */

import { useEffect } from 'react';
import { useAppSelector } from '../app/hooks';
import { requestNotificationPermission } from '../services/desktop/desktopNotifications';
import { isTauriRuntime } from '../services/tauriRuntime';

export function useNativeNotifications(): void {
  const enabled = useAppSelector((s) => s.settings.desktop?.desktopNotifications ?? false);

  useEffect(() => {
    if (!isTauriRuntime() || !enabled) return;
    void requestNotificationPermission();
  }, [enabled]);
}
