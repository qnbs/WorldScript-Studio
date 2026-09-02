// QNBS-v3: Standalone IDB for scene revisions avoids a shared schema upgrade and keeps history bounded.
import type { SceneRevision } from '../types';
import { createLogger } from './logger';
import {
  beginIdbOpenAdmission,
  isIdbOpenStillValid,
  registerIdbConnectionCloser,
} from './storage/idbResetGate';
import { withProtectedWriteAdmission } from './storage/protectedWriteAdmission';
import {
  assertSecureStorageReadable,
  assertSecureStorageWritableForMutation,
  prepareSecureRecordPayload,
  readSecureRecordPayloadAfterLifecycleCheck,
  SecureRecordCorruptError,
  type SecureRecordEnvelope,
} from './storage/storageEncryptionService';

const DB_NAME = 'worldscript-revisions-db';
const DB_VERSION = 1;
const STORE = 'scene-revisions';
const SECURE_STORE = `${DB_NAME}/${STORE}`;
const MAX_PER_SCENE = 50;
const RECORD_SCHEMA_VERSION = 1;
const log = createLogger('sceneRevisionService');

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

let database: IDBDatabase | null = null;
let openPromise: Promise<IDBDatabase> | null = null;

// QNBS-v3: this connection is cached indefinitely across saves — a factory reset must close it or deleteDatabase(worldscript-revisions-db) blocks.
registerIdbConnectionCloser(() => {
  database?.close();
  database = null;
  // QNBS-v3: without this, a reset-time closer leaves openPromise pointing at the pending (about-to-be-invalidated) flight, so the first post-reset caller reuses it and waits on its eventual generation-mismatch rejection instead of starting a fresh open immediately.
  openPromise = null;
});

async function getDb(): Promise<IDBDatabase> {
  if (database) return database;
  if (openPromise) return openPromise;
  // QNBS-v3: rejects immediately if a reset is currently draining — the generation check alone can't catch an open that STARTS mid-reset, since it would capture the reset's own already-bumped generation.
  const openGeneration = beginIdbOpenAdmission();
  if (openGeneration === null) {
    return Promise.reject(new Error('IndexedDB reset in progress'));
  }
  // QNBS-v3: single-flight open — concurrent saves must share one connection instead of leaking one per call.
  const thisOpen: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('sectionId', 'sectionId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = () => {
      const opened = request.result;
      if (!isIdbOpenStillValid(openGeneration)) {
        opened.close();
        reject(new Error('IndexedDB reset in progress'));
        return;
      }
      database = opened;
      opened.onversionchange = () => {
        opened.close();
        database = null;
      };
      resolve(opened);
    };
    request.onerror = () => {
      reject(request.error);
    };
  });
  openPromise = thisOpen;
  // QNBS-v3: single ownership-checked cleanup for every settlement — .finally()'s callback always runs as a later microtask, so this always sees openPromise already set to thisOpen. The trailing .catch(() => {}) only prevents an unhandled-rejection warning on this DISCARDED derived chain.
  thisOpen
    .finally(() => {
      if (openPromise === thisOpen) openPromise = null;
    })
    .catch(() => {});
  return thisOpen;
}

function isStoredSceneRevision(value: unknown): value is StoredSceneRevision {
  return (
    typeof value === 'object' &&
    value !== null &&
    'payload' in value &&
    typeof (value as Partial<StoredSceneRevision>).id === 'string' &&
    typeof (value as Partial<StoredSceneRevision>).sectionId === 'string' &&
    typeof (value as Partial<StoredSceneRevision>).createdAt === 'number' &&
    (value as Partial<StoredSceneRevision>).schemaVersion === RECORD_SCHEMA_VERSION
  );
}

function isRevisionPayload(value: unknown): value is SceneRevisionPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Partial<SceneRevisionPayload>;
  return (
    typeof payload.title === 'string' &&
    typeof payload.content === 'string' &&
    typeof payload.wordCount === 'number' &&
    (payload.label === undefined || typeof payload.label === 'string') &&
    (payload.authorName === undefined || typeof payload.authorName === 'string')
  );
}

function revisionPayload(revision: SceneRevision): SceneRevisionPayload {
  return {
    title: revision.title,
    content: revision.content,
    wordCount: revision.wordCount,
    ...(revision.label !== undefined ? { label: revision.label } : {}),
    ...(revision.authorName !== undefined ? { authorName: revision.authorName } : {}),
  };
}

function contextFor(id: string) {
  return { store: SECURE_STORE, recordId: id, legacyStores: ['scene-revisions'] };
}

async function encodeRevision(revision: SceneRevision): Promise<StoredSceneRevision> {
  return {
    id: revision.id,
    sectionId: revision.sectionId,
    createdAt: revision.createdAt,
    schemaVersion: RECORD_SCHEMA_VERSION,
    payload: await prepareSecureRecordPayload(revisionPayload(revision), contextFor(revision.id)),
  };
}

