/**
 * Concrete IndexedDB adapter factory for secondary records with a routing shell and protected payload.
 * QNBS-v3: Each batch commits before the journal advances, so a crash can only replay idempotent work.
 */

import {
  type ProtectedStoreAdapter,
  type ProtectedStoreAdapterContext,
  ProtectedStoreMigrationAdapterError,
  type ProtectedStoreMigrationBatch,
} from './protectedStoreMigration';
import {
  isSecureRecordEnvelope,
  isSecureRecordEnvelopeCandidate,
  prepareSecureRecordPayloadWithKey,
  readSecureRecordPayloadWithKey,
  type SecureRecordContext,
  SecureRecordCorruptError,
  type SecureRecordEnvelope,
} from './storageEncryptionService';

const DEFAULT_BATCH_SIZE = 25;

export interface SecondaryPayloadStoreAdapterSpec<Record extends object, Payload> {
  id: string;
  databaseName: string;
  storeName: string;
  /** The IndexedDB key is a stable string so journal cursors remain portable and deterministic. */
  recordId(record: Record): string;
  context(recordId: string): SecureRecordContext;
  /** Extracts the legacy flat payload or the current stored payload from a structured-clone record. */
  payload(record: Record): unknown;
  /** Rejects malformed or semantically mismatched plaintext before it can be transformed. */
  isPayload(value: unknown): value is Payload;
  /** Returns the record with only its protected payload changed; routing/index fields must remain intact. */
  withPayload(record: Record, payload: Payload | SecureRecordEnvelope): Record;
  batchSize?: number;
}

interface Batch<Record> {
  records: Record[];
  complete: boolean;
}

interface PendingWrite<Record> {
  recordId: string;
  original: Record;
  replacement: Record;
}

export class ProtectedStoreMigrationConflictError extends ProtectedStoreMigrationAdapterError {
  constructor(storeId: string, recordId: string) {
    super(`Protected-store migration detected a concurrent update in ${storeId}/${recordId}`);
    this.name = 'ProtectedStoreMigrationConflictError';
  }
}

function requireKey(key: CryptoKey | undefined, operation: string, name: string): CryptoKey {
  if (!key) {
    throw new ProtectedStoreMigrationAdapterError(
      `${name} requires a ${operation} key for the protected-store operation`,
    );
  }
  return key;
}

function hasMalformedEnvelope(payload: unknown): boolean {
  return isSecureRecordEnvelopeCandidate(payload) && !isSecureRecordEnvelope(payload);
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
        // QNBS-v3: Abort an accidental open of an optional store rather than leaving an empty database behind.
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

async function readBatch<Record extends object>(
  database: IDBDatabase,
  storeName: string,
  cursor: string | undefined,
  batchSize: number,
): Promise<Batch<Record>> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const range = cursor ? IDBKeyRange.lowerBound(cursor, true) : undefined;
    const request = store.openCursor(range);
    const records: Record[] = [];
    request.onsuccess = () => {
      const result = request.result;
      if (!result) {
        resolve({ records, complete: true });
        return;
      }
      records.push(result.value as Record);
      if (records.length >= batchSize) {
        resolve({ records, complete: false });
        return;
      }
      result.continue();
    };
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error ?? new Error(`${storeName} read aborted`));
  });
}

function recordsMatch(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return left.length === right.length && left.every((byte, index) => byte === right[index]);
  }
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => recordsMatch(value, right[index]))
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
      (key, index) => key === rightKeys[index] && recordsMatch(leftRecord[key], rightRecord[key]),
    )
  );
}

async function writeBatch<Record extends object>(
  database: IDBDatabase,
  storeName: string,
  storeId: string,
  records: readonly PendingWrite<Record>[],
): Promise<void> {
  if (records.length === 0) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    let failure: Error | undefined;
    const abortForFailure = (error: Error) => {
      failure = error;
      transaction.abort();
    };
    for (const record of records) {
      const request = store.get(record.recordId);
      request.onsuccess = () => {
        if (!recordsMatch(request.result, record.original)) {
          abortForFailure(new ProtectedStoreMigrationConflictError(storeId, record.recordId));
          return;
        }
        const putRequest = store.put(record.replacement);
        putRequest.onerror = () =>
          abortForFailure(putRequest.error ?? new Error(`${storeName} write failed`));
      };
      request.onerror = () =>
        abortForFailure(request.error ?? new Error(`${storeName} read failed`));
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(failure ?? transaction.error ?? new Error(`${storeName} write aborted`));
  });
}

