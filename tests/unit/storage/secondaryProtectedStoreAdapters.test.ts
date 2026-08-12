// @vitest-environment node
// QNBS-v3: Covers non-string routing-key validation — a numeric id/key must fail fast instead of becoming a journal cursor that parseJournal() later rejects into recovery-required.
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProtectedStoreMigrationAdapterError } from '../../../services/storage/protectedStoreMigration';
import { getRegisteredSecondaryProtectedStoreAdapters } from '../../../services/storage/secondaryProtectedStoreAdapters';

const SCENE_REVISIONS_DB = 'worldscript-revisions-db';
const SCENE_REVISIONS_STORE = 'scene-revisions';
const INFERENCE_CACHE_DB = 'worldscript-inference-cache-db';
const INFERENCE_CACHE_STORE = 'inference-cache';

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
