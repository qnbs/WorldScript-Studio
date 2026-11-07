// QNBS-v3: exact, source-verified keys protect other same-origin apps from prefix-based reset deletion.
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
  'copilot.mode',
  'worldscript-idb-unlock-attempts',
  'worldscript-idb-unlock-lockout',
  'storycraft-idb-unlock-attempts',
  'storycraft-idb-unlock-lockout',
  'worldscript-hint-flow',
  'worldscript-hint-focus',
  'worldscript-hint-proforge',
  // These literal legacy keys were the only keys removed by startup database recovery.
  'worldscript_version',
  'plotBoard_zoom',
]);

const APP_OWNED_SESSION_STORAGE_KEYS = new Set([
  'worldscript-settings-category',
  'worldscript-share-target-payload',
  'collab_user',
  'pwa-install-dismissed',
]);

const APP_OWNED_LEGACY_RESET_KEYS = ['worldscript_version', 'plotBoard_zoom'] as const;

function currentAppServiceWorkerHistoryKey(): string | null {
  if (typeof window === 'undefined') return null;
  const basePath = import.meta.env.BASE_URL || '/';
  const swUrl = new URL(`${basePath}sw.js`, window.location.href).href;
  return `worldscript-sw-installed:${swUrl}`;
}

function isAppOwnedLocalStorageKey(key: string): boolean {
  return APP_OWNED_LOCAL_STORAGE_KEYS.has(key) || key === currentAppServiceWorkerHistoryKey();
}

function readStorage(storageName: 'localStorage' | 'sessionStorage'): Storage {
  const storage = Reflect.get(globalThis, storageName) as Storage | undefined;
  if (!storage) throw new Error('Browser storage is unavailable');
  // Accessing length forces restricted storage implementations to report access failures before deletion starts.
  void storage.length;
  return storage;
}

function findKeys(storage: Storage, isOwned: (key: string) => boolean): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null && isOwned(key)) keys.push(key);
  }
  return keys;
}

function removeExactKeys(storage: Storage, keys: readonly string[]): void {
  for (const key of keys) storage.removeItem(key);
  if (keys.some((key) => storage.getItem(key) !== null)) {
    throw new Error('Factory reset left an app-owned browser key behind');
  }
}

function removeOwnedKeys(storage: Storage, isOwned: (key: string) => boolean): void {
  const ownedKeys = findKeys(storage, isOwned);
  removeExactKeys(storage, ownedKeys);
  if (findKeys(storage, isOwned).length > 0) {
    throw new Error('Factory reset left app-owned browser storage behind');
  }
}

/** Verify the local storage API needed by startup recovery before its IDB deletion. */
export function assertAppOwnedLocalStorageAvailable(): void {
  try {
    readStorage('localStorage');
  } catch {
    throw new Error('Startup recovery requires accessible local storage');
  }
}

/** Verify required browser storage APIs before any Tauri or IndexedDB data deletion. */
export function assertAppOwnedWebStorageAvailable(): void {
  try {
    assertAppOwnedLocalStorageAvailable();
    readStorage('sessionStorage');
  } catch {
    throw new Error('Factory reset requires accessible browser storage');
  }
}

/** Remove only source-verified WorldScript keys after all primary data deletion succeeds. */
export function clearAppOwnedWebStorageAfterPrimaryDataDeletion(): void {
  try {
    const local = readStorage('localStorage');
    const session = readStorage('sessionStorage');
    removeOwnedKeys(local, isAppOwnedLocalStorageKey);
    removeOwnedKeys(session, (key) => APP_OWNED_SESSION_STORAGE_KEYS.has(key));
  } catch {
    throw new Error('Factory reset could not clear all app-owned browser storage');
  }
}

/** Clear the two literal migration/viewport markers only after startup IDB deletion succeeds. */
export function clearAppOwnedLegacyResetMarkersAfterPrimaryDataDeletion(): void {
  try {
    removeExactKeys(readStorage('localStorage'), APP_OWNED_LEGACY_RESET_KEYS);
  } catch {
    throw new Error('Startup recovery could not clear app-owned reset markers');
  }
}
