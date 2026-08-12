/**
 * Bespoke migration adapter for the RAG vectors store. Unlike every other primary store, its
 * encrypted-at-rest shape collapses a whole project's chunk set into one aggregate record (see
 * idbCodexStore.ts#saveRagVectors), so migration must read/rewrite an entire project atomically —
 * not per-record like primaryProtectedStoreAdapter.ts's generic engine, which would otherwise be
 * able to observe (or even durably write) a project half-way between its individual-record and
 * aggregate-record shapes, a state getRagVectors()/saveRagVectors() never produce.
 */

import { DATA_DB_NAME, RAG_VECTORS_STORE } from '../dbConstants';
import {
  type ProtectedStoreAdapter,
  type ProtectedStoreAdapterContext,
  ProtectedStoreMigrationAdapterError,
  type ProtectedStoreMigrationBatch,
} from './protectedStoreMigration';
import { idbDecryptWithKey, idbEncryptWithKey } from './storageEncryptionService';

const ADAPTER_ID = `${DATA_DB_NAME}/${RAG_VECTORS_STORE}`;
const PROJECT_BATCH_SIZE = 5;
const AGGREGATE_ID_PREFIX = '__enc__:';

interface AggregateRecord {
  id: string;
  projectId: string;
  encrypted: number[];
  _enc: true;
}

interface DecryptedAggregate {
  projectId: string;
  vectors: unknown[];
}

function aggregateId(projectId: string): string {
  return `${AGGREGATE_ID_PREFIX}${projectId}`;
}

function isAggregateRecord(value: unknown): value is AggregateRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { _enc?: unknown })._enc === true &&
    Array.isArray((value as { encrypted?: unknown }).encrypted)
  );
}

function requireKey(key: CryptoKey | undefined, kind: 'source' | 'target'): CryptoKey {
  if (!key) {
    throw new ProtectedStoreMigrationAdapterError(
      `${ADAPTER_ID} requires a ${kind} key for the protected-store operation`,
    );
  }
  return key;
}

async function openExistingDatabase(name: string): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let created = false;
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) {
        created = true;
        request.transaction?.abort();
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (created) {
        database.close();
        resolve(null);
        return;
      }
      resolve(database);
    };
    request.onerror = () => {
      if (created) {
        resolve(null);
        return;
      }
      reject(request.error ?? new Error(`Could not open ${name}`));
    };
    request.onblocked = () => reject(new Error(`Opening ${name} is blocked by another client`));
  });
}

function withDatabase<T>(operation: (database: IDBDatabase | null) => Promise<T>): Promise<T> {
  return openExistingDatabase(DATA_DB_NAME).then(async (database) => {
    try {
      if (database && !database.objectStoreNames.contains(RAG_VECTORS_STORE)) {
        return await operation(null);
      }
      return await operation(database);
    } finally {
      database?.close();
    }
  });
}

async function listDistinctProjectIds(database: IDBDatabase): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(RAG_VECTORS_STORE, 'readonly');
    const index = transaction.objectStore(RAG_VECTORS_STORE).index('projectId');
    const ids = new Set<string>();
    const request = index.openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(Array.from(ids).sort());
        return;
      }
      if (typeof cursor.key === 'string') ids.add(cursor.key);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error(`${RAG_VECTORS_STORE} read aborted`));
  });
}

async function readProjectRecords(database: IDBDatabase, projectId: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(RAG_VECTORS_STORE, 'readonly');
    const request = transaction.objectStore(RAG_VECTORS_STORE).index('projectId').getAll(projectId);
    request.onsuccess = () => resolve(request.result as unknown[]);
    request.onerror = () => reject(request.error);
  });
}

async function writeProjectVectors(
  database: IDBDatabase,
  projectId: string,
  existingKeys: readonly IDBValidKey[],
  target: { kind: 'aggregate'; bytes: Uint8Array } | { kind: 'individual'; vectors: unknown[] },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(RAG_VECTORS_STORE, 'readwrite');
    const store = transaction.objectStore(RAG_VECTORS_STORE);
    for (const key of existingKeys) store.delete(key);
    if (target.kind === 'aggregate') {
      store.put({
        id: aggregateId(projectId),
        projectId,
        encrypted: Array.from(target.bytes),
        _enc: true,
      });
    } else {
      for (const vector of target.vectors) store.put({ ...(vector as object), projectId });
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error(`${RAG_VECTORS_STORE} write aborted`));
  });
}

