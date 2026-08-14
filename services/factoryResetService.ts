/**
 * Factory Reset Service
 * Wipes all local app data — IDB databases, localStorage, and service-worker
 * caches — then reloads the page so the app starts as a clean install.
 *
 * QNBS-v3: All database names are enumerated here to stay in sync with the
 * IDB stores that each sub-service opens. Update this list whenever a new
 * IDB store is added.
 */

import { logger } from './logger';
import { isTauriRuntime } from './tauriRuntime';

/** All IDB databases the app may have created. */
const KNOWN_DB_NAMES = [
  'worldscript-db', // legacy — migrated to worldscript-data-db
  'worldscript-state-db',
  'worldscript-data-db',
  'worldscript-logs-db',
  'worldscript-revisions-db',
  'worldscript-lora-db',
  'worldscript-inference-cache-db',
  'proforge-memory-bank',
];

async function deleteAllIndexedDBDatabases(): Promise<void> {
  // Prefer the native API if available (Chrome 73+, Firefox 126+).
  if (indexedDB.databases) {
    try {
      const all = await indexedDB.databases();
      await Promise.all(all.map((db) => db.name && deleteDatabase(db.name)));
      return;
    } catch {
      // Fall through to known-list approach
    }
  }
  // Safari / older browsers: delete by known name list.
  await Promise.all(KNOWN_DB_NAMES.map(deleteDatabase));
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve(); // ignore — DB may not exist
    req.onblocked = () => resolve(); // resolve anyway; page reload will finish the job
  });
}

async function clearServiceWorkerCaches(): Promise<void> {
  if (!('caches' in globalThis)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    // Non-fatal — caches cleared on next SW registration
  }
}

async function clearTauriAppData(): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { loadTauriApis, retryFs } = await import('./fs/fsCore');
    const apis = await loadTauriApis();
    const appDataPath = await apis.appDataDir();
    if (await apis.exists(appDataPath)) {
      // QNBS-v3: keep the capability-scoped AppData root and remove only its contents.
      const entries = await retryFs(() => apis.readDir(appDataPath));
      let firstError: unknown;
      for (const name of entries
        .map((entry) => entry.name)
        .filter((entryName): entryName is string => Boolean(entryName))) {
        try {
          const childPath = await apis.join(appDataPath, name);
          await retryFs(() => apis.remove(childPath, { recursive: true }));
        } catch (error) {
          firstError ??= error;
        }
      }
      if (firstError) throw firstError;
    }
  } catch (error) {
    logger.error('Failed to clear Tauri app data during factory reset:', error);
    throw new Error('Factory reset could not clear desktop data');
  }
}

/**
 * Wipe all app data and reload.
 * Clears: IDB, localStorage, sessionStorage, SW caches.
 * After the reload the app starts as a fresh install.
 */
export async function wipeAllAppData(): Promise<void> {
  logger.warn('[factoryReset] Wiping all app data…');
  // QNBS-v3: clear fallible desktop data first so a failed desktop reset never leaves a mixed wipe.
  await clearTauriAppData();
  await deleteAllIndexedDBDatabases();
  await clearServiceWorkerCaches();
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // Private browsing may throw
  }
  // Small delay so async IDB deletions can settle before unload.
  await new Promise((r) => setTimeout(r, 300));
  window.location.reload();
}