function hasSupportedRevisionRoutingMetadata(
  value: unknown,
): value is Pick<SceneRevision, 'id' | 'sectionId' | 'createdAt'> {
  if (isStoredSceneRevision(value)) return true;
  if (typeof value !== 'object' || value === null || 'payload' in value) return false;
  const legacy = value as Partial<SceneRevision>;
  return (
    typeof legacy.id === 'string' &&
    typeof legacy.sectionId === 'string' &&
    typeof legacy.createdAt === 'number' &&
    isRevisionPayload(revisionPayload(legacy as SceneRevision))
  );
}

async function decodeRevision(
  stored: unknown,
  encryptionConfigured: boolean,
): Promise<SceneRevision> {
  if (isStoredSceneRevision(stored)) {
    const decoded = await readSecureRecordPayloadAfterLifecycleCheck<SceneRevisionPayload>(
      stored.payload,
      contextFor(stored.id),
      encryptionConfigured,
    );
    if (!isRevisionPayload(decoded.value)) throw new SecureRecordCorruptError();
    return {
      id: stored.id,
      sectionId: stored.sectionId,
      createdAt: stored.createdAt,
      ...decoded.value,
    };
  }

  const legacy = stored as Partial<SceneRevision>;
  if (
    typeof legacy.id !== 'string' ||
    typeof legacy.sectionId !== 'string' ||
    typeof legacy.createdAt !== 'number'
  ) {
    throw new SecureRecordCorruptError();
  }
  const decoded = await readSecureRecordPayloadAfterLifecycleCheck<SceneRevisionPayload>(
    revisionPayload(legacy as SceneRevision),
    contextFor(legacy.id),
    encryptionConfigured,
  );
  if (!isRevisionPayload(decoded.value)) throw new SecureRecordCorruptError();
  return {
    id: legacy.id,
    sectionId: legacy.sectionId,
    createdAt: legacy.createdAt,
    ...decoded.value,
  };
}

async function saveStoredRevisionWithRetention(
  db: IDBDatabase,
  revision: StoredSceneRevision,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const putRequest = store.put(revision);
    putRequest.onerror = () => reject(putRequest.error);
    // QNBS-v3: Revision routing metadata stays plaintext so retention can be atomic without decoding history.
    const listRequest = store.index('sectionId').getAll(revision.sectionId);
    listRequest.onsuccess = () => {
      const staleIds = (listRequest.result as unknown[])
        .filter(hasSupportedRevisionRoutingMetadata)
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(MAX_PER_SCENE)
        .map((storedRevision) => storedRevision.id);
      for (const id of staleIds) store.delete(id);
    };
    listRequest.onerror = () => reject(listRequest.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Revision write aborted'));
  });
}

async function deleteRevisions(db: IDBDatabase, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    for (const id of ids) store.delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Revision deletion aborted'));
  });
}

/** Saves a scene revision. Evicts the oldest only after the new durable write has committed. */
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
    ...(label !== undefined ? { label } : {}),
    ...(authorName !== undefined ? { authorName } : {}),
  };

  // QNBS-v3: shares the writer-admission lock with primary-store writes so encode-through-commit
  //          cannot straddle a migration batch and land under a superseded key/generation (#338).
  await withProtectedWriteAdmission(async () => {
    // QNBS-v3: Encrypt before IDB work so WebCrypto cannot make a write transaction inactive.
    const stored = await encodeRevision(revision);
    const db = await getDb();
    await saveStoredRevisionWithRetention(db, stored);
  });
  return revision;
}

/** Returns revisions for a section, ordered newest-first. Reads never attempt an opportunistic rewrite. */
export async function listRevisions(sectionId: string): Promise<SceneRevision[]> {
  const encryptionConfigured = await assertSecureStorageReadable();
  const db = await getDb();
  const raw = await new Promise<unknown[]>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).index('sectionId').getAll(sectionId);
    request.onsuccess = () => resolve(request.result as unknown[]);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Revision read aborted'));
  });

  const revisions: SceneRevision[] = [];
  // QNBS-v3: Sequential decryption keeps a full scene history from causing a renderer memory burst.
  for (const stored of raw) {
    try {
      revisions.push(await decodeRevision(stored, encryptionConfigured));
    } catch (error) {
      // QNBS-v3: skip one damaged revision so the rest stay readable, but still abort on a real lock-state change.
      if (error instanceof SecureRecordCorruptError) {
        log.warn('Skipping a damaged revision', { sectionId, error: String(error) });
        continue;
      }
      throw error;
    }
  }
  return revisions.sort((left, right) => right.createdAt - left.createdAt);
}

/** Deletes a single revision by ID. */
export async function deleteRevision(id: string): Promise<void> {
  // QNBS-v3: shares the writer-admission lock so this delete cannot land mid-migration-batch either.
  await withProtectedWriteAdmission(async () => {
    await assertSecureStorageWritableForMutation();
    const db = await getDb();
    await deleteRevisions(db, [id]);
  });
}

/** Reset the singleton and close its handle so tests cannot retain a stale database connection. */
export function _resetDbForTest(): void {
  database?.close();
  database = null;
  openPromise = null;
}
