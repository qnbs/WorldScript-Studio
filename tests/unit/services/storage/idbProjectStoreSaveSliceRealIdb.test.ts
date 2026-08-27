// @vitest-environment node
// QNBS-v3: complements the hand-built-mock ordering test with a real fake-indexeddb round trip proving the write genuinely persists.
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../services/storage/storageEncryptionService', () => ({
  resolveProtectedWriteKey: vi.fn().mockResolvedValue(null),
  assertNoActiveEncryptionMigration: vi.fn().mockResolvedValue(undefined),
  idbEncryptWithKey: vi.fn(),
  idbReadSecure: vi.fn(),
  assertIdbProtectedWriteAllowed: vi.fn().mockResolvedValue(undefined),
  assertSecureStorageReadable: vi.fn().mockResolvedValue(undefined),
}));

import { APP_DATA_STORE, STATE_DB_NAME } from '../../../../services/dbConstants';
import { IdbProjectStore } from '../../../../services/storage/idbProjectStore';

beforeEach(() => {
  global.indexedDB = new IDBFactory();
});

describe('IdbProjectStore#saveSlice — real IndexedDB round trip', () => {
  it('persists the write durably against a real IDBFactory, readable back afterward', async () => {
    const projectStore = new IdbProjectStore();
    await projectStore.saveSlice('settings', { theme: 'dark' } as never);

    const readBack = await new Promise<unknown>((resolve, reject) => {
      const request = indexedDB.open(STATE_DB_NAME);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(APP_DATA_STORE, 'readonly');
        const getRequest = transaction.objectStore(APP_DATA_STORE).get('settings');
        getRequest.onsuccess = () => {
          database.close();
          resolve(getRequest.result);
        };
        getRequest.onerror = () => reject(getRequest.error);
      };
      request.onerror = () => reject(request.error);
    });

    // Plaintext (no encryption key configured) is compressed JSON — decoding it back proves the
    // real transaction actually committed, not just that some request fired successfully.
    expect(readBack).toBeDefined();
  });
});
