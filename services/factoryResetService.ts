/**
 * Factory Reset Service
 * Wipes all local app data — IDB databases, localStorage, and service-worker
 * caches — then reloads the page so the app starts as a clean install.
 *
 * QNBS-v3: All database names are enumerated here to stay in sync with the
 * IDB stores that each sub-service opens. Update this list whenever a new
 * IDB store is added.
 */

import {
  crossProjectIndexCoordinator,
  duckDbWriteCoordinator,
  projectPersistenceCoordinator,
  settingsPersistenceCoordinator,
} from '../app/persistenceCoordinator';
import { logger } from './logger';
import { beginIdbReset, endIdbReset } from './storage/idbResetGate';
import { isTauriRuntime } from './tauriRuntime';

// QNBS-v3: mirrors public/sw.js's isWorldScriptOwnedCache/register-sw.ts's isWorldScriptOwnedCacheName — duplicated (not imported) since sw.js is a classic non-module script and register-sw.ts has its own load-time side effect.
const OWNED_CACHE_NAME_RE =
  /^worldscript-(?:static|dynamic|images)-v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const isWorldScriptOwnedCacheName = (name: string): boolean => OWNED_CACHE_NAME_RE.test(name);

// QNBS-v3 (cubic/coderabbit): onblocked only means deletion is waiting on another open connection -- the same request can still reach a real onsuccess/onerror once that connection closes. This bounds how long deleteDatabase() waits before giving up and reporting the block as a genuine failure.
const DELETE_BLOCKED_TIMEOUT_MS = 3000;

// QNBS-v3: set before any wipe work starts and never cleared -- the page is reloading regardless, and a false-negative window here is exactly the race (visibilitychange-triggered flush recreating a just-deleted database) this exists to close.
let resetInProgress = false;

/** True once a factory reset has started; stays true until the reload actually happens. */
export function isFactoryResetInProgress(): boolean {
  return resetInProgress;
}

// QNBS-v3: worldscript-localfirst-<projectId> (services/localFirst/docPersistence.ts) is per-project and dynamically named — it cannot be enumerated here; only indexedDB.databases() (the primary path above) ever sees it. This static list is a Safari/old-browser fallback only.
/** All IDB databases the app may have created under a fixed, exact name. */
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

// QNBS-v3: the only prefix-based (non-exact) WorldScript-owned IDB name — services/localFirst/docPersistence.ts's per-project shadow store, dynamically named per projectId, so it can never appear in KNOWN_DB_NAMES.
const LOCAL_FIRST_DB_PREFIX = 'worldscript-localfirst-';

// QNBS-v3: a shared origin can host databases from an unrelated app/tool — indexedDB.databases() enumerates everything on the origin, so a real deletion target must be proven app-owned, never assumed just because enumeration returned it.
function isWorldScriptOwnedDatabaseName(name: string): boolean {
  return KNOWN_DB_NAMES.includes(name) || name.startsWith(LOCAL_FIRST_DB_PREFIX);
}

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
  // Safari / older browsers, or a failed enumeration: delete by known name list (already exact-owned, no filter needed). A successful native enumeration must still be filtered — it can see a foreign database on this origin.
  const targets = names ? names.filter(isWorldScriptOwnedDatabaseName) : KNOWN_DB_NAMES;
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
    let blockedTimeout: ReturnType<typeof setTimeout> | null = null;
    const settle = (run: () => void) => {
      if (blockedTimeout) clearTimeout(blockedTimeout);
      run();
    };
    req.onsuccess = () => settle(resolve);
    // QNBS-v3: deleting a non-existent database succeeds per spec — a real onerror means deletion is genuinely unproven, so reject rather than assume "DB may not exist" and report a fresh install that isn't.
    req.onerror = () => {
      const message = `[factoryReset] deleteDatabase(${name}) failed`;
      logger.warn(message, { error: req.error?.message });
      settle(() => reject(req.error ?? new Error(message)));
    };
    // QNBS-v3 (cubic/coderabbit): onblocked alone doesn't mean the request failed -- the SAME request can still reach onsuccess once the other connection closes. Rejecting here immediately previously settled the promise before the actual deletion outcome was known, letting wipeAllAppData() release the reset gate while the deletion was still asynchronously pending. Log and wait for the real terminal event; only give up once the block has genuinely outlasted a reasonable window.
    req.onblocked = () => {
      logger.warn(
        `[factoryReset] deleteDatabase(${name}) blocked by another open connection — waiting for it to close`,
      );
      blockedTimeout = setTimeout(() => {
        const message = `[factoryReset] deleteDatabase(${name}) still blocked after ${DELETE_BLOCKED_TIMEOUT_MS}ms`;
        logger.warn(message);
        reject(new Error(message));
      }, DELETE_BLOCKED_TIMEOUT_MS);
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

// QNBS-v3: readInitialView() reads via URLSearchParams.get('view'), which decodes -- comparing the raw key would let an encoded spelling like %76iew survive this filter and still restore Settings after reload.
function isViewKey(rawKey: string): boolean {
  if (rawKey === 'view') return true;
  try {
    return decodeURIComponent(rawKey.replace(/\+/g, ' ')) === 'view';
  } catch {
    return false;
  }
}

// QNBS-v3: string-level removal, not URLSearchParams.delete() -- reserializing via searchParams.toString() would reserialize every retained parameter too, e.g. turning a raw %20 into + or a bare flag `?foo` into `?foo=`, silently rewriting unrelated URL state this reset has no business touching.
function stripViewQueryParam(rawSearch: string): string {
  if (!rawSearch || rawSearch === '?') return '';
  const pairs = rawSearch
    .slice(1)
    .split('&')
    .filter((pair) => {
      const eq = pair.indexOf('=');
      const key = eq === -1 ? pair : pair.slice(0, eq);
      return !isViewKey(key);
    });
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

// QNBS-v3: the deep-link hash and `view` query param both survive a bare window.location.reload(), and useApp.ts's readInitialView() reads them before checking whether a project even exists -- without this, a reset triggered from Settings reboots straight back into Settings.
function sanitizeViewCarryingUrlState(): void {
  try {
    const url = new URL(window.location.href);
    history.replaceState(null, '', `${url.pathname}${stripViewQueryParam(url.search)}`);
  } catch {
    // Never let URL sanitization block the reset itself.
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
  resetInProgress = true;
  try {
    // QNBS-v3: a save enqueued (project or settings autosave, or a visibility/quit flush) before this flag flipped already passed its own guard check and will run regardless -- draining all four coordinators here lets it finish before deletion starts, instead of racing it. The last two cover the non-critical cross-project-index/DuckDB writes a project save fires off after its own enqueue() already resolved.
    await Promise.all([
      projectPersistenceCoordinator.idle(),
      settingsPersistenceCoordinator.idle(),
      crossProjectIndexCoordinator.idle(),
      duckDbWriteCoordinator.idle(),
    ]);
    // QNBS-v3: only after those four have genuinely drained -- beginIdbReset() force-closes every other long-lived IDB connection (9 modules), which must not happen while one of the four above is still mid-write. Awaited and can throw: it fails closed on any closer failure, so a rejection here skips straight to the catch below and deletion never starts on an unproven teardown.
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
    sanitizeViewCarryingUrlState();
    window.location.reload();
  } catch (error) {
    // QNBS-v3: a failed reset never reloads, so the app keeps running -- both gates must release (endIdbReset() unconditionally, since beginIdbReset() can leave its own internal state marked in-progress even when it itself is what rejected), or every future save/open would stay silently blocked.
    resetInProgress = false;
    endIdbReset();
    throw error;
  }
}
