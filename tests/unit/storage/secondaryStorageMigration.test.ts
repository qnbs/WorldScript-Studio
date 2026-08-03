// @vitest-environment node
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetDbForTest, saveRevision } from '../../../services/sceneRevisionService';
import { _resetPassphraseSentinelForTest } from '../../../services/storage/idbPassphraseSentinel';
import {
  decryptAllSecondaryStoresToPlaintext,
  reEncryptAllSecondaryStores,
} from '../../../services/storage/secondaryStorageMigration';
import {
  clearIdbEncryptionKey,
  isSecureRecordEnvelope,
  readSecureRecordPayload,
  rotateIdbPassphrase,
  setupIdbEncryption,
  verifyAndInitIdbEncryption,
} from '../../../services/storage/storageEncryptionService';

const REVISIONS_DB = 'worldscript-revisions-db';
const REVISIONS_STORE = 'scene-revisions';

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });

async function readRawRevision(id: string): Promise<Record<string, unknown> | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(REVISIONS_DB, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(REVISIONS_STORE, 'readonly')
      .objectStore(REVISIONS_STORE)
      .get(id);
    request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
    request.onerror = () => reject(request.error);
  });
}

beforeEach(() => {
  _resetDbForTest();
  _resetPassphraseSentinelForTest();
  clearIdbEncryptionKey();
  localStorageMock.clear();
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
});

afterEach(() => {
  _resetDbForTest();
  _resetPassphraseSentinelForTest();
  clearIdbEncryptionKey();
  localStorageMock.clear();
});

describe('secondaryStorageMigration', () => {
  it('decryptAllSecondaryStoresToPlaintext unwraps encrypted scene revisions', async () => {
    const canary = 'MIGRATION_DISABLE_CANARY';
    await setupIdbEncryption('disable-pass');
    const revision = await saveRevision('sec-migrate', { title: 'T', content: canary });
    const raw = await readRawRevision(revision.id);
    expect(isSecureRecordEnvelope(raw?.['payload'])).toBe(true);

    await decryptAllSecondaryStoresToPlaintext();

    const plaintext = await readRawRevision(revision.id);
    expect(isSecureRecordEnvelope(plaintext?.['payload'])).toBe(false);
    expect(plaintext?.['payload']).toMatchObject({ content: canary });
  });

  it('reEncryptAllSecondaryStores re-wraps records for a new passphrase', async () => {
    const canary = 'MIGRATION_ROTATE_CANARY';
    await setupIdbEncryption('old-pass');
    const revision = await saveRevision('sec-rotate', { title: 'T', content: canary });

    await rotateIdbPassphrase('old-pass', 'new-pass', reEncryptAllSecondaryStores);

    clearIdbEncryptionKey();
    await verifyAndInitIdbEncryption('new-pass');
    const raw = await readRawRevision(revision.id);
    const payload = raw?.['payload'];
    expect(isSecureRecordEnvelope(payload)).toBe(true);
    const decoded = await readSecureRecordPayload<{ content: string }>(payload, {
      store: 'scene-revisions',
      recordId: revision.id,
    });
    expect(decoded.value.content).toBe(canary);
  });
});
