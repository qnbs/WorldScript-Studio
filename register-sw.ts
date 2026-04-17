import { logger as appLogger } from './services/logger';

// ============================================================
// StoryCraft Studio — Service Worker Registration v3.0
// Features:
//   • Update detection + postMessage → skipWaiting
//   • beforeinstallprompt capture  → window.storyCraftPWA
//   • appinstalled tracking
//   • Periodic background sync registration
//   • Custom events: sw-update-available, sw-installed
// ============================================================

export interface PWAInstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    storyCraftPWA: {
      deferredInstallPrompt: PWAInstallEvent | null;
      isInstalled: boolean;
      swRegistration: ServiceWorkerRegistration | null;
      installApp: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
      checkForUpdate: () => Promise<void>;
      clearCache: () => Promise<void>;
      getSWVersion: () => void;
    };
  }
}

// ── Global PWA state object ───────────────────────────────────
window.storyCraftPWA = {
  deferredInstallPrompt: null,
  isInstalled: false,
  swRegistration: null,

  async installApp() {
    const prompt = window.storyCraftPWA.deferredInstallPrompt;
    if (!prompt) return 'unavailable';
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    window.storyCraftPWA.deferredInstallPrompt = null;
    return outcome;
  },

  async checkForUpdate() {
    const reg = window.storyCraftPWA.swRegistration;
    if (reg) await reg.update();
  },

  async clearCache() {
    const controller = navigator.serviceWorker.controller;
    if (controller) controller.postMessage({ type: 'CLEAR_CACHE' });
  },

  getSWVersion() {
    const controller = navigator.serviceWorker.controller;
    if (controller) controller.postMessage({ type: 'GET_VERSION' });
  },
};

// ── Capture install prompt before browser auto-dismisses it ──
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.storyCraftPWA.deferredInstallPrompt = e as PWAInstallEvent;
  window.dispatchEvent(new CustomEvent('sw-installable', { detail: { installable: true } }));
});

window.addEventListener('appinstalled', () => {
  window.storyCraftPWA.isInstalled = true;
  window.storyCraftPWA.deferredInstallPrompt = null;
  window.dispatchEvent(new CustomEvent('sw-installed'));
  appLogger.info('[PWA] App installed successfully');
});

navigator.serviceWorker?.addEventListener('message', (event: MessageEvent) => {
  const { type } = event.data || {};
  if (type === 'CACHE_CLEARED') {
    window.dispatchEvent(new CustomEvent('sw-cache-cleared'));
  }
  if (type === 'SW_VERSION') {
    window.dispatchEvent(new CustomEvent('sw-version', { detail: event.data }));
  }
  if (type === 'TRIGGER_AUTOSAVE') {
    window.dispatchEvent(new CustomEvent('sw-trigger-autosave'));
  }
});

// ── Core registration ─────────────────────────────────────────
const registerServiceWorker = async (): Promise<void> => {
  if (!('serviceWorker' in navigator)) {
    appLogger.warn('[SW] Service Workers not supported in this browser.');
    return;
  }

  try {
    const basePath = import.meta.env.BASE_URL || '/';
    const swUrl = `${basePath}sw.js`;

    const registration = await navigator.serviceWorker.register(swUrl, {
      scope: basePath,
      updateViaCache: 'none', // always fetch new SW from network
    });

    window.storyCraftPWA.swRegistration = registration;
    appLogger.info('[SW] Registered, scope:', registration.scope);

    // ── Detect and announce SW updates ───────────────────────
    const onNewWorkerReady = (worker: ServiceWorker) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          window.dispatchEvent(
            new CustomEvent('sw-update-available', {
              detail: {
                applyUpdate: () => {
                  worker.postMessage({ type: 'SKIP_WAITING' });
                  window.location.reload();
                },
              },
            }),
          );
        }
      });
    };

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (newWorker) onNewWorkerReady(newWorker);
    });

    // Handle SW controller change (after skipWaiting)
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });

    // ── Periodic background sync ──────────────────────────────
    if ('periodicSync' in registration) {
      try {
        const status = await navigator.permissions.query({
          // @ts-expect-error — periodicSync not in TS lib yet
          name: 'periodic-background-sync',
        });
        if (status.state === 'granted') {
          // @ts-expect-error — periodicSync not in TS lib yet
          await registration.periodicSync.register('storycraft-refresh', {
            minInterval: 24 * 60 * 60 * 1000, // once per day
          });
        }
      } catch {
        // Periodic sync not available; non-critical
      }
    }

    // ── Detect standalone / installed mode ────────────────────
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      // @ts-expect-error — iOS Safari proprietary
      window.navigator.standalone === true
    ) {
      window.storyCraftPWA.isInstalled = true;
    }
  } catch (error) {
    appLogger.error('[SW] Registration failed:', error);
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('load', registerServiceWorker);
}

export { registerServiceWorker };
