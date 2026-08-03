/**
 * Bulk decrypt/re-encrypt helpers for secondary IDB stores during disable/rotation.
 * QNBS-v3: Lives outside feature services so lifecycle work does not add top-level function declarations there.
 */

import { DATA_DB_NAME, DB_VERSION, PROJECTS_INDEX_STORE } from '../dbConstants';
import {
  isSecureRecordEnvelope,
  prepareSecureRecordPayloadWithKey,
  readSecureRecordPayload,
  reEncryptSecureRecordEnvelope,
  type SecureRecordEnvelope,
} from './storageEncryptionService';

const SCENE_REVISIONS_DB = 'worldscript-revisions-db';
const SCENE_REVISIONS_STORE = 'scene-revisions';
const INFERENCE_CACHE_DB = 'worldscript-inference-cache-db';
const INFERENCE_CACHE_STORE = 'inference-cache';
const PROFORGE_HISTORY_DB = 'proforge-run-history';
const PROFORGE_HISTORY_STORE = 'history';
const PROFORGE_MEMORY_DB = 'proforge-memory-bank';
const PROFORGE_MEMORY_STORE = 'entries';
const LORA_DB = 'worldscript-lora-db';
const LORA_META_STORE = 'lora-meta';
const LORA_DATASETS_STORE = 'lora-datasets';
const LORA_RUNS_STORE = 'lora-runs';

const openDb = (name: string, version = 1): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const idbGetAll = async <T>(db: IDBDatabase, storeName: string): Promise<T[]> => {
  if (!db.objectStoreNames.contains(storeName)) return [];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
};

