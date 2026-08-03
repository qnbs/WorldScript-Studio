// QNBS-v3: Standalone IDB for scene revisions — avoids bumping the shared DB_VERSION in dbService.ts.
//          Max 50 revisions per scene; oldest are evicted automatically on save.
import type { SceneRevision } from '../types';
import {
  assertSecureStorageWritableForMutation,
  prepareSecureRecordPayload,
  readSecureRecordPayload,
  type SecureRecordEnvelope,
} from './storage/storageEncryptionService';

const SECURE_STORE = 'scene-revisions';

const DB_NAME = 'worldscript-revisions-db';
const DB_VERSION = 1;
const STORE = 'scene-revisions';
const MAX_PER_SCENE = 50;
const RECORD_SCHEMA_VERSION = 1;

interface SceneRevisionPayload {
  title: string;
  content: string;
  wordCount: number;
  label?: string;
  authorName?: string;
}

interface StoredSceneRevision {
  id: string;
  sectionId: string;
  createdAt: number;
  schemaVersion: typeof RECORD_SCHEMA_VERSION;
  payload: SceneRevisionPayload | SecureRecordEnvelope;
}

let _db: IDBDatabase | null = null;

async function getDb(): Promise<IDBDatabase> {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('sectionId', 'sectionId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => {
        _db?.close();
        _db = null;
      };
      resolve(_db);
    };
    req.onerror = () => reject(req.error);
  });
}

function isStoredSceneRevision(value: unknown): value is StoredSceneRevision {
  return typeof value === 'object' && value !== null && 'payload' in value;
}

function revisionPayload(revision: SceneRevision): SceneRevisionPayload {
  return {
    title: revision.title,
    content: revision.content,
    wordCount: revision.wordCount,
    ...(revision.label !== undefined && { label: revision.label }),
    ...(revision.authorName !== undefined && { authorName: revision.authorName }),
  };
}

async function encodeRevision(revision: SceneRevision): Promise<StoredSceneRevision> {
  return {
    id: revision.id,
    sectionId: revision.sectionId,
    createdAt: revision.createdAt,
    schemaVersion: RECORD_SCHEMA_VERSION,
    payload: await prepareSecureRecordPayload(revisionPayload(revision), {
      store: SECURE_STORE,
      recordId: revision.id,
    }),
  };
}

async function decodeRevision(
  stored: unknown,
): Promise<{ revision: SceneRevision; needsMigration: boolean }> {
  const recordId =
    typeof stored === 'object' && stored !== null && 'id' in stored
      ? String((stored as { id: string }).id)
      : String((stored as SceneRevision).id);
  const context = { store: SECURE_STORE, recordId };
  if (isStoredSceneRevision(stored)) {
    const decoded = await readSecureRecordPayload<SceneRevisionPayload>(stored.payload, context);
    return {
      revision: {
        id: stored.id,
        sectionId: stored.sectionId,
        createdAt: stored.createdAt,
        ...decoded.value,
      },
      needsMigration: decoded.needsMigration,
    };
  }

  const legacy = stored as SceneRevision;
  const decoded = await readSecureRecordPayload<SceneRevisionPayload>(
    revisionPayload(legacy),
    context,
  );
  return {
    revision: {
      id: legacy.id,
      sectionId: legacy.sectionId,
      createdAt: legacy.createdAt,
      ...decoded.value,
    },
    needsMigration: decoded.needsMigration,
  };
}

async function putStoredRevisions(db: IDBDatabase, records: StoredSceneRevision[]): Promise<void> {
  if (records.length === 0) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    for (const record of records) store.put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Saves a scene revision. Evicts the oldest if max is exceeded. */
export async function saveRevision(
  sectionId: string,
  snapshot: { title: string; content: string },
  label?: string,
  authorName?: string,
): Promise<SceneRevision> {
  const revision: SceneRevision = {
    id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sectionId,
    createdAt: Date.now(),
    title: snapshot.title,
    content: snapshot.content,
    wordCount: snapshot.content.split(/\s+/).filter(Boolean).length,
    ...(label !== undefined && { label }),
    ...(authorName !== undefined && { authorName }),
  };

  // QNBS-v3: Encrypt before opening the write transaction so WebCrypto cannot make it inactive.
  const stored = await encodeRevision(revision);
  const db = await getDb();
  await putStoredRevisions(db, [stored]);

  // Evict if over MAX_PER_SCENE
  const existing = await listRevisions(sectionId);
  if (existing.length > MAX_PER_SCENE) {
    const toEvict = existing.slice(MAX_PER_SCENE);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      for (const revisionToEvict of toEvict) store.delete(revisionToEvict.id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  return revision;
}

/** Returns revisions for a section, ordered newest-first. */
export async function listRevisions(sectionId: string): Promise<SceneRevision[]> {
  const db = await getDb();
  const raw = await new Promise<unknown[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const idx = tx.objectStore(STORE).index('sectionId');
    const req = idx.getAll(sectionId);
    req.onsuccess = () => resolve(req.result as unknown[]);
    req.onerror = () => reject(req.error);
  });

  const revisions: SceneRevision[] = [];
  const migrations: StoredSceneRevision[] = [];
  // QNBS-v3: Sequential crypto avoids bursty memory use when a scene has the full 50 revisions.
  for (const stored of raw) {
    const decoded = await decodeRevision(stored);
    revisions.push(decoded.revision);
    if (decoded.needsMigration) migrations.push(await encodeRevision(decoded.revision));
  }
  await putStoredRevisions(db, migrations);
  return revisions.sort((a, b) => b.createdAt - a.createdAt);
}

/** Deletes a single revision by ID. */
export async function deleteRevision(id: string): Promise<void> {
  await assertSecureStorageWritableForMutation();
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Reset the singleton (for testing). */
export function _resetDbForTest(): void {
  _db?.close();
  _db = null;
}
