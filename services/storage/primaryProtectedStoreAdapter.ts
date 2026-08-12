/**
 * Concrete IndexedDB adapter factory for primary stores whose protected content is the entire
 * stored value (an `EncryptedBlob` via idbEncryptWithKey/idbDecryptWithKey), not a nested
 * AAD-bound envelope. QNBS-v3: mirrors secondaryPayloadStoreAdapter.ts's batch/optimistic-write
 * protocol, but keyed by the raw IDB cursor key (which may or may not also be embedded in the
 * value via a keyPath) rather than by a fixed record-id field.
 */

import {
  type ProtectedStoreAdapter,
  type ProtectedStoreAdapterContext,
  ProtectedStoreMigrationAdapterError,
  type ProtectedStoreMigrationBatch,
} from './protectedStoreMigration';

const DEFAULT_BATCH_SIZE = 25;

/** Sentinel meaning "record already reflects the target state — do not rewrite it". */
export const NO_CHANGE: unique symbol = Symbol('primary-protected-store-adapter-no-change');

export interface PrimaryProtectedStoreAdapterSpec {
  id: string;
  databaseName: string;
  storeName: string;
  /** 'inline' stores derive their key from a keyPath on the value (store.put(value)); 'explicit' stores pass the key separately (store.put(value, key)). */
  keyMode: 'inline' | 'explicit';
  /** Native IDB key type — needed to build a valid IDBKeyRange lower bound from the journal's string cursor. */
  keyType: 'string' | 'number';
  /** Keys this adapter must never read or write (e.g. the migration journal record, the passphrase sentinel). */
  reservedKeys?: readonly IDBValidKey[];
  /** Returns the new value to persist, or NO_CHANGE if the record already reflects the target state. */
  transform(
    key: IDBValidKey,
    value: unknown,
    context: ProtectedStoreAdapterContext,
  ): Promise<unknown | typeof NO_CHANGE>;
  /** Throws if the record is not in the expected post-migration state. */
  verifyValue(
    key: IDBValidKey,
    value: unknown,
    context: Omit<ProtectedStoreAdapterContext, 'cursor'>,
  ): Promise<void>;
  batchSize?: number;
}

interface KeyedRecord {
  key: IDBValidKey;
  value: unknown;
}

interface Batch {
  records: KeyedRecord[];
  complete: boolean;
}

interface PendingWrite {
  key: IDBValidKey;
  original: unknown;
  replacement: unknown;
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
        // QNBS-v3: Abort an accidental open of a store that does not exist yet rather than leaving an empty database behind.
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

function isReservedKey(spec: PrimaryProtectedStoreAdapterSpec, key: IDBValidKey): boolean {
  return (spec.reservedKeys ?? []).some((reserved) => reserved === key);
}

function decodeCursorLowerBound(
  spec: PrimaryProtectedStoreAdapterSpec,
  cursor: string,
): IDBValidKey {
  return spec.keyType === 'number' ? Number(cursor) : cursor;
}

function encodeCursor(key: IDBValidKey): string {
  return String(key);
}

function putValue(
  store: IDBObjectStore,
  spec: PrimaryProtectedStoreAdapterSpec,
  key: IDBValidKey,
  value: unknown,
): IDBRequest {
  return spec.keyMode === 'explicit' ? store.put(value, key) : store.put(value);
}

function valuesMatch(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return left.length === right.length && left.every((byte, index) => byte === right[index]);
  }
  if (left instanceof Blob && right instanceof Blob) {
    return left.size === right.size && left.type === right.type;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length && left.every((value, index) => valuesMatch(value, right[index]))
    );
  }
  if (
    typeof left !== 'object' ||
    left === null ||
    typeof right !== 'object' ||
    right === null ||
    Object.getPrototypeOf(left) !== Object.prototype ||
    Object.getPrototypeOf(right) !== Object.prototype
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && valuesMatch(leftRecord[key], rightRecord[key]),
    )
  );
}

async function readBatch(
  database: IDBDatabase,
  spec: PrimaryProtectedStoreAdapterSpec,
  cursorParam: string | undefined,
  batchSize: number,
): Promise<Batch> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(spec.storeName, 'readonly');
    const store = transaction.objectStore(spec.storeName);
    const range =
      cursorParam !== undefined
        ? IDBKeyRange.lowerBound(decodeCursorLowerBound(spec, cursorParam), true)
        : undefined;
    const request = store.openCursor(range);
    const records: KeyedRecord[] = [];
    request.onsuccess = () => {
      const result = request.result;
      if (!result) {
        resolve({ records, complete: true });
        return;
      }
      if (!isReservedKey(spec, result.key)) {
        records.push({ key: result.key, value: result.value });
        if (records.length >= batchSize) {
          resolve({ records, complete: false });
          return;
        }
      }
      result.continue();
    };
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error(`${spec.storeName} read aborted`));
  });
}

