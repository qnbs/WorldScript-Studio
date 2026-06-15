/** `@vitest-environment node` keeps jsdom's mocked `indexedDB` out of these tests — we use fake-indexeddb explicitly. */
// @vitest-environment node
import { indexedDB as testIdb } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_DATA_STORE,
  CODEX_STORE,
  DATA_DB_NAME,
  DB_VERSION,
  IMAGES_STORE,
  LEGACY_DB_MIGRATION_MARKER_KEY,
  LEGACY_DB_NAME,
  RAG_VECTORS_STORE,
  SNAPSHOTS_STORE,
  STATE_DB_NAME,
} from '../../services/dbConstants';
import { migrateLegacyWorldscriptDbIfNeeded } from '../../services/dbMigration';

async function deleteAllDatabases(): Promise<void> {
  if (typeof testIdb.databases !== 'function') return;
  const list = await testIdb.databases();
  for (const entry of list) {
    if (!entry.name) continue;
    await new Promise<void>((resolve, reject) => {
      const req = testIdb.deleteDatabase(entry.name!);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

function openDb(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase, event: IDBVersionChangeEvent) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = testIdb.open(name, version);
    req.onupgradeneeded = (ev) => upgrade(req.result, ev);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Legacy monolithic DB: all stores in `worldscript-db` (pre–dual-DB layout). */
async function seedLegacyDatabase(projectPayload: unknown, imageId: string, imageB64: string) {
  const legacy = await openDb(LEGACY_DB_NAME, 5, (db, ev) => {
    if (ev.oldVersion < 1 && !db.objectStoreNames.contains(APP_DATA_STORE)) {
      db.createObjectStore(APP_DATA_STORE);
    }
    if (ev.oldVersion < 2 && !db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
      db.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'id', autoIncrement: true });
    }
    if (ev.oldVersion < 3 && !db.objectStoreNames.contains(IMAGES_STORE)) {
      db.createObjectStore(IMAGES_STORE);
    }
    if (ev.oldVersion < 4 && !db.objectStoreNames.contains(RAG_VECTORS_STORE)) {
      const vs = db.createObjectStore(RAG_VECTORS_STORE, { keyPath: 'id' });
      vs.createIndex('projectId', 'projectId', { unique: false });
      vs.createIndex('type', 'type', { unique: false });
    }
  });

  await new Promise<void>((resolve, reject) => {
    const tx = legacy.transaction(APP_DATA_STORE, 'readwrite');
    tx.objectStore(APP_DATA_STORE).put(projectPayload, 'project');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  await new Promise<void>((resolve, reject) => {
    const tx = legacy.transaction(IMAGES_STORE, 'readwrite');
    tx.objectStore(IMAGES_STORE).put(imageB64, imageId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  legacy.close();
}

async function openDualDatabases(): Promise<{ stateDb: IDBDatabase; dataDb: IDBDatabase }> {
  const stateDb = await openDb(STATE_DB_NAME, DB_VERSION, (db, ev) => {
    if (ev.oldVersion < 1 && !db.objectStoreNames.contains(APP_DATA_STORE)) {
      db.createObjectStore(APP_DATA_STORE);
    }
    if (ev.oldVersion < 2 && !db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
      db.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'id', autoIncrement: true });
    }
  });

  const dataDb = await openDb(DATA_DB_NAME, DB_VERSION, (db, ev) => {
    if (ev.oldVersion < 3 && !db.objectStoreNames.contains(IMAGES_STORE)) {
      db.createObjectStore(IMAGES_STORE);
    }
    if (ev.oldVersion < 5 && !db.objectStoreNames.contains(RAG_VECTORS_STORE)) {
      const vs = db.createObjectStore(RAG_VECTORS_STORE, { keyPath: 'id' });
      vs.createIndex('projectId', 'projectId', { unique: false });
      vs.createIndex('type', 'type', { unique: false });
    }
    if (ev.oldVersion < 6 && !db.objectStoreNames.contains(CODEX_STORE)) {
      db.createObjectStore(CODEX_STORE, { keyPath: 'projectId' });
    }
  });

  return { stateDb, dataDb };
}

describe('migrateLegacyWorldscriptDbIfNeeded', () => {
  beforeEach(async () => {
    await deleteAllDatabases();
  });

  afterEach(async () => {
    await deleteAllDatabases();
    vi.restoreAllMocks();
  });

  it('copies legacy app-data and images into dual DBs once', async () => {
    const project = { present: { data: { id: 'p1', manuscript: [] } } };
    await seedLegacyDatabase(project, 'img-1', 'data:image/png;base64,xx');

    const { stateDb, dataDb } = await openDualDatabases();
    const r1 = await migrateLegacyWorldscriptDbIfNeeded(stateDb, dataDb, { idb: testIdb });
    expect(r1.migrated).toBe(true);
    expect(r1.reason).toBe('copied');

    const projectRead = await new Promise((resolve, reject) => {
      const tx = stateDb.transaction(APP_DATA_STORE, 'readonly');
      const req = tx.objectStore(APP_DATA_STORE).get('project');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(projectRead).toEqual(project);

    const imageRead = await new Promise((resolve, reject) => {
      const tx = dataDb.transaction(IMAGES_STORE, 'readonly');
      const req = tx.objectStore(IMAGES_STORE).get('img-1');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(imageRead).toBe('data:image/png;base64,xx');

    const marker = await new Promise((resolve, reject) => {
      const tx = stateDb.transaction(APP_DATA_STORE, 'readonly');
      const req = tx.objectStore(APP_DATA_STORE).get(LEGACY_DB_MIGRATION_MARKER_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(typeof marker).toBe('string');

    const r2 = await migrateLegacyWorldscriptDbIfNeeded(stateDb, dataDb, { idb: testIdb });
    expect(r2.migrated).toBe(false);
    expect(r2.reason).toBe('already_migrated');

    stateDb.close();
    dataDb.close();
  });

  it('skips when dual-DB state already has project data', async () => {
    const legacyProject = { data: { id: 'legacy' } };
    await seedLegacyDatabase(legacyProject, 'x', 'y');

    const { stateDb, dataDb } = await openDualDatabases();
    await new Promise<void>((resolve, reject) => {
      const tx = stateDb.transaction(APP_DATA_STORE, 'readwrite');
      tx.objectStore(APP_DATA_STORE).put({ id: 'existing' }, 'project');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const r = await migrateLegacyWorldscriptDbIfNeeded(stateDb, dataDb, { idb: testIdb });
    expect(r.migrated).toBe(false);
    expect(r.reason).toBe('state_has_project_data');

    const stillLegacy = await new Promise((resolve, reject) => {
      const tx = stateDb.transaction(APP_DATA_STORE, 'readonly');
      const req = tx.objectStore(APP_DATA_STORE).get('project');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(stillLegacy).toEqual({ id: 'existing' });

    stateDb.close();
    dataDb.close();
  });

  it('returns legacy_not_listed when no legacy database exists', async () => {
    const { stateDb, dataDb } = await openDualDatabases();
    const r = await migrateLegacyWorldscriptDbIfNeeded(stateDb, dataDb, { idb: testIdb });
    expect(r.migrated).toBe(false);
    expect(r.reason).toBe('legacy_not_listed');
    stateDb.close();
    dataDb.close();
  });
});
