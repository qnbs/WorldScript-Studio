// @vitest-environment node
// QNBS-v3: Covers non-string routing-key validation — a numeric id/key must fail fast instead of becoming a journal cursor that parseJournal() later rejects into recovery-required.
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProtectedStoreMigrationAdapterError } from '../../../services/storage/protectedStoreMigration';
import { getRegisteredSecondaryProtectedStoreAdapters } from '../../../services/storage/secondaryProtectedStoreAdapters';
import { StorageEncryptionService } from '../../../services/storage/storageEncryptionService';

const SCENE_REVISIONS_DB = 'worldscript-revisions-db';
const SCENE_REVISIONS_STORE = 'scene-revisions';
const INFERENCE_CACHE_DB = 'worldscript-inference-cache-db';
const INFERENCE_CACHE_STORE = 'inference-cache';
// QNBS-v3: fixed fixture timestamp instead of Date.now() — these tests never assert on the value, so a literal is simpler and safer than fake timers around real WebCrypto/fake-indexeddb async work.
const FIXED_TIMESTAMP = 1_700_000_000_000;

function createDatabase(name: string, storeName: string, keyPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath });
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

function putRecord(name: string, storeName: string, record: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(record);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
}

function readRecord(
  name: string,
  storeName: string,
  key: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(storeName, 'readonly');
      const getRequest = transaction.objectStore(storeName).get(key);
      getRequest.onsuccess = () => {
        database.close();
        resolve(getRequest.result as Record<string, unknown>);
      };
      getRequest.onerror = () => reject(getRequest.error);
    };
    request.onerror = () => reject(request.error);
  });
}

