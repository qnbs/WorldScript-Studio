// QNBS-v3: this exact catalogue mirrors web-storage writers; shared origins make broad prefix deletion unsafe.
export const APP_OWNED_LOCAL_STORAGE_KEYS = [
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
  'debugRedux',
  'debug',
  'worldscript-idb-unlock-attempts',
  'worldscript-idb-unlock-lockout',
  'storycraft-idb-unlock-attempts',
  'storycraft-idb-unlock-lockout',
  'worldscript-hint-flow',
  'worldscript-hint-focus',
  'worldscript-hint-proforge',
] as const;

export const APP_OWNED_SESSION_STORAGE_KEYS = [
  'pwa-install-dismissed',
  'collab_user',
  'worldscript-settings-category',
  'worldscript-share-target-payload',
] as const;

// QNBS-v3: register-sw.ts stores history under this URL-keyed family, not a generic worldscript-* prefix.
const SERVICE_WORKER_HISTORY_PREFIX = 'worldscript-sw-installed:';

export function isAppOwnedLocalStorageKey(key: string): boolean {
  return (
    (APP_OWNED_LOCAL_STORAGE_KEYS as readonly string[]).includes(key) ||
    key.startsWith(SERVICE_WORKER_HISTORY_PREFIX)
  );
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
    const ownedSessionKeys = new Set<string>(APP_OWNED_SESSION_STORAGE_KEYS);
    clearOwnedStorage(session, (key) => ownedSessionKeys.has(key));
  } catch {
    throw new Error('Factory reset could not clear all app-owned browser storage');
  }
}
