// @vitest-environment node
// QNBS-v3: Real fake-indexeddb coverage proves each checkpointed adapter conversion preserves recoverable payloads.
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createSecondaryPayloadStoreAdapter,
  type SecondaryPayloadStoreAdapterSpec,
} from '../../../services/storage/secondaryPayloadStoreAdapter';
import {
  StorageEncryptionService,
  isSecureRecordEnvelope,
  readSecureRecordPayloadWithKey,
  type SecureRecordEnvelope,
} from '../../../services/storage/storageEncryptionService';

interface DemoPayload {
  content: string;
}

interface DemoRecord extends Record<string, unknown> {
  id: string;
  payload: DemoPayload | SecureRecordEnvelope;
}

const DB_NAME = 'secondary-adapter-test';
const STORE_NAME = 'records';
const STORE_ID = `${DB_NAME}/${STORE_NAME}`;

const spec: SecondaryPayloadStoreAdapterSpec<DemoRecord, DemoPayload> = {
  id: STORE_ID,
  databaseName: DB_NAME,
  storeName: STORE_NAME,
  recordId: (record) => record.id,
  context: (recordId) => ({ store: STORE_ID, recordId }),
  payload: (record) => record.payload,
  isPayload: (value): value is DemoPayload =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<DemoPayload>).content === 'string',
  withPayload: (record, payload) => ({ id: record.id, payload }),
  batchSize: 1,
};

async function createStore(records: readonly DemoRecord[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      for (const record of records) transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
}

async function readRecord(id: string): Promise<DemoRecord> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const getRequest = transaction.objectStore(STORE_NAME).get(id);
      getRequest.onsuccess = () => {
        database.close();
        resolve(getRequest.result as DemoRecord);
      };
      getRequest.onerror = () => reject(getRequest.error);
    };
    request.onerror = () => reject(request.error);
  });
}

async function deriveKey(passphrase: string): Promise<CryptoKey> {
  return new StorageEncryptionService().deriveKey(passphrase, new Uint8Array(32).fill(9));
}

beforeEach(() => {
  global.indexedDB = new IDBFactory();
});

describe('secondary protected-store payload adapter', () => {
  it('converts plaintext through enable, resumable rekey, and verified disable', async () => {
    await createStore([
      { id: 'a', payload: { content: 'first protected record' } },
      { id: 'b', payload: { content: 'second protected record' } },
    ]);
    const adapter = createSecondaryPayloadStoreAdapter(spec);
    const sourceKey = await deriveKey('source');
    const targetKey = await deriveKey('target');

    const firstEnable = await adapter.migrateNext({ operation: 'enable', targetKey: sourceKey });
    expect(firstEnable).toMatchObject({ processed: 1, complete: false, cursor: 'a' });
    const secondEnable = await adapter.migrateNext({
      operation: 'enable',
      targetKey: sourceKey,
      cursor: firstEnable.cursor,
    });
    expect(secondEnable).toMatchObject({ processed: 1, complete: false, cursor: 'b' });
    const finishEnable = await adapter.migrateNext({
      operation: 'enable',
      targetKey: sourceKey,
      cursor: secondEnable.cursor,
    });
    expect(finishEnable).toEqual({ processed: 0, complete: true });
    await expect(adapter.verify({ operation: 'enable', targetKey: sourceKey })).resolves.toBe(2);

    const encrypted = await readRecord('a');
    expect(isSecureRecordEnvelope(encrypted.payload)).toBe(true);
    expect(JSON.stringify(encrypted)).not.toContain('first protected record');

    const rekeyFirst = await adapter.migrateNext({
      operation: 'rekey',
      sourceKey,
      targetKey,
    });
    expect(rekeyFirst.cursor).toBe('a');
    await adapter.migrateNext({
      operation: 'rekey',
      sourceKey,
      targetKey,
      cursor: rekeyFirst.cursor,
    });
    await adapter.migrateNext({
      operation: 'rekey',
      sourceKey,
      targetKey,
      cursor: 'b',
    });
    await expect(adapter.verify({ operation: 'rekey', sourceKey, targetKey })).resolves.toBe(2);

    const targetEncrypted = await readRecord('a');
    await expect(
      readSecureRecordPayloadWithKey<DemoPayload>(targetEncrypted.payload, { store: STORE_ID, recordId: 'a' }, targetKey),
    ).resolves.toMatchObject({ value: { content: 'first protected record' } });

    const disableFirst = await adapter.migrateNext({ operation: 'disable', sourceKey: targetKey });
    await adapter.migrateNext({
      operation: 'disable',
      sourceKey: targetKey,
      cursor: disableFirst.cursor,
    });
    await adapter.migrateNext({ operation: 'disable', sourceKey: targetKey, cursor: 'b' });
    await expect(adapter.verify({ operation: 'disable', sourceKey: targetKey })).resolves.toBe(2);
    expect((await readRecord('a')).payload).toEqual({ content: 'first protected record' });
  });
});
