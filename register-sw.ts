import type { RootState } from './app/store';
import { appStoreRef } from './app/storeRef';
import { flushPersistedState } from './app/persistedStateFlush';
import { logger as appLogger } from './services/logger';

// ============================================================
// WorldScript Studio — Service Worker Registration v3.0
// Features:
//   • Update detection + explicit user-triggered skipWaiting
//   • beforeinstallprompt capture  → window.worldScriptPWA
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
    worldScriptPWA: {
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
window.worldScriptPWA = {
  deferredInstallPrompt: null,
  isInstalled: false,
  swRegistration: null,

  async installApp() {
    const prompt = window.worldScriptPWA.deferredInstallPrompt;
    if (!prompt) return 'unavailable';
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    window.worldScriptPWA.deferredInstallPrompt = null;
    return outcome;
  },

  async checkForUpdate() {
    const reg = window.worldScriptPWA.swRegistration;
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
  window.worldScriptPWA.deferredInstallPrompt = e as PWAInstallEvent;
  window.dispatchEvent(new CustomEvent('sw-installable', { detail: { installable: true } }));
});

window.addEventListener('appinstalled', () => {
  window.worldScriptPWA.isInstalled = true;
  window.worldScriptPWA.deferredInstallPrompt = null;
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

// QNBS-v3: Detect the Tauri desktop runtime. Tauri injects these globals before page scripts run,
// so they are reliably present by the time `load` fires. The PWA Service Worker must NEVER run in
// the Tauri WebView: Tauri already serves all assets locally (offline-first), and a SW there
// hijacks navigations and can render "<APP_NAME> ist offline." when its cache is empty.
const isTauriEnvironment = (): boolean => {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return (
    '__TAURI_INTERNALS__' in w ||
    '__TAURI__' in w ||
    '__TAURI_METADATA__' in w ||
    (typeof navigator !== 'undefined' && / Tauri\//.test(navigator.userAgent ?? ''))
  );
};

// QNBS-v3: mirrors public/sw.js's isWorldScriptOwnedCache — duplicated since sw.js is a classic (non-module) script.
const OWNED_CACHE_NAME_RE = /^worldscript-(?:static|dynamic|images)-v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;

export const isWorldScriptOwnedCacheName = (name: string): boolean => OWNED_CACHE_NAME_RE.test(name);

// ── Core registration ─────────────────────────────────────────
const registerServiceWorker = async (): Promise<void> => {
  // QNBS-v3: In Tauri, never register — and proactively tear down any SW + caches a prior build
  // installed, so already-broken desktop installs self-heal on the first launch that boots the app.
  if (isTauriEnvironment()) {
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((reg) => reg.unregister()));
        if (typeof caches !== 'undefined') {
          const keys = await caches.keys();
          await Promise.all(
            keys.filter(isWorldScriptOwnedCacheName).map((k) => caches.delete(k)),
          );
        }
        appLogger.info(
          '[SW] Tauri runtime — service worker disabled; any prior registration removed.',
        );
      } catch (error) {
        appLogger.warn('[SW] Tauri service-worker teardown failed (non-fatal):', error);
      }
    }
    return;
  }

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

    window.worldScriptPWA.swRegistration = registration;
    appLogger.info('[SW] Registered, scope:', registration.scope);

    // ── Detect and announce SW updates ───────────────────────
    // QNBS-v3: userInitiatedUpdate removed — skipWaiting is now automatic (install event),
    // so controllerchange always reloads. The banner's applyUpdate still works for explicit UX.
    const announceUpdateAvailable = (worker: ServiceWorker) => {
      window.dispatchEvent(
        new CustomEvent('sw-update-available', {
          detail: {
            applyUpdate: () => {
              worker.postMessage({ type: 'SKIP_WAITING' });
            },
          },
        }),
      );
    };

    const onNewWorkerReady = (worker: ServiceWorker) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          announceUpdateAvailable(worker);
        }
      });
    };

    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      if (newWorker) onNewWorkerReady(newWorker);
    });

    // If a worker is already waiting (e.g. user clicked "Later" earlier),
    // surface the same toast again on next app start.
    if (registration.waiting && navigator.serviceWorker.controller) {
      announceUpdateAvailable(registration.waiting);
    }

    // QNBS-v3 (DA-02): only the visible tab flushes — a hidden tab's stale write could race a fresher one.
    let refreshing = false;
    let reloadPendingWhileHidden = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      if (document.visibilityState !== 'visible') {
        reloadPendingWhileHidden = true;
        return;
      }
      refreshing = true;
      void flushLatestStateThenReload();
    });
    document.addEventListener('visibilitychange', () => {
      if (reloadPendingWhileHidden && document.visibilityState === 'visible' && !refreshing) {
        refreshing = true;
        // QNBS-v3 (codex): no flush here — index.tsx already flushed this tab's edits when it went hidden; re-flushing now could clobber a fresher write.
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
          await registration.periodicSync.register('worldscript-refresh', {
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
      window.worldScriptPWA.isInstalled = true;
    }
  } catch (error) {
    appLogger.error('[SW] Registration failed:', error);
  }
};

// QNBS-v3 (DA-02): loops until a flush completes against state that provably hasn't changed since — a single snapshot could miss edits made while the async write was still in flight.
const MAX_FLUSH_ATTEMPTS = 5;

async function flushLatestState(): Promise<void> {
  const store = appStoreRef.current;
  if (!store) return;
  let snapshot = store.getState();
  for (let attempt = 0; attempt < MAX_FLUSH_ATTEMPTS; attempt++) {
    await flushPersistedState(snapshot as RootState);
    const latest = store.getState();
    if (latest === snapshot) return;
    snapshot = latest;
  }
  // QNBS-v3 (codex): the loop above can exhaust its budget mid-churn — one final flush of whatever's freshest right now, rather than silently dropping it.
  await flushPersistedState(store.getState() as RootState);
}

// QNBS-v3 (DA-02): the reload always proceeds — activation already pruned old-version caches by the time controllerchange fires, so staying on the old bundle risks missing-chunk failures too.
async function flushLatestStateThenReload(): Promise<void> {
  try {
    await flushLatestState();
  } catch (error) {
    appLogger.error('[SW] Pre-reload state flush failed (reloading anyway):', error);
  }
  window.location.reload();
}

if (typeof window !== 'undefined') {
  window.addEventListener('load', registerServiceWorker);
}

export { registerServiceWorker };
