// QNBS-v3: this exact catalogue mirrors WorldScript web-storage writers and approved legacy keys; shared origins make broad prefix deletion unsafe.
const APP_OWNED_LOCAL_STORAGE_KEYS = new Set([
  'worldscript-state',
  'worldscript-theme',
  'worldscript-language',
  'worldscript-last-view',
  'worldscript-dashboard-onboarding-dismissed',
  'worldscript-book-preview-prefs',
  'worldscript-lora',
  'worldscript-plot-board',
  'worldscript-feature-flags',
  'storycraft-feature-flags',
  'worldscript-mind-map-ui',
  'worldscript-scene-comments',
  'worldscript-progress-tracker',
  'worldscript-palette-prefs-v1',
  'worldscript-idb-kdf-salt-v1',
  'worldscript-spotlight-tour-done',
  'worldscript-ai-telemetry',
  'worldscript-benchmarks',
  'worldscript-or-cb-state',
  'worldscript-openrouter-models',
  'worldscript-ai-leader-heartbeat',
  'worldscript-idb-unlock-attempts',
  'worldscript-idb-unlock-lockout',
  'storycraft-idb-unlock-attempts',
  'storycraft-idb-unlock-lockout',
  'worldscript-hint-flow',
  'worldscript-hint-focus',
  'worldscript-hint-proforge',
  // QNBS-v3: these two literal historical keys are covered by dbInitialization's legacy-reset fixtures; no prefix is accepted.
  'worldscript_version',
  'plotBoard_zoom',
]);

const APP_OWNED_SESSION_STORAGE_KEYS = new Set([
  'worldscript-settings-category',
  'worldscript-share-target-payload',
]);

// QNBS-v3: register-sw.ts records only the current build's exact absolute script URL, not every deployment under a WorldScript-looking prefix.
function currentAppServiceWorkerHistoryKey(): string | null {
  if (typeof window === 'undefined') return null;
  const basePath = import.meta.env.BASE_URL || '/';
  const swUrl = new URL(`${basePath}sw.js`, window.location.href).href;
  return `worldscript-sw-installed:${swUrl}`;
}

function isAppOwnedLocalStorageKey(key: string): boolean {
  return APP_OWNED_LOCAL_STORAGE_KEYS.has(key) || key === currentAppServiceWorkerHistoryKey();
}

function findOwnedKeys(storage: Storage, isOwned: (key: string) => boolean): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isOwned(key)) keys.push(key);
  }
  return keys;
}

function clearOwnedStorage(storage: Storage, isOwned: (key: string) => boolean): void {
  for (const key of findOwnedKeys(storage, isOwned)) storage.removeItem(key);
  if (findOwnedKeys(storage, isOwned).length > 0) {
    throw new Error('Factory reset left app-owned browser storage behind');
  }
}

/** Remove only keys written by WorldScript and verify the owned namespace is empty. */
export function clearAppOwnedWebStorage(): void {
  try {
    const local = Reflect.get(globalThis, 'localStorage') as Storage | undefined;
    const session = Reflect.get(globalThis, 'sessionStorage') as Storage | undefined;
    if (!local || !session) {
      throw new Error('Browser storage is unavailable');
    }
    clearOwnedStorage(local, isAppOwnedLocalStorageKey);
    clearOwnedStorage(session, (key) => APP_OWNED_SESSION_STORAGE_KEYS.has(key));
  } catch {
    throw new Error('Factory reset could not clear all app-owned browser storage');
  }
}
