import { flushPersistedState } from './app/persistedStateFlush';
import type { RootState } from './app/store';
import { appStoreRef } from './app/storeRef';
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
const OWNED_CACHE_NAME_RE =
  /^worldscript-(?:static|dynamic|images)-v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;

export const isWorldScriptOwnedCacheName = (name: string): boolean =>
  OWNED_CACHE_NAME_RE.test(name);

// QNBS-v3: a live Service Worker API snapshot cannot always tell "a registration exists because THIS is a concurrent first-ever install in progress" apart from "a registration exists because an ALREADY-ACTIVATED worker is transitioning to a newer version" — both read identically (no controller, active.state 'activating'). Only history (has a worker for this exact scope EVER reached 'activated' before) resolves that ambiguity, which a live check alone cannot see.
function priorInstallFlagKey(swUrl: string): string {
  // QNBS-v3: keyed by the exact sw.js URL, not just an origin-wide key — a shared origin (e.g. GitHub Pages) can host an unrelated app's own service worker at a different scope, and its history must never count as evidence for this app's own prior install.
  return `worldscript-sw-installed:${swUrl}`;
}

function readPriorInstallFlag(swUrl: string): boolean {
  try {
    return localStorage.getItem(priorInstallFlagKey(swUrl)) === '1';
  } catch {
    return false; // storage inaccessible (private mode etc.) — fall back to the live-API heuristic below
  }
}

function writePriorInstallFlag(swUrl: string): void {
  try {
    localStorage.setItem(priorInstallFlagKey(swUrl), '1');
  } catch {
    // non-critical — worst case, a future load falls back to the live-API heuristic again
  }
}

// QNBS-v3: extracted to keep registerServiceWorker's own cyclomatic complexity bounded — encapsulates the first-install-vs-update classification and its one-shot consumption/guard state.
function setupControllerChangeReloadHandler(swUrl: string): {
  refineFirstInstallClassification: (
    priorRegistration: ServiceWorkerRegistration | undefined,
  ) => void;
} {
  // QNBS-v3: scoped to this app's own script URL — an unrelated worker at a broader scope on a shared origin (e.g. GitHub Pages) must never be mistaken for a prior WorldScript install. Residual gap tracked separately: a second tab still loading during another tab's shared first-ever install can see this already true before this load-handler runs at all — narrow, self-healing (the persistent flag below closes it permanently after that one occurrence), not release-blocking.
  const hadOwnControllerAtLoad = navigator.serviceWorker.controller?.scriptURL === swUrl;
  const hasPersistentInstallRecord = readPriorInstallFlag(swUrl);
  // QNBS-v3: this positive live evidence must be backfilled to the persistent record now, not only once a future controllerchange happens to fire in some later session — otherwise a returning visitor who never sees an update in this session stays unrecorded, and a later force-refresh landing mid-transition (controller null, active only 'activating') would wrongly read as a first install with no history to override it.
  if (hadOwnControllerAtLoad) writePriorInstallFlag(swUrl);
  // QNBS-v3: the persistent flag alone already proves a prior install beyond any live-API ambiguity — classification is final immediately, no need to wait for (or be misled by) getRegistration()'s momentary snapshot.
  let isClassificationReady = hadOwnControllerAtLoad || hasPersistentInstallRecord;
  let isUnconsumedFirstInstallClaim = !isClassificationReady;
  // QNBS-v3: only the visible tab flushes — a hidden tab's stale write could race a fresher one (residual multi-window gap: #518).
  let refreshing = false;
  let reloadPendingWhileHidden = false;
  // QNBS-v3: a controllerchange firing before classification is ready (e.g. another tab's genuine update completing while this tab's getRegistration() is still pending) must be queued, not guessed at — guessing is exactly what produced several of the narrower races this mechanism went through.
  let pendingControllerChangeCount = 0;

  const handleControllerChange = () => {
    if (refreshing) return;
    writePriorInstallFlag(swUrl);
    // QNBS-v3: a first-ever install's activate→clients.claim() also fires controllerchange on the page that just loaded, but there is no prior version's stale bundle to reload away from — reloading here was an undocumented side effect of a check meant only for genuine updates. One-shot: a second controllerchange on this same page load is by definition a later real update superseding an already-claimed controller, so it must still reload.
    if (isUnconsumedFirstInstallClaim) {
      isUnconsumedFirstInstallClaim = false;
      appLogger.info('[SW] First-ever activation claimed this page — no reload needed.');
      return;
    }
    if (document.visibilityState !== 'visible') {
      reloadPendingWhileHidden = true;
      return;
    }
    refreshing = true;
    void flushLatestStateThenReload();
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // QNBS-v3: navigator.serviceWorker's controllerchange fires for ANY controller change on this page, including a foreign, broader-scoped worker's own claim on a shared origin — verifying the resulting controller is actually this app's own worker before queuing or handling it prevents a foreign claim from consuming the one-shot exemption or writing this app's persistent install record.
    if (navigator.serviceWorker.controller?.scriptURL !== swUrl) return;
    if (!isClassificationReady) {
      pendingControllerChangeCount++;
      return;
    }
    handleControllerChange();
  });
  document.addEventListener('visibilitychange', () => {
    if (reloadPendingWhileHidden && document.visibilityState === 'visible' && !refreshing) {
      refreshing = true;
      // QNBS-v3: no flush here — index.tsx's best-effort hide-time flush may have failed, but re-flushing risks clobbering a fresher write from another tab, the worse failure mode of the two (#518).
      window.location.reload();
    }
  });

  return {
    refineFirstInstallClassification: (priorRegistration) => {
      if (isClassificationReady) return;
      // QNBS-v3: scoped to this app's own script URL — see hadOwnControllerAtLoad's identical rationale above.
      const isOwnActivatedRegistration =
        priorRegistration?.active?.scriptURL === swUrl &&
        priorRegistration.active.state === 'activated';
      // QNBS-v3: same backfill rationale as hadOwnControllerAtLoad above — a force-refreshed returning visitor with no controllerchange due this session must not lose this positive evidence for future sessions.
      if (isOwnActivatedRegistration) writePriorInstallFlag(swUrl);
      isUnconsumedFirstInstallClaim = !isOwnActivatedRegistration;
      isClassificationReady = true;
      while (pendingControllerChangeCount > 0 && !refreshing) {
        pendingControllerChangeCount--;
        handleControllerChange();
      }
    },
  };
}

