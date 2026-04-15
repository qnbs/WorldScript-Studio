import { useState, useEffect, useCallback } from 'react';

// ──────────────────────────────────────────────────────────────
// usePWA — Reactive hook for Progressive Web App state
//
// Exposes:
//   isInstallable    — beforeinstallprompt captured; can show banner
//   isInstalled      — running as installed PWA (standalone)
//   isUpdateAvailable — new SW waiting; can show update toast
//   isOffline        — navigator.onLine === false
//   installApp()     — trigger install prompt
//   dismissInstall() — hide install banner for this session
//   applyUpdate()    — reload to activate new SW version
//   dismissUpdate()  — hide update toast without reloading
//   clearCache()     — wipe all SW caches (settings nuclear option)
// ──────────────────────────────────────────────────────────────

interface UsePWAReturn {
  isInstallable: boolean;
  isInstalled: boolean;
  isUpdateAvailable: boolean;
  isOffline: boolean;
  installApp: () => Promise<void>;
  dismissInstall: () => void;
  applyUpdate: () => void;
  dismissUpdate: () => void;
  clearCache: () => Promise<void>;
}

export function usePWA(): UsePWAReturn {
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [applyUpdateFn, setApplyUpdateFn] = useState<(() => void) | null>(null);

  useEffect(() => {
    // ── Online / offline ───────────────────────────────────────
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // ── Install prompt available ───────────────────────────────
    const onInstallable = () => setIsInstallable(true);
    window.addEventListener('sw-installable', onInstallable);

    // ── App successfully installed ─────────────────────────────
    const onInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
    };
    window.addEventListener('sw-installed', onInstalled);

    // ── SW update available ────────────────────────────────────
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail as { applyUpdate: () => void };
      setApplyUpdateFn(() => detail.applyUpdate);
      setIsUpdateAvailable(true);
    };
    window.addEventListener('sw-update-available', onUpdate);

    // ── Sync initial installed state from global object ────────
    if (window.storyCraftPWA?.isInstalled) {
      setIsInstalled(true);
    }
    // Also check via matchMedia (catches already-installed before hook mounts)
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      // @ts-expect-error iOS Safari
      window.navigator.standalone === true
    ) {
      setIsInstalled(true);
    }
    if (window.storyCraftPWA?.deferredInstallPrompt) {
      setIsInstallable(true);
    }

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('sw-installable', onInstallable);
      window.removeEventListener('sw-installed', onInstalled);
      window.removeEventListener('sw-update-available', onUpdate);
    };
  }, []);

  const installApp = useCallback(async () => {
    if (!window.storyCraftPWA) return;
    const outcome = await window.storyCraftPWA.installApp();
    if (outcome === 'accepted') {
      setIsInstallable(false);
      setIsInstalled(true);
    }
  }, []);

  const dismissInstall = useCallback(() => {
    setIsInstallable(false);
    // Remember dismissal for this session
    sessionStorage.setItem('pwa-install-dismissed', '1');
  }, []);

  const applyUpdate = useCallback(() => {
    applyUpdateFn?.();
  }, [applyUpdateFn]);

  const dismissUpdate = useCallback(() => {
    setIsUpdateAvailable(false);
  }, []);

  const clearCache = useCallback(async () => {
    await window.storyCraftPWA?.clearCache();
  }, []);

  // Don't show install banner if already dismissed this session
  const installDismissed = sessionStorage.getItem('pwa-install-dismissed') === '1';

  return {
    isInstallable: isInstallable && !installDismissed && !isInstalled,
    isInstalled,
    isUpdateAvailable,
    isOffline,
    installApp,
    dismissInstall,
    applyUpdate,
    dismissUpdate,
    clearCache,
  };
}