async function transformForOperation<Record extends object, Payload>(
  spec: SecondaryPayloadStoreAdapterSpec<Record, Payload>,
  record: Record,
  context: ProtectedStoreAdapterContext,
): Promise<Record | null> {
  const recordId = spec.recordId(record);
  const payload = spec.payload(record);
  const secureContext = spec.context(recordId);
  if (hasMalformedEnvelope(payload)) throw new SecureRecordCorruptError();

  switch (context.operation) {
    case 'enable': {
      const targetKey = requireKey(context.targetKey, 'target', spec.id);
      if (isSecureRecordEnvelope(payload)) {
        const decoded = await readSecureRecordPayloadWithKey<Payload>(
          payload,
          secureContext,
          targetKey,
        );
        if (!spec.isPayload(decoded.value)) throw new SecureRecordCorruptError();
        if (!decoded.needsMigration) return null;
        return spec.withPayload(
          record,
          await prepareSecureRecordPayloadWithKey(decoded.value, secureContext, targetKey),
        );
      }
      if (!spec.isPayload(payload)) throw new SecureRecordCorruptError();
      return spec.withPayload(
        record,
        await prepareSecureRecordPayloadWithKey(payload, secureContext, targetKey),
      );
    }
    case 'rekey': {
      const sourceKey = requireKey(context.sourceKey, 'source', spec.id);
      const targetKey = requireKey(context.targetKey, 'target', spec.id);
      if (!isSecureRecordEnvelope(payload)) {
        if (!spec.isPayload(payload)) throw new SecureRecordCorruptError();
        return spec.withPayload(
          record,
          await prepareSecureRecordPayloadWithKey(payload, secureContext, targetKey),
        );
      }
      try {
        const target = await readSecureRecordPayloadWithKey<Payload>(
          payload,
          secureContext,
          targetKey,
        );
        if (!spec.isPayload(target.value)) throw new SecureRecordCorruptError();
        if (!target.needsMigration) return null;
        return spec.withPayload(
          record,
          await prepareSecureRecordPayloadWithKey(target.value, secureContext, targetKey),
        );
      } catch (targetError) {
        try {
          const source = await readSecureRecordPayloadWithKey<Payload>(
            payload,
            secureContext,
            sourceKey,
          );
          if (!spec.isPayload(source.value)) throw new SecureRecordCorruptError();
          return spec.withPayload(
            record,
            await prepareSecureRecordPayloadWithKey(source.value, secureContext, targetKey),
          );
        } catch {
          throw targetError;
        }
      }
    }
    case 'disable': {
      if (!isSecureRecordEnvelope(payload)) return null;
      const sourceKey = requireKey(context.sourceKey, 'source', spec.id);
      const decoded = await readSecureRecordPayloadWithKey<Payload>(
        payload,
        secureContext,
        sourceKey,
      );
      if (!spec.isPayload(decoded.value)) throw new SecureRecordCorruptError();
      return spec.withPayload(record, decoded.value);
    }
  }
}

async function verifyRecord<Record extends object, Payload>(
  spec: SecondaryPayloadStoreAdapterSpec<Record, Payload>,
  record: Record,
  context: Omit<ProtectedStoreAdapterContext, 'cursor'>,
): Promise<void> {
  const payload = spec.payload(record);
  if (hasMalformedEnvelope(payload)) throw new SecureRecordCorruptError();
  const secureContext = spec.context(spec.recordId(record));
  if (context.operation === 'disable') {
    if (isSecureRecordEnvelope(payload)) {
      throw new ProtectedStoreMigrationAdapterError(`${spec.id} retained ciphertext after disable`);
    }
    if (!spec.isPayload(payload)) throw new SecureRecordCorruptError();
    return;
  }
  if (!isSecureRecordEnvelope(payload)) {
    throw new ProtectedStoreMigrationAdapterError(`${spec.id} retained plaintext after migration`);
  }
  const key = requireKey(context.targetKey, 'target', spec.id);
  const decoded = await readSecureRecordPayloadWithKey<Payload>(payload, secureContext, key);
  if (!spec.isPayload(decoded.value)) throw new SecureRecordCorruptError();
  if (decoded.needsMigration) {
    throw new ProtectedStoreMigrationAdapterError(`${spec.id} retained a legacy envelope`);
  }
}

/** Build an idempotent adapter for a store whose encrypted content lives in one nested payload field. */
export function createSecondaryPayloadStoreAdapter<Record extends object, Payload>(
  spec: SecondaryPayloadStoreAdapterSpec<Record, Payload>,
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
    // QNBS-v3: Re-keying probes the target key first, so a batch committed before its journal checkpoint can be replayed safely.
    replaySafe: true,
    async migrateNext(context): Promise<ProtectedStoreMigrationBatch> {
      return withDatabase(async (database) => {
        if (!database) return { processed: 0, complete: true };
        const batch = await readBatch<Record>(database, spec.storeName, context.cursor, batchSize);
        const rewritten: PendingWrite<Record>[] = [];
        for (const record of batch.records) {
          const next = await transformForOperation(spec, record, context);
          if (next) {
            rewritten.push({
              recordId: spec.recordId(record),
              original: record,
              replacement: next,
            });
          }
        }
        await writeBatch(database, spec.storeName, spec.id, rewritten);
        const last = batch.records.at(-1);
        return {
          processed: batch.records.length,
          complete: batch.complete,
          ...(last ? { cursor: spec.recordId(last) } : {}),
        };
      });
    },
    async verify(context): Promise<number> {
      return withDatabase(async (database) => {
        if (!database) return 0;
        let cursor: string | undefined;
        let verified = 0;
        while (true) {
          const batch = await readBatch<Record>(database, spec.storeName, cursor, batchSize);
          for (const record of batch.records) await verifyRecord(spec, record, context);
          verified += batch.records.length;
          const last = batch.records.at(-1);
          if (batch.complete) return verified;
          if (!last) {
            throw new ProtectedStoreMigrationAdapterError(
              `${spec.id} verification made no progress`,
            );
          }
          cursor = spec.recordId(last);
        }
      });
    },
  };
}
