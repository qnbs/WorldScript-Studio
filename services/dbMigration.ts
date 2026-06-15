import {
  APP_DATA_STORE,
  BINDER_ASSETS_STORE,
  CODEX_STORE,
  DATA_DB_NAME,
  IMAGES_STORE,
  LEGACY_DB_MIGRATION_MARKER_KEY,
  LEGACY_DB_NAME,
  RAG_VECTORS_STORE,
  SNAPSHOTS_STORE,
  STATE_DB_NAME,
} from './dbConstants';
import { logger } from './logger';

export type LegacyMigrationResult = {
  migrated: boolean;
  reason:
    | 'already_migrated'
    | 'state_has_project_data'
    | 'legacy_not_listed'
    | 'legacy_open_failed'
    | 'legacy_empty'
    | 'legacy_no_relevant_stores'
    | 'databases_api_unavailable'
    | 'invalid_target_dbs'
    | 'copied';
};

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

async function hasMigrationMarker(stateDb: IDBDatabase): Promise<boolean> {
  if (!stateDb.objectStoreNames.contains(APP_DATA_STORE)) return false;
  const tx = stateDb.transaction(APP_DATA_STORE, 'readonly');
  const store = tx.objectStore(APP_DATA_STORE);
  const val = await promisifyRequest(store.get(LEGACY_DB_MIGRATION_MARKER_KEY));
  return val != null;
}

async function stateDbHasProjectOrSettings(stateDb: IDBDatabase): Promise<boolean> {
  if (!stateDb.objectStoreNames.contains(APP_DATA_STORE)) return false;
  const tx = stateDb.transaction(APP_DATA_STORE, 'readonly');
  const store = tx.objectStore(APP_DATA_STORE);
  const [project, settings] = await Promise.all([
    promisifyRequest(store.get('project')),
    promisifyRequest(store.get('settings')),
  ]);
  return project != null || settings != null;
}

async function legacyDatabaseListed(idb: IDBFactory): Promise<boolean> {
  if (typeof idb.databases !== 'function') {
    return false;
  }
  const list = await idb.databases();
  return list.some((d) => d.name === LEGACY_DB_NAME);
}

function openLegacyDatabase(idb: IDBFactory): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const request = idb.open(LEGACY_DB_NAME);
    request.onerror = () => {
      logger.warn('Legacy DB open error:', request.error);
      resolve(null);
    };
    request.onsuccess = () => resolve(request.result);
  });
}

type KeyValue = { key: IDBValidKey; value: unknown };

async function readAllFromStore(db: IDBDatabase, storeName: string): Promise<KeyValue[]> {
  if (!db.objectStoreNames.contains(storeName)) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const out: KeyValue[] = [];
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        out.push({ key: cursor.primaryKey, value: cursor.value });
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

async function writeEntriesToStore(
  db: IDBDatabase,
  storeName: string,
  entries: KeyValue[],
): Promise<void> {
  if (entries.length === 0 || !db.objectStoreNames.contains(storeName)) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const { key, value } of entries) {
      store.put(value, key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

async function setMigrationMarker(stateDb: IDBDatabase): Promise<void> {
  const tx = stateDb.transaction(APP_DATA_STORE, 'readwrite');
  const store = tx.objectStore(APP_DATA_STORE);
  store.put(new Date().toISOString(), LEGACY_DB_MIGRATION_MARKER_KEY);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const STATE_STORES = [APP_DATA_STORE, SNAPSHOTS_STORE] as const;
const DATA_STORES = [IMAGES_STORE, RAG_VECTORS_STORE, CODEX_STORE, BINDER_ASSETS_STORE] as const;

export type MigrateLegacyOptions = {
  /** Defaults to `globalThis.indexedDB` — inject fake-indexeddb in unit tests when the runtime locks `indexedDB`. */
  idb?: IDBFactory;
};

/**
 * One-time copy from pre–dual-DB `worldscript-db` into `worldscript-state-db` / `worldscript-data-db`.
 * Idempotent: skips if marker exists, if state already holds project/settings, or if legacy is absent.
 */
export async function migrateLegacyWorldscriptDbIfNeeded(
  stateDb: IDBDatabase,
  dataDb: IDBDatabase,
  options?: MigrateLegacyOptions,
): Promise<LegacyMigrationResult> {
  const idb = options?.idb ?? globalThis.indexedDB;

  if (stateDb.name !== STATE_DB_NAME || dataDb.name !== DATA_DB_NAME) {
    logger.warn('migrateLegacyWorldscriptDbIfNeeded: unexpected DB names, skipping');
    return { migrated: false, reason: 'invalid_target_dbs' };
  }

  if (await hasMigrationMarker(stateDb)) {
    return { migrated: false, reason: 'already_migrated' };
  }

  if (await stateDbHasProjectOrSettings(stateDb)) {
    return { migrated: false, reason: 'state_has_project_data' };
  }

  if (!(await legacyDatabaseListed(idb))) {
    if (typeof idb.databases !== 'function') {
      return { migrated: false, reason: 'databases_api_unavailable' };
    }
    return { migrated: false, reason: 'legacy_not_listed' };
  }

  const legacyDb = await openLegacyDatabase(idb);
  if (!legacyDb) {
    return { migrated: false, reason: 'legacy_open_failed' };
  }

  try {
    if (legacyDb.objectStoreNames.length === 0) {
      return { migrated: false, reason: 'legacy_empty' };
    }

    const hasRelevant = [...STATE_STORES, ...DATA_STORES].some((name) =>
      legacyDb.objectStoreNames.contains(name),
    );
    if (!hasRelevant) {
      return { migrated: false, reason: 'legacy_no_relevant_stores' };
    }

    for (const storeName of STATE_STORES) {
      if (
        legacyDb.objectStoreNames.contains(storeName) &&
        stateDb.objectStoreNames.contains(storeName)
      ) {
        const rows = await readAllFromStore(legacyDb, storeName);
        await writeEntriesToStore(stateDb, storeName, rows);
      }
    }

    for (const storeName of DATA_STORES) {
      if (
        legacyDb.objectStoreNames.contains(storeName) &&
        dataDb.objectStoreNames.contains(storeName)
      ) {
        const rows = await readAllFromStore(legacyDb, storeName);
        await writeEntriesToStore(dataDb, storeName, rows);
      }
    }

    await setMigrationMarker(stateDb);
    return { migrated: true, reason: 'copied' };
  } finally {
    legacyDb.close();
  }
}
