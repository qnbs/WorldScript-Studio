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
import { beginIdbReset, endIdbReset } from './storage/idbResetGate';
import { isTauriRuntime } from './tauriRuntime';

// QNBS-v3: mirrors public/sw.js's isWorldScriptOwnedCache/register-sw.ts's isWorldScriptOwnedCacheName — duplicated (not imported) since sw.js is a classic non-module script and register-sw.ts has its own load-time side effect.
const OWNED_CACHE_NAME_RE =
  /^worldscript-(?:static|dynamic|images)-v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const isWorldScriptOwnedCacheName = (name: string): boolean => OWNED_CACHE_NAME_RE.test(name);

// QNBS-v3: worldscript-localfirst-<projectId> (services/localFirst/docPersistence.ts) is per-project and dynamically named — it cannot be enumerated here; only indexedDB.databases() (the primary path above) ever sees it. This static list is a Safari/old-browser fallback only.
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
  'proforge-run-history',
  'worldscript-dead-letter-db',
];

async function deleteAllIndexedDBDatabases(): Promise<void> {
  // QNBS-v3: enumeration failure falls back to the known list, but a real deletion failure must propagate, not be silently retried through a different path that could mask it.
  let names: string[] | null = null;
  // Prefer the native API if available (Chrome 73+, Firefox 126+).
  if (indexedDB.databases) {
    try {
      const all = await indexedDB.databases();
      names = all.map((db) => db.name).filter((name): name is string => Boolean(name));
    } catch {
      // Fall through to known-list approach
    }
  }
  // Safari / older browsers, or a failed enumeration: delete by known name list.
  const targets = names ?? KNOWN_DB_NAMES;
  // QNBS-v3: allSettled, not all — every deletion request must be given the chance to fully settle before this resolves/rejects, so wipeAllAppData()'s catch never releases the reset gate while another deletion is still outstanding in the background.
  const results = await Promise.allSettled(targets.map(deleteDatabase));
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      failure.reason instanceof Error ? failure.reason.message : String(failure.reason),
    );
    throw new Error(
      `[factoryReset] ${failures.length} of ${targets.length} database deletion(s) failed: ${messages.join('; ')}`,
    );
  }
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    // QNBS-v3: deleting a non-existent database succeeds per spec — a real onerror means deletion is genuinely unproven, so reject rather than assume "DB may not exist" and report a fresh install that isn't.
    req.onerror = () => {
      const message = `[factoryReset] deleteDatabase(${name}) failed`;
      logger.warn(message, { error: req.error?.message });
      reject(req.error ?? new Error(message));
    };
    // QNBS-v3: a still-open connection means the database was NOT deleted — reject rather than resolve, so wipeAllAppData() never reports a "fresh install" that still has old data.
    req.onblocked = () => {
      const message = `[factoryReset] deleteDatabase(${name}) blocked by another open connection`;
      logger.warn(message);
      reject(new Error(message));
    };
  });
}

async function clearServiceWorkerCaches(): Promise<void> {
  if (!('caches' in globalThis)) return;
  try {
    const keys = await caches.keys();
    // QNBS-v3: only delete this app's own caches — a shared origin can host unrelated caches this user-triggered reset must never touch.
    await Promise.all(keys.filter(isWorldScriptOwnedCacheName).map((k) => caches.delete(k)));
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
  try {
    // QNBS-v3: awaited and can throw — beginIdbReset() fails closed on any closer failure, so a rejection here skips straight to the catch below and deletion never starts on an unproven teardown.
    await beginIdbReset();
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
  } catch (error) {
    // QNBS-v3: reload never runs on this path — release the gate so the still-live app can access IDB again.
    endIdbReset();
    throw error;
  }
}