async function migrateProject(
  database: IDBDatabase,
  projectId: string,
  context: ProtectedStoreAdapterContext,
): Promise<void> {
  const records = await readProjectRecords(database, projectId);
  if (records.length === 0) return;
  const existingKeys = records.map((record) => (record as { id: IDBValidKey }).id);
  const alreadyAggregate = records.length === 1 && isAggregateRecord(records[0]);

  switch (context.operation) {
    case 'enable': {
      if (alreadyAggregate) return;
      const targetKey = requireKey(context.targetKey, 'target');
      const bytes = await idbEncryptWithKey(targetKey, { projectId, vectors: records });
      await writeProjectVectors(database, projectId, existingKeys, { kind: 'aggregate', bytes });
      return;
    }
    case 'rekey': {
      const targetKey = requireKey(context.targetKey, 'target');
      if (!alreadyAggregate) {
        const bytes = await idbEncryptWithKey(targetKey, { projectId, vectors: records });
        await writeProjectVectors(database, projectId, existingKeys, { kind: 'aggregate', bytes });
        return;
      }
      const cipher = new Uint8Array((records[0] as AggregateRecord).encrypted);
      try {
        await idbDecryptWithKey(targetKey, cipher);
        // QNBS-v3: already re-encrypted with the target key by a prior interrupted rekey batch.
        return;
      } catch (targetError) {
        try {
          const sourceKey = requireKey(context.sourceKey, 'source');
          const decoded = await idbDecryptWithKey<DecryptedAggregate>(sourceKey, cipher);
          const bytes = await idbEncryptWithKey(targetKey, { projectId, vectors: decoded.vectors });
          await writeProjectVectors(database, projectId, existingKeys, {
            kind: 'aggregate',
            bytes,
          });
        } catch {
          throw targetError;
        }
      }
      return;
    }
    case 'disable': {
      if (!alreadyAggregate) return;
      const sourceKey = requireKey(context.sourceKey, 'source');
      const cipher = new Uint8Array((records[0] as AggregateRecord).encrypted);
      const decoded = await idbDecryptWithKey<DecryptedAggregate>(sourceKey, cipher);
      await writeProjectVectors(database, projectId, existingKeys, {
        kind: 'individual',
        vectors: decoded.vectors,
      });
      return;
    }
  }
}

async function verifyProject(
  database: IDBDatabase,
  projectId: string,
  context: Omit<ProtectedStoreAdapterContext, 'cursor'>,
): Promise<void> {
  const records = await readProjectRecords(database, projectId);
  if (records.length === 0) return;
  const isAggregate = records.length === 1 && isAggregateRecord(records[0]);
  if (context.operation === 'disable') {
    if (isAggregate) {
      throw new ProtectedStoreMigrationAdapterError(
        `${ADAPTER_ID} retained ciphertext after disable for project ${projectId}`,
      );
    }
    return;
  }
  if (!isAggregate) {
    throw new ProtectedStoreMigrationAdapterError(
      `${ADAPTER_ID} retained plaintext after migration for project ${projectId}`,
    );
  }
  const targetKey = requireKey(context.targetKey, 'target');
  await idbDecryptWithKey(targetKey, new Uint8Array((records[0] as AggregateRecord).encrypted));
}

/** Returns a fresh adapter instance for the RAG vectors store's per-project migration logic. */
export function getRegisteredRagVectorsProtectedStoreAdapter(): ProtectedStoreAdapter {
  return {
    id: ADAPTER_ID,
    replaySafe: true,
    async migrateNext(context): Promise<ProtectedStoreMigrationBatch> {
      return withDatabase(async (database) => {
        if (!database) return { processed: 0, complete: true };
        const allIds = await listDistinctProjectIds(database);
        const startIndex = context.cursor ? allIds.findIndex((id) => id > context.cursor!) : 0;
        if (startIndex === -1) return { processed: 0, complete: true };
        const batchIds = allIds.slice(startIndex, startIndex + PROJECT_BATCH_SIZE);
        for (const projectId of batchIds) await migrateProject(database, projectId, context);
        const complete = startIndex + batchIds.length >= allIds.length;
        const last = batchIds.at(-1);
        return { processed: batchIds.length, complete, ...(last ? { cursor: last } : {}) };
      });
    },
    async verify(context): Promise<number> {
      return withDatabase(async (database) => {
        if (!database) return 0;
        const allIds = await listDistinctProjectIds(database);
        for (const projectId of allIds) await verifyProject(database, projectId, context);
        return allIds.length;
      });
    },
  };
}
