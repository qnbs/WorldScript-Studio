// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiInferenceCacheService } from '../../services/ai/aiInferenceCacheService';
import { _resetPassphraseSentinelForTest } from '../../services/storage/idbPassphraseSentinel';
import {
  clearIdbEncryptionKey,
  isSecureRecordEnvelope,
  SecureRecordCorruptError,
  SecureRecordLockedError,
  setupIdbEncryption,
} from '../../services/storage/storageEncryptionService';

const DB_NAME = 'worldscript-inference-cache-db';
const STORE = 'inference-cache';

async function readRawEntries(): Promise<Array<Record<string, unknown>>> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as Array<Record<string, unknown>>);
    request.onerror = () => reject(request.error);
  });
}

async function writeRawEntry(record: Record<string, unknown>): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

beforeEach(() => {
  _resetPassphraseSentinelForTest();
  clearIdbEncryptionKey();
  global.indexedDB = new IDBFactory();
});

afterEach(() => {
  _resetPassphraseSentinelForTest();
  clearIdbEncryptionKey();
});

describe('aiInferenceCacheService encrypted persistence', () => {
  it('stores generated output only inside an encrypted envelope', async () => {
    const canary = 'INFERENCE_RESULT_CANARY_b711';
    await setupIdbEncryption('cache-passphrase');
    const cache = new AiInferenceCacheService();

    await cache.setCachedInference('short prompt', 'model-a', canary);
    const [raw] = await readRawEntries();

    expect(raw).toBeDefined();
    expect(isSecureRecordEnvelope(raw?.['payload'])).toBe(true);
    expect(JSON.stringify(raw)).not.toContain(canary);
    await expect(cache.getCachedInference('short prompt', 'model-a')).resolves.toBe(canary);
  });

  it('rejects persistent reads and writes after a configured cache is locked', async () => {
    await setupIdbEncryption('cache-passphrase');
    const cache = new AiInferenceCacheService();
    await cache.setCachedInference('short prompt', 'model-a', 'sensitive result');
    clearIdbEncryptionKey();
    const restartedCache = new AiInferenceCacheService();

    await expect(
      restartedCache.getCachedInference('short prompt', 'model-a'),
    ).rejects.toBeInstanceOf(SecureRecordLockedError);
    await expect(
      restartedCache.setCachedInference('another prompt', 'model-a', 'must not persist'),
    ).rejects.toBeInstanceOf(SecureRecordLockedError);
  });

  it('lazily migrates a legacy plaintext cache result after unlock', async () => {
    const plaintextCache = new AiInferenceCacheService();
    await plaintextCache.setCachedInference('legacy prompt', 'model-a', 'seed');
    const [seed] = await readRawEntries();
    expect(typeof seed?.['key']).toBe('string');
    await writeRawEntry({
      key: seed?.['key'],
      result: 'LEGACY_INFERENCE_CANARY',
      timestamp: Date.now(),
    });
    await setupIdbEncryption('cache-passphrase');
    const unlockedCache = new AiInferenceCacheService();

    await expect(unlockedCache.getCachedInference('legacy prompt', 'model-a')).resolves.toBe(
      'LEGACY_INFERENCE_CANARY',
    );
    const [migrated] = await readRawEntries();
    expect(isSecureRecordEnvelope(migrated?.['payload'])).toBe(true);
    expect(JSON.stringify(migrated)).not.toContain('LEGACY_INFERENCE_CANARY');
  });

  it('fails closed when a cached result envelope is corrupted', async () => {
    await setupIdbEncryption('cache-passphrase');
    const cache = new AiInferenceCacheService();
    await cache.setCachedInference('corrupt prompt', 'model-a', 'CORRUPTION_CANARY');
    const [raw] = await readRawEntries();
    const payload = raw?.['payload'];
    if (!raw || !isSecureRecordEnvelope(payload)) throw new Error('Expected cache envelope');
    const ciphertext = new Uint8Array(payload.ciphertext);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;
    await writeRawEntry({ ...raw, payload: { ...payload, ciphertext } });
    const restartedCache = new AiInferenceCacheService();

    await expect(
      restartedCache.getCachedInference('corrupt prompt', 'model-a'),
    ).rejects.toBeInstanceOf(SecureRecordCorruptError);
  });
});