function deriveKey(): Promise<CryptoKey> {
  return new StorageEncryptionService().deriveKey('phase4-target', new Uint8Array(32).fill(7));
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('secondaryProtectedStoreAdapters — routing-key validation', () => {
  it('rejects a scene-revision record with a non-string id instead of persisting a bad cursor', async () => {
    await createDatabase(SCENE_REVISIONS_DB, SCENE_REVISIONS_STORE, 'id');
    await putRecord(SCENE_REVISIONS_DB, SCENE_REVISIONS_STORE, {
      id: 42,
      sectionId: 'section-1',
      createdAt: Date.now(),
      title: 'Untitled',
      content: 'Some content',
      wordCount: 2,
    });
    const [sceneAdapter] = getRegisteredSecondaryProtectedStoreAdapters();

    await expect(
      sceneAdapter!.migrateNext({ operation: 'enable', targetKey: {} as CryptoKey }),
    ).rejects.toMatchObject({
      constructor: ProtectedStoreMigrationAdapterError,
      message: expect.stringContaining('non-string id'),
    });
  });

  it('rejects an inference-cache record with a non-string key instead of persisting a bad cursor', async () => {
    await createDatabase(INFERENCE_CACHE_DB, INFERENCE_CACHE_STORE, 'key');
    await putRecord(INFERENCE_CACHE_DB, INFERENCE_CACHE_STORE, {
      key: 99,
      timestamp: Date.now(),
      result: 'cached text',
    });
    const [, cacheAdapter] = getRegisteredSecondaryProtectedStoreAdapters();

    await expect(
      cacheAdapter!.migrateNext({ operation: 'enable', targetKey: {} as CryptoKey }),
    ).rejects.toMatchObject({
      constructor: ProtectedStoreMigrationAdapterError,
      message: expect.stringContaining('non-string key'),
    });
  });
});

describe('secondaryProtectedStoreAdapters — scene revision payload shapes', () => {
  it('migrates a legacy flat-field scene revision record', async () => {
    await createDatabase(SCENE_REVISIONS_DB, SCENE_REVISIONS_STORE, 'id');
    await putRecord(SCENE_REVISIONS_DB, SCENE_REVISIONS_STORE, {
      id: 'rev-1',
      sectionId: 'section-1',
      createdAt: FIXED_TIMESTAMP,
      title: 'Legacy',
      content: 'legacy body',
      wordCount: 2,
      label: 'Draft',
      authorName: 'Alice',
    });
    const [sceneAdapter] = getRegisteredSecondaryProtectedStoreAdapters();
    const targetKey = await deriveKey();

    const result = await sceneAdapter!.migrateNext({ operation: 'enable', targetKey });
    expect(result).toMatchObject({ processed: 1, complete: true });

    const migrated = await readRecord(SCENE_REVISIONS_DB, SCENE_REVISIONS_STORE, 'rev-1');
    expect(migrated['schemaVersion']).toBe(1);
    expect(migrated['payload']).toBeTruthy();
    expect(migrated['title']).toBeUndefined();
  });

  it('migrates an already-nested schemaVersion 1 scene revision record', async () => {
    await createDatabase(SCENE_REVISIONS_DB, SCENE_REVISIONS_STORE, 'id');
    await putRecord(SCENE_REVISIONS_DB, SCENE_REVISIONS_STORE, {
      id: 'rev-2',
      sectionId: 'section-1',
      createdAt: FIXED_TIMESTAMP,
      schemaVersion: 1,
      payload: { title: 'Nested', content: 'nested body', wordCount: 2 },
    });
    const [sceneAdapter] = getRegisteredSecondaryProtectedStoreAdapters();
    const targetKey = await deriveKey();

    const result = await sceneAdapter!.migrateNext({ operation: 'enable', targetKey });
    expect(result).toMatchObject({ processed: 1, complete: true });

    const migrated = await readRecord(SCENE_REVISIONS_DB, SCENE_REVISIONS_STORE, 'rev-2');
    expect(migrated['payload']).not.toEqual({
      title: 'Nested',
      content: 'nested body',
      wordCount: 2,
    });
  });

  it('rejects a nested-payload scene revision record with an unsupported schema version', async () => {
    await createDatabase(SCENE_REVISIONS_DB, SCENE_REVISIONS_STORE, 'id');
    await putRecord(SCENE_REVISIONS_DB, SCENE_REVISIONS_STORE, {
      id: 'rev-3',
      sectionId: 'section-1',
      createdAt: FIXED_TIMESTAMP,
      schemaVersion: 2,
      payload: { title: 'Future', content: 'future body', wordCount: 2 },
    });
    const [sceneAdapter] = getRegisteredSecondaryProtectedStoreAdapters();
    const targetKey = await deriveKey();

    await expect(
      sceneAdapter!.migrateNext({ operation: 'enable', targetKey }),
    ).rejects.toMatchObject({
      constructor: ProtectedStoreMigrationAdapterError,
      message: expect.stringContaining('unsupported schema version'),
    });
  });

  it('rejects a legacy-shape scene revision record with an unexpected extra field', async () => {
    await createDatabase(SCENE_REVISIONS_DB, SCENE_REVISIONS_STORE, 'id');
    await putRecord(SCENE_REVISIONS_DB, SCENE_REVISIONS_STORE, {
      id: 'rev-4',
      sectionId: 'section-1',
      createdAt: FIXED_TIMESTAMP,
      title: 'Bad',
      content: 'bad body',
      wordCount: 2,
      unexpectedField: 'should not be here',
    });
    const [sceneAdapter] = getRegisteredSecondaryProtectedStoreAdapters();
    const targetKey = await deriveKey();

    await expect(
      sceneAdapter!.migrateNext({ operation: 'enable', targetKey }),
    ).rejects.toMatchObject({
      constructor: ProtectedStoreMigrationAdapterError,
      message: expect.stringContaining('unsupported record schema'),
    });
  });

  it('rejects a nested-payload scene revision record with an unexpected extra field', async () => {
    await createDatabase(SCENE_REVISIONS_DB, SCENE_REVISIONS_STORE, 'id');
    await putRecord(SCENE_REVISIONS_DB, SCENE_REVISIONS_STORE, {
      id: 'rev-5',
      sectionId: 'section-1',
      createdAt: FIXED_TIMESTAMP,
      schemaVersion: 1,
      payload: { title: 'Bad nested', content: 'body', wordCount: 2 },
      unexpectedField: 'should not be here',
    });
    const [sceneAdapter] = getRegisteredSecondaryProtectedStoreAdapters();
    const targetKey = await deriveKey();

    await expect(
      sceneAdapter!.migrateNext({ operation: 'enable', targetKey }),
    ).rejects.toMatchObject({
      constructor: ProtectedStoreMigrationAdapterError,
      message: expect.stringContaining('unsupported record schema'),
    });
  });
});

describe('secondaryProtectedStoreAdapters — inference cache payload shapes', () => {
  it('migrates a legacy flat-field inference cache record', async () => {
    await createDatabase(INFERENCE_CACHE_DB, INFERENCE_CACHE_STORE, 'key');
    await putRecord(INFERENCE_CACHE_DB, INFERENCE_CACHE_STORE, {
      key: 'cache-1',
      timestamp: FIXED_TIMESTAMP,
      result: 'legacy cached text',
    });
    const [, cacheAdapter] = getRegisteredSecondaryProtectedStoreAdapters();
    const targetKey = await deriveKey();

    const result = await cacheAdapter!.migrateNext({ operation: 'enable', targetKey });
    expect(result).toMatchObject({ processed: 1, complete: true });

    const migrated = await readRecord(INFERENCE_CACHE_DB, INFERENCE_CACHE_STORE, 'cache-1');
    expect(migrated['payload']).toBeTruthy();
    expect(migrated['result']).toBeUndefined();
  });

  it('migrates an already-nested-payload inference cache record', async () => {
    await createDatabase(INFERENCE_CACHE_DB, INFERENCE_CACHE_STORE, 'key');
    await putRecord(INFERENCE_CACHE_DB, INFERENCE_CACHE_STORE, {
      key: 'cache-2',
      timestamp: FIXED_TIMESTAMP,
      payload: { result: 'nested cached text' },
    });
    const [, cacheAdapter] = getRegisteredSecondaryProtectedStoreAdapters();
    const targetKey = await deriveKey();

    const result = await cacheAdapter!.migrateNext({ operation: 'enable', targetKey });
    expect(result).toMatchObject({ processed: 1, complete: true });

    const migrated = await readRecord(INFERENCE_CACHE_DB, INFERENCE_CACHE_STORE, 'cache-2');
    expect(migrated['payload']).not.toEqual({ result: 'nested cached text' });
  });

  it('rejects a legacy-shape inference cache record with an unexpected extra field', async () => {
    await createDatabase(INFERENCE_CACHE_DB, INFERENCE_CACHE_STORE, 'key');
    await putRecord(INFERENCE_CACHE_DB, INFERENCE_CACHE_STORE, {
      key: 'cache-3',
      timestamp: FIXED_TIMESTAMP,
      result: 'bad',
      unexpectedField: 'should not be here',
    });
    const [, cacheAdapter] = getRegisteredSecondaryProtectedStoreAdapters();
    const targetKey = await deriveKey();

    await expect(
      cacheAdapter!.migrateNext({ operation: 'enable', targetKey }),
    ).rejects.toMatchObject({
      constructor: ProtectedStoreMigrationAdapterError,
      message: expect.stringContaining('unsupported record schema'),
    });
  });

  it('rejects a nested-payload inference cache record with an unexpected extra field', async () => {
    await createDatabase(INFERENCE_CACHE_DB, INFERENCE_CACHE_STORE, 'key');
    await putRecord(INFERENCE_CACHE_DB, INFERENCE_CACHE_STORE, {
      key: 'cache-4',
      timestamp: FIXED_TIMESTAMP,
      payload: { result: 'bad nested' },
      unexpectedField: 'should not be here',
    });
    const [, cacheAdapter] = getRegisteredSecondaryProtectedStoreAdapters();
    const targetKey = await deriveKey();

    await expect(
      cacheAdapter!.migrateNext({ operation: 'enable', targetKey }),
    ).rejects.toMatchObject({
      constructor: ProtectedStoreMigrationAdapterError,
      message: expect.stringContaining('unsupported record schema'),
    });
  });
});