// QNBS-v3: extracted from registerServiceWorker to keep that function's own nesting flat — self-contained teardown, only ever called from the isTauriEnvironment() branch.
async function teardownServiceWorkerInTauri(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((reg) => reg.unregister()));
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.filter(isWorldScriptOwnedCacheName).map((k) => caches.delete(k)));
    }
    appLogger.info('[SW] Tauri runtime — service worker disabled; any prior registration removed.');
  } catch (error) {
    appLogger.warn('[SW] Tauri service-worker teardown failed (non-fatal):', error);
  }
}

// QNBS-v3: extracted from registerServiceWorker to keep that function's own nesting flat — userInitiatedUpdate removed since skipWaiting is now automatic (install event), so controllerchange always reloads; the banner's applyUpdate still works for explicit UX.
function setupUpdateAvailableNotifications(registration: ServiceWorkerRegistration): void {
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
}

// QNBS-v3: extracted from registerServiceWorker to keep that function's own nesting flat — self-contained, best-effort, non-critical on any failure.
async function registerPeriodicBackgroundSync(
  registration: ServiceWorkerRegistration,
): Promise<void> {
  if (!('periodicSync' in registration)) return;
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

// ── Core registration ─────────────────────────────────────────
const registerServiceWorker = async (): Promise<void> => {
  // QNBS-v3: In Tauri, never register — and proactively tear down any SW + caches a prior build
  // installed, so already-broken desktop installs self-heal on the first launch that boots the app.
  if (isTauriEnvironment()) {
    await teardownServiceWorkerInTauri();
    return;
  }

  if (!('serviceWorker' in navigator)) {
    appLogger.warn('[SW] Service Workers not supported in this browser.');
    return;
  }

  // QNBS-v3: hoisted above the try so the outer catch can still finalize classification if register() itself also fails — otherwise a compound getRegistration()+register() failure would leave it stuck pending forever, queuing every future controllerchange with nothing left to ever drain the queue.
  let refineFirstInstallClassification:
    | ((priorRegistration: ServiceWorkerRegistration | undefined) => void)
    | undefined;
  try {
    const basePath = import.meta.env.BASE_URL || '/';
    // QNBS-v3: ServiceWorker.scriptURL is always a fully resolved absolute URL per spec (e.g. https://host/path/sw.js), never a relative path — comparing it against an unresolved relative swUrl would never match in a real browser, silently breaking every returning visitor's classification. register() itself resolves a relative scriptURL internally, so passing the already-absolute form here works identically for it too.
    const swUrl = new URL(`${basePath}sw.js`, window.location.href).href;

    ({ refineFirstInstallClassification } = setupControllerChangeReloadHandler(swUrl));
    // QNBS-v3: scoped to basePath, not the document-URL default — on a shared origin, the no-arg lookup can match a broader, unrelated worker's registration instead of this app's own.
    let priorRegistration: ServiceWorkerRegistration | undefined;
    let didGetRegistrationFail = false;
    try {
      priorRegistration = await navigator.serviceWorker.getRegistration(basePath);
    } catch {
      // QNBS-v3: a lookup failure must not abort registration entirely, but finalizing classification on zero evidence here would be worse than deferring it — register() below is idempotent and returns the definitive current registration regardless, so classification is recovered from that instead once it resolves.
      didGetRegistrationFail = true;
    }
    if (!didGetRegistrationFail) {
      refineFirstInstallClassification(priorRegistration);
    }

    const registration = await navigator.serviceWorker.register(swUrl, {
      scope: basePath,
      updateViaCache: 'none', // always fetch new SW from network
    });

    if (didGetRegistrationFail) {
      // QNBS-v3: recovers classification from register()'s own result when the earlier lookup failed — an already-'activated' own worker here proves a genuine prior install exactly like a successful getRegistration() would have shown; a no-op if classification is somehow already finalized.
      refineFirstInstallClassification(registration);
    }

    window.worldScriptPWA.swRegistration = registration;
    appLogger.info('[SW] Registered, scope:', registration.scope);

    setupUpdateAvailableNotifications(registration);
    await registerPeriodicBackgroundSync(registration);

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
    // QNBS-v3: safe terminal fallback for the one path above that never finalizes classification on its own — getRegistration() rejecting AND register() rejecting. No-op (via the internal isClassificationReady guard) if classification already finalized normally before this ran.
    refineFirstInstallClassification?.(undefined);
  }
};

// QNBS-v3: loops until a flush completes against state that provably hasn't changed since — a single snapshot could miss edits made while the async write was still in flight.
const MAX_FLUSH_ATTEMPTS = 5;

// QNBS-v3: mirrors exactly what flushPersistedState reads/persists, field by field — versionControl also carries isPanelOpen (UI-only), so comparing the whole slice would retry on that too.
function persistedSlices(state: RootState) {
  return {
    project: state.project.present,
    branches: state.versionControl.branches,
    snapshots: state.versionControl.snapshots,
    currentBranchId: state.versionControl.currentBranchId,
    settings: state.settings,
  };
}

function persistedSlicesUnchanged(
  a: ReturnType<typeof persistedSlices>,
  b: ReturnType<typeof persistedSlices>,
): boolean {
  return (
    a.project === b.project &&
    a.branches === b.branches &&
    a.snapshots === b.snapshots &&
    a.currentBranchId === b.currentBranchId &&
    a.settings === b.settings
  );
}

async function flushLatestState(): Promise<void> {
  const store = appStoreRef.current;
  if (!store) return;
  let snapshot = store.getState() as RootState;
  let snapshotSlices = persistedSlices(snapshot);
  for (let attempt = 0; attempt < MAX_FLUSH_ATTEMPTS; attempt++) {
    await flushPersistedState(snapshot);
    const latest = store.getState() as RootState;
    const latestSlices = persistedSlices(latest);
    if (persistedSlicesUnchanged(snapshotSlices, latestSlices)) return;
    snapshot = latest;
    snapshotSlices = latestSlices;
  }
  // QNBS-v3: narrows but doesn't eliminate the race — a keystroke during this final await is still possible to lose (#518).
  await flushPersistedState(store.getState() as RootState);
}

// QNBS-v3: bounds the flush — an unbounded wait (e.g. queued behind another tab's exclusive Web Lock) would hang forever on an already-cache-pruned bundle, defeating the always-reload policy below.
const FLUSH_TIMEOUT_MS = 8000;

// QNBS-v3: the reload always proceeds — activation already pruned old-version caches by the time controllerchange fires, so staying on the old bundle risks missing-chunk failures too.
async function flushLatestStateThenReload(): Promise<void> {
  try {
    await Promise.race([
      flushLatestState(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Pre-reload flush timed out after ${FLUSH_TIMEOUT_MS}ms`)),
          FLUSH_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (error) {
    appLogger.error('[SW] Pre-reload state flush failed (reloading anyway):', error);
  }
  window.location.reload();
}

if (typeof window !== 'undefined') {
  window.addEventListener('load', registerServiceWorker);
}

export { registerServiceWorker };