const idbPutAll = async (db: IDBDatabase, storeName: string, records: unknown[]): Promise<void> => {
  if (records.length === 0 || !db.objectStoreNames.contains(storeName)) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    for (const record of records) store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

const reEncryptPayload = async (
  payload: unknown,
  context: { store: string; recordId: string },
  oldKey: CryptoKey,
  newKey: CryptoKey,
): Promise<SecureRecordEnvelope> =>
  isSecureRecordEnvelope(payload)
    ? reEncryptSecureRecordEnvelope(payload, context, oldKey, newKey)
    : prepareSecureRecordPayloadWithKey(payload, context, newKey);

const migrateSceneRevisionsForDisable = async (): Promise<void> => {
  const db = await openDb(SCENE_REVISIONS_DB);
  const raw = await idbGetAll<{
    id: string;
    sectionId: string;
    createdAt: number;
    schemaVersion: number;
    payload: unknown;
  }>(db, SCENE_REVISIONS_STORE);
  const plaintext = await Promise.all(
    raw.map(async (stored) => {
      const decoded = await readSecureRecordPayload<Record<string, unknown>>(stored.payload, {
        store: 'scene-revisions',
        recordId: stored.id,
      });
      return { ...stored, payload: decoded.value };
    }),
  );
  await idbPutAll(db, SCENE_REVISIONS_STORE, plaintext);
};

const reEncryptSceneRevisions = async (oldKey: CryptoKey, newKey: CryptoKey): Promise<void> => {
  const db = await openDb(SCENE_REVISIONS_DB);
  const raw = await idbGetAll<{
    id: string;
    sectionId: string;
    createdAt: number;
    schemaVersion: number;
    payload: unknown;
  }>(db, SCENE_REVISIONS_STORE);
  const migrated = await Promise.all(
    raw.map(async (stored) => ({
      ...stored,
      payload: await reEncryptPayload(
        stored.payload,
        { store: 'scene-revisions', recordId: stored.id },
        oldKey,
        newKey,
      ),
    })),
  );
  await idbPutAll(db, SCENE_REVISIONS_STORE, migrated);
};

const migrateAiInferenceCacheForDisable = async (): Promise<void> => {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb(INFERENCE_CACHE_DB);
  const raw = await idbGetAll<{
    key: string;
    timestamp: number;
    payload?: unknown;
    result?: string;
  }>(db, INFERENCE_CACHE_STORE);
  const plaintext = await Promise.all(
    raw.map(async (stored) => {
      const rawPayload =
        'payload' in stored && stored.payload !== undefined
          ? stored.payload
          : { result: stored.result };
      const decoded = await readSecureRecordPayload<{ result: string }>(rawPayload, {
        store: 'inference-cache',
        recordId: stored.key,
      });
      return {
        key: stored.key,
        timestamp: stored.timestamp,
        payload: { result: decoded.value.result },
      };
    }),
  );
  await idbPutAll(db, INFERENCE_CACHE_STORE, plaintext);
};

const reEncryptAiInferenceCache = async (oldKey: CryptoKey, newKey: CryptoKey): Promise<void> => {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb(INFERENCE_CACHE_DB);
  const raw = await idbGetAll<{ key: string; timestamp: number; payload: unknown }>(
    db,
    INFERENCE_CACHE_STORE,
  );
  const migrated = await Promise.all(
    raw.map(async (stored) => ({
      ...stored,
      payload: await reEncryptPayload(
        stored.payload,
        { store: 'inference-cache', recordId: stored.key },
        oldKey,
        newKey,
      ),
    })),
  );
  await idbPutAll(db, INFERENCE_CACHE_STORE, migrated);
};

const migrateProForgeMemoryForDisable = async (): Promise<void> => {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb(PROFORGE_MEMORY_DB);
  const raw = await idbGetAll<{
    id: string;
    projectId: string;
    category: string;
    createdAt: string;
    schemaVersion: number;
    payload: unknown;
  }>(db, PROFORGE_MEMORY_STORE);
  const plaintext = await Promise.all(
    raw.map(async (stored) => {
      const decoded = await readSecureRecordPayload<Record<string, unknown>>(stored.payload, {
        store: 'proforge-memory',
        recordId: stored.id,
      });
      return { ...stored, payload: decoded.value };
    }),
  );
  await idbPutAll(db, PROFORGE_MEMORY_STORE, plaintext);
};

const reEncryptProForgeMemory = async (oldKey: CryptoKey, newKey: CryptoKey): Promise<void> => {
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb(PROFORGE_MEMORY_DB);
  const raw = await idbGetAll<{ id: string; payload: unknown } & Record<string, unknown>>(
    db,
    PROFORGE_MEMORY_STORE,
  );
  const migrated = await Promise.all(
    raw.map(async (stored) => ({
      ...stored,
      payload: await reEncryptPayload(
        stored.payload,
        { store: 'proforge-memory', recordId: stored.id },
        oldKey,
        newKey,
      ),
    })),
  );
  await idbPutAll(db, PROFORGE_MEMORY_STORE, migrated);
};

const migrateProForgeHistoryForDisable = async (): Promise<void> => {
  const db = await openDb(PROFORGE_HISTORY_DB);
  type StoredProForgeHistory =
    | { projectId: string; schemaVersion: number; payload: unknown }
    | { projectId: string; runs: unknown[] };
  const raw = await idbGetAll<StoredProForgeHistory>(db, PROFORGE_HISTORY_STORE);
  const plaintext = await Promise.all(
    raw.map(async (stored) => {
      const rawPayload = 'payload' in stored ? stored.payload : { runs: stored.runs };
      const schemaVersion = 'schemaVersion' in stored ? stored.schemaVersion : 1;
      const decoded = await readSecureRecordPayload<{ runs: unknown[] }>(rawPayload, {
        store: 'proforge-history',
        recordId: stored.projectId,
      });
      return {
        projectId: stored.projectId,
        schemaVersion,
        payload: { runs: decoded.value.runs },
      };
    }),
  );
  await idbPutAll(db, PROFORGE_HISTORY_STORE, plaintext);
};

const reEncryptProForgeHistory = async (oldKey: CryptoKey, newKey: CryptoKey): Promise<void> => {
  const db = await openDb(PROFORGE_HISTORY_DB);
  const raw = await idbGetAll<{ projectId: string; payload: unknown } & Record<string, unknown>>(
    db,
    PROFORGE_HISTORY_STORE,
  );
  const migrated = await Promise.all(
    raw.map(async (stored) => ({
      ...stored,
      payload: await reEncryptPayload(
        stored.payload,
        { store: 'proforge-history', recordId: stored.projectId },
        oldKey,
        newKey,
      ),
    })),
  );
  await idbPutAll(db, PROFORGE_HISTORY_STORE, migrated);
};

const migrateCrossProjectIndexForDisable = async (): Promise<void> => {
  const db = await openDb(DATA_DB_NAME, DB_VERSION);
  const raw = await idbGetAll<{
    projectId: string;
    lastIndexed: number;
    schemaVersion: number;
    payload: unknown;
  }>(db, PROJECTS_INDEX_STORE);
  const plaintext = await Promise.all(
    raw.map(async (stored) => {
      const decoded = await readSecureRecordPayload<Record<string, unknown>>(stored.payload, {
        store: 'projects-index',
        recordId: stored.projectId,
      });
      return { ...stored, payload: decoded.value };
    }),
  );
  await idbPutAll(db, PROJECTS_INDEX_STORE, plaintext);
};

const reEncryptCrossProjectIndex = async (oldKey: CryptoKey, newKey: CryptoKey): Promise<void> => {
  const db = await openDb(DATA_DB_NAME, DB_VERSION);
  const raw = await idbGetAll<{
    projectId: string;
    lastIndexed: number;
    schemaVersion: number;
    payload: unknown;
  }>(db, PROJECTS_INDEX_STORE);
  const migrated = await Promise.all(
    raw.map(async (stored) => ({
      ...stored,
      payload: await reEncryptPayload(
        stored.payload,
        { store: 'projects-index', recordId: stored.projectId },
        oldKey,
        newKey,
      ),
    })),
  );
  await idbPutAll(db, PROJECTS_INDEX_STORE, migrated);
};

const reEncryptLoraStore = async (
  storeName: string,
  secureStore: string,
  oldKey: CryptoKey,
  newKey: CryptoKey,
): Promise<void> => {
  const db = await openDb(LORA_DB);
  const raw = await idbGetAll<{ id: string; payload: unknown } & Record<string, unknown>>(
    db,
    storeName,
  );
  const migrated = await Promise.all(
    raw.map(async (stored) => ({
      ...stored,
      payload: await reEncryptPayload(
        stored.payload,
        { store: secureStore, recordId: stored.id },
        oldKey,
        newKey,
      ),
    })),
  );
  await idbPutAll(db, storeName, migrated);
};

const migrateLoraStoreForDisable = async (
  storeName: string,
  secureStore: string,
): Promise<void> => {
  const db = await openDb(LORA_DB);
  const raw = await idbGetAll<{ id: string; payload: unknown } & Record<string, unknown>>(
    db,
    storeName,
  );
  const plaintext = await Promise.all(
    raw.map(async (stored) => {
      const decoded = await readSecureRecordPayload<Record<string, unknown>>(stored.payload, {
        store: secureStore,
        recordId: stored.id,
      });
      return { ...stored, payload: decoded.value };
    }),
  );
  await idbPutAll(db, storeName, plaintext);
};

const migrateLoraStoresForDisable = async (): Promise<void> => {
  await migrateLoraStoreForDisable(LORA_META_STORE, 'lora-adapter-meta');
  await migrateLoraStoreForDisable(LORA_DATASETS_STORE, 'lora-dataset');
  await migrateLoraStoreForDisable(LORA_RUNS_STORE, 'lora-training-run');
};

const reEncryptLoraStores = async (oldKey: CryptoKey, newKey: CryptoKey): Promise<void> => {
  await reEncryptLoraStore(LORA_META_STORE, 'lora-adapter-meta', oldKey, newKey);
  await reEncryptLoraStore(LORA_DATASETS_STORE, 'lora-dataset', oldKey, newKey);
  await reEncryptLoraStore(LORA_RUNS_STORE, 'lora-training-run', oldKey, newKey);
};

export const decryptAllSecondaryStoresToPlaintext = async (): Promise<void> => {
  await migrateSceneRevisionsForDisable();
  await migrateAiInferenceCacheForDisable();
  await migrateProForgeMemoryForDisable();
  await migrateProForgeHistoryForDisable();
  await migrateCrossProjectIndexForDisable();
  await migrateLoraStoresForDisable();
};

export const reEncryptAllSecondaryStores = async (
  oldKey: CryptoKey,
  newKey: CryptoKey,
): Promise<void> => {
  await reEncryptSceneRevisions(oldKey, newKey);
  await reEncryptAiInferenceCache(oldKey, newKey);
  await reEncryptProForgeMemory(oldKey, newKey);
  await reEncryptProForgeHistory(oldKey, newKey);
  await reEncryptCrossProjectIndex(oldKey, newKey);
  await reEncryptLoraStores(oldKey, newKey);
};
