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
  backgroundWriteCoordinator,
  projectPersistenceCoordinator,
  settingsPersistenceCoordinator,
} from '../app/persistenceCoordinator';
import { logger } from './logger';
import { isTauriRuntime } from './tauriRuntime';

// QNBS-v3: mirrors public/sw.js's isWorldScriptOwnedCache/register-sw.ts's isWorldScriptOwnedCacheName — duplicated (not imported) since sw.js is a classic non-module script and register-sw.ts has its own load-time side effect.
const OWNED_CACHE_NAME_RE =
  /^worldscript-(?:static|dynamic|images)-v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const isWorldScriptOwnedCacheName = (name: string): boolean => OWNED_CACHE_NAME_RE.test(name);

// QNBS-v3: set before any wipe work starts and never cleared -- the page is reloading regardless, and a false-negative window here is exactly the race (visibilitychange-triggered flush recreating a just-deleted database) this exists to close.
let resetInProgress = false;

/** True once a factory reset has started; stays true until the reload actually happens. */
export function isFactoryResetInProgress(): boolean {
  return resetInProgress;
}

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
    // QNBS-v3: a save enqueued (project or settings autosave, or a visibility/quit flush) before this flag flipped already passed its own guard check and will run regardless -- draining all three coordinators here lets it finish before deletion starts, instead of racing it. backgroundWriteCoordinator covers the non-critical cross-project-index/DuckDB writes a project save fires off after its own enqueue() already resolved.
    await Promise.all([
      projectPersistenceCoordinator.idle(),
      settingsPersistenceCoordinator.idle(),
      backgroundWriteCoordinator.idle(),
    ]);
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
    // QNBS-v3: a failed reset never reloads, so the app keeps running -- the in-progress flag must not stay permanently on and silently block every future save.
    resetInProgress = false;
    throw error;
  }
}