async function writeBatch(
  database: IDBDatabase,
  spec: PrimaryProtectedStoreAdapterSpec,
  writes: readonly PendingWrite[],
): Promise<void> {
  if (writes.length === 0) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(spec.storeName, 'readwrite');
    const store = transaction.objectStore(spec.storeName);
    let failure: Error | undefined;
    let aborting = false;
    const abortForFailure = (error: Error) => {
      failure = error;
      if (aborting) return;
      aborting = true;
      try {
        transaction.abort();
      } catch {
        // QNBS-v3: the request error already aborted the transaction; onabort still reports `failure`.
      }
    };
    for (const write of writes) {
      const request = store.get(write.key);
      request.onsuccess = () => {
        if (!valuesMatch(request.result, write.original)) {
          abortForFailure(
            new ProtectedStoreMigrationAdapterError(
              `Protected-store migration detected a concurrent update in ${spec.id}/${encodeCursor(write.key)}`,
            ),
          );
          return;
        }
        const putRequest = putValue(store, spec, write.key, write.replacement);
        putRequest.onerror = () =>
          abortForFailure(putRequest.error ?? new Error(`${spec.storeName} write failed`));
      };
      request.onerror = () =>
        abortForFailure(request.error ?? new Error(`${spec.storeName} read failed`));
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(failure ?? transaction.error ?? new Error(`${spec.storeName} write aborted`));
  });
}

async function verifyRecord(
  spec: PrimaryProtectedStoreAdapterSpec,
  record: KeyedRecord,
  context: Omit<ProtectedStoreAdapterContext, 'cursor'>,
): Promise<void> {
  await spec.verifyValue(record.key, record.value, context);
}

/** Build an idempotent adapter for a store whose encrypted content is the entire stored value. */
export function createPrimaryProtectedStoreAdapter(
  spec: PrimaryProtectedStoreAdapterSpec,
): ProtectedStoreAdapter {
  const batchSize = spec.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new ProtectedStoreMigrationAdapterError(`${spec.id} has an invalid batch size`);
  }

  async function withDatabase<T>(
    operation: (database: IDBDatabase | null) => Promise<T>,
  ): Promise<T> {
    const database = await openExistingDatabase(spec.databaseName);
    try {
      if (database && !database.objectStoreNames.contains(spec.storeName))
        return await operation(null);
      return await operation(database);
    } finally {
      database?.close();
    }
  }

  return {
    id: spec.id,
    // QNBS-v3: rekey/disable probe the target/source key before writing, so a batch committed before its journal checkpoint can be replayed safely.
    replaySafe: true,
    async migrateNext(context): Promise<ProtectedStoreMigrationBatch> {
      return withDatabase(async (database) => {
        if (!database) return { processed: 0, complete: true };
        const batch = await readBatch(database, spec, context.cursor, batchSize);
        const writes: PendingWrite[] = [];
        for (const record of batch.records) {
          const next = await spec.transform(record.key, record.value, context);
          if (next !== NO_CHANGE) {
            writes.push({ key: record.key, original: record.value, replacement: next });
          }
        }
        await writeBatch(database, spec, writes);
        const last = batch.records.at(-1);
        return {
          processed: batch.records.length,
          complete: batch.complete,
          ...(last ? { cursor: encodeCursor(last.key) } : {}),
        };
      });
    },
    async verify(context): Promise<number> {
      return withDatabase(async (database) => {
        if (!database) return 0;
        let cursor: string | undefined;
        let verified = 0;
        while (true) {
          const batch = await readBatch(database, spec, cursor, batchSize);
          for (const record of batch.records) await verifyRecord(spec, record, context);
          verified += batch.records.length;
          const last = batch.records.at(-1);
          if (batch.complete) return verified;
          if (!last) {
            throw new ProtectedStoreMigrationAdapterError(
              `${spec.id} verification made no progress`,
            );
          }
          cursor = encodeCursor(last.key);
        }
      });
    },
  };
}
