// @vitest-environment node
// QNBS-v3: node env avoids jsdom's non-functional indexedDB stub from tests/setup.ts; crypto.subtle,
//          CryptoKey, TextEncoder and btoa/atob are all global in Node 22.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock localStorage before importing the module
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });

// QNBS-v3: provide a working IndexedDB for the sentinel-store tests (node has none by default).
globalThis.indexedDB = new IDBFactory();

import { APP_DATA_STORE, DB_VERSION, STATE_DB_NAME } from '../../../services/dbConstants';
import { _resetDbForTest, dbService } from '../../../services/storage';
import {
  __encryptionMigrationJournalRecordKeyForTest,
  __resetEncryptionMigrationJournalConnectionsForTest,
  beginEncryptionMigration,
  completeEncryptionMigration,
  IdbMigrationInProgressError,
  updateEncryptionMigrationJournal,
} from '../../../services/storage/encryptionMigrationJournal';
import * as sentinelModule from '../../../services/storage/idbPassphraseSentinel';
import {
  assertIdbMigrationTargetKeyMatchesVerifier,
  clearIdbEncryptionKey,
  clearIdbPassphrase,
  createIdbMigrationTargetVerifier,
  deriveRotationTargetKey,
  hasPassphraseSentinel,
  IdbEncryptionMigrationRequiredError,
  IdbEncryptionSaltLostError,
  IdbStorageLockedError,
  idbDecrypt,
  idbDecryptWithKey,
  idbEncrypt,
  idbEncryptWithKey,
  initIdbEncryption,
  isEncryptedBlob,
  isIdbEncryptionReady,
  isSecureRecordEnvelope,
  prepareSecureRecordPayload,
  readSecureRecordPayload,
  resolveProtectedWriteKey,
  resumeEncryptionMigration,
  rotateIdbPassphrase,
  SECURE_RECORD_VERSION,
  SecureRecordCorruptError,
  SecureRecordLockedError,
  StorageEncryptionService,
  setupIdbEncryption,
  verifyAndInitIdbEncryption,
} from '../../../services/storage/storageEncryptionService';
import type { StoryCodex } from '../../../types';

const svc = new StorageEncryptionService();

async function freshKey(passphrase = 'test-pass'): Promise<CryptoKey> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  return svc.deriveKey(passphrase, salt);
}

// QNBS-v3 (CodeRabbit #342): dbService/sentinel/journal are separate IdbConnectionManager singletons
// with their own cached connections — closing all three before installing a fresh IDBFactory gives
// every test a genuinely empty database instead of leaking images/codex/vectors/assets across tests.
beforeEach(() => {
  _resetDbForTest();
  sentinelModule._resetSentinelStoreForTest();
  __resetEncryptionMigrationJournalConnectionsForTest();
  globalThis.indexedDB = new IDBFactory();
  localStorageMock.clear();
  clearIdbEncryptionKey();
});

afterEach(() => {
  clearIdbEncryptionKey();
  _resetDbForTest();
  sentinelModule._resetSentinelStoreForTest();
  __resetEncryptionMigrationJournalConnectionsForTest();
  vi.restoreAllMocks();
});

// ── StorageEncryptionService class ──────────────────────────────────────────

describe('StorageEncryptionService.deriveKey', () => {
  it('returns a CryptoKey', async () => {
    const key = await freshKey();
    expect(key).toBeInstanceOf(CryptoKey);
  });

  it('key is non-extractable (SEC-RULE-5)', async () => {
    const key = await freshKey();
    expect(key.extractable).toBe(false);
  });

  it('key algorithm is AES-GCM 256-bit', async () => {
    const key = await freshKey();
    expect((key.algorithm as AesKeyAlgorithm).name).toBe('AES-GCM');
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
  });

  it('same passphrase + salt produces functionally equivalent keys (round-trip test)', async () => {
    const salt = new Uint8Array(32).fill(42);
    const k1 = await svc.deriveKey('hello', salt);
    const k2 = await svc.deriveKey('hello', salt);
    // Cannot compare keys directly (non-extractable) — verify via encrypt/decrypt round-trip
    const blob = await svc.encrypt(k1, { x: 1 });
    const result = await svc.decrypt(k2, blob);
    expect(result).toEqual({ x: 1 });
  });
});

describe('StorageEncryptionService.encrypt / decrypt', () => {
  it('round-trips a plain object', async () => {
    const key = await freshKey();
    const data = { title: 'My Novel', chapters: 12 };
    const blob = await svc.encrypt(key, data);
    const result = await svc.decrypt(key, blob);
    expect(result).toEqual(data);
  });

  it('round-trips a nested array', async () => {
    const key = await freshKey();
    const data = [1, 'two', { three: true }];
    const blob = await svc.encrypt(key, data);
    expect(await svc.decrypt(key, blob)).toEqual(data);
  });

  it('encrypted bytes start with the sentinel', async () => {
    const key = await freshKey();
    const blob = await svc.encrypt(key, 'hello');
    // sentinel = \x00enc1\x00
    expect(blob.bytes[0]).toBe(0x00);
    expect(blob.bytes[1]).toBe(0x65); // 'e'
    expect(blob.bytes[2]).toBe(0x6e); // 'n'
    expect(blob.bytes[3]).toBe(0x63); // 'c'
    expect(blob.bytes[4]).toBe(0x31); // '1'
    expect(blob.bytes[5]).toBe(0x00);
  });

  it('two encryptions of the same data produce different ciphertexts (random IV)', async () => {
    const key = await freshKey();
    const b1 = await svc.encrypt(key, 'same');
    const b2 = await svc.encrypt(key, 'same');
    expect(b1.bytes).not.toEqual(b2.bytes);
  });

  it('decrypt throws on wrong passphrase', async () => {
    const salt = new Uint8Array(32).fill(7);
    const k1 = await svc.deriveKey('correct', salt);
    const k2 = await svc.deriveKey('wrong', salt);
    const blob = await svc.encrypt(k1, 'secret');
    await expect(svc.decrypt(k2, blob)).rejects.toThrow();
  });

  it('decrypt throws on sentinel mismatch', async () => {
    const key = await freshKey();
    const tampered = { bytes: new Uint8Array(30).fill(0xff) };
    await expect(svc.decrypt(key, tampered)).rejects.toThrow('sentinel mismatch');
  });

  it('decrypt throws on truncated blob', async () => {
    const key = await freshKey();
    const blob = await svc.encrypt(key, 'data');
    const truncated = { bytes: blob.bytes.slice(0, 10) };
    await expect(svc.decrypt(key, truncated)).rejects.toThrow();
  });
});

describe('migration target verifier', () => {
  it('accepts only the key that created the durable verifier', async () => {
    const targetKey = await freshKey('target');
    const otherKey = await freshKey('other');
    const verifier = await createIdbMigrationTargetVerifier(targetKey);

    await expect(
      assertIdbMigrationTargetKeyMatchesVerifier(targetKey, verifier),
    ).resolves.toBeUndefined();
    await expect(assertIdbMigrationTargetKeyMatchesVerifier(otherKey, verifier)).rejects.toThrow();
  });
});

// ── isEncryptedBlob ──────────────────────────────────────────────────────────

describe('isEncryptedBlob', () => {
  it('returns true for a properly sentinel-prefixed Uint8Array', async () => {
    const key = await freshKey();
    const blob = await svc.encrypt(key, 'x');
    expect(isEncryptedBlob(blob.bytes)).toBe(true);
  });

  it('returns false for a plain string', () => {
    expect(isEncryptedBlob('some string')).toBe(false);
  });

  it('returns false for a short Uint8Array', () => {
    expect(isEncryptedBlob(new Uint8Array(3))).toBe(false);
  });

  it('returns false for a Uint8Array without sentinel', () => {
    expect(isEncryptedBlob(new Uint8Array(20).fill(1))).toBe(false);
  });
});

describe('secondary secure-record envelopes', () => {
  const context = { store: 'worldscript-revisions-db/scene-revisions', recordId: 'revision-1' };

  it('binds ciphertext to its record identity with AAD', async () => {
    await setupIdbEncryption('secure-record-pass');
    const envelope = await prepareSecureRecordPayload({ content: 'confidential' }, context);

    expect(isSecureRecordEnvelope(envelope)).toBe(true);
    expect(envelope).toMatchObject({ version: SECURE_RECORD_VERSION });
    await expect(
      readSecureRecordPayload(envelope, { ...context, recordId: 'revision-2' }),
    ).rejects.toBeInstanceOf(SecureRecordCorruptError);
    await expect(readSecureRecordPayload(envelope, context)).resolves.toMatchObject({
      value: { content: 'confidential' },
      needsMigration: false,
    });
  });

  it('never falls back to plaintext when configured secondary storage is locked', async () => {
    await setupIdbEncryption('secure-record-pass');
    clearIdbEncryptionKey();

    await expect(
      prepareSecureRecordPayload({ content: 'changed' }, context),
    ).rejects.toBeInstanceOf(IdbStorageLockedError);
    await expect(readSecureRecordPayload({ content: 'legacy' }, context)).rejects.toBeInstanceOf(
      SecureRecordLockedError,
    );
  });

  it('treats a partial envelope as corruption rather than legacy plaintext', async () => {
    await setupIdbEncryption('secure-record-pass');

    await expect(
      readSecureRecordPayload({ version: 1, iv: new Uint8Array(12) }, context),
    ).rejects.toBeInstanceOf(SecureRecordCorruptError);
  });

  it('returns unlocked legacy plaintext as migration-required without treating it as final', async () => {
    await setupIdbEncryption('secure-record-pass');

    await expect(readSecureRecordPayload({ content: 'legacy' }, context)).resolves.toEqual({
      value: { content: 'legacy' },
      needsMigration: true,
    });
  });

  it('rejects a ciphertext-only envelope fragment as corruption', async () => {
    await setupIdbEncryption('secure-record-pass');

    await expect(
      readSecureRecordPayload({ ciphertext: new Uint8Array(32) }, context),
    ).rejects.toBeInstanceOf(SecureRecordCorruptError);
  });
});

// ── Module singleton functions ───────────────────────────────────────────────

describe('initIdbEncryption / isIdbEncryptionReady / idbEncrypt / idbDecrypt', () => {
  it('isIdbEncryptionReady() is false before init', () => {
    expect(isIdbEncryptionReady()).toBe(false);
  });

  it('isIdbEncryptionReady() is true after init', async () => {
    await initIdbEncryption('my-passphrase');
    expect(isIdbEncryptionReady()).toBe(true);
  });

  it('clearIdbEncryptionKey() resets ready state', async () => {
    await initIdbEncryption('my-passphrase');
    clearIdbEncryptionKey();
    expect(isIdbEncryptionReady()).toBe(false);
  });

  it('idbEncrypt throws before init', async () => {
    await expect(idbEncrypt({ x: 1 })).rejects.toThrow('not initialised');
  });

  it('idbDecrypt throws before init', async () => {
    await expect(idbDecrypt(new Uint8Array(50))).rejects.toThrow('not initialised');
  });

  it('initIdbEncryption throws on empty passphrase', async () => {
    await expect(initIdbEncryption('')).rejects.toThrow('must not be empty');
  });

  it('full round-trip via singleton functions', async () => {
    await initIdbEncryption('singleton-pass');
    const payload = { manuscript: [{ id: 'm1', title: 'Ch1', content: 'Once upon a time' }] };
    const encrypted = await idbEncrypt(payload);
    expect(encrypted).toBeInstanceOf(Uint8Array);
    const decrypted = await idbDecrypt<typeof payload>(encrypted);
    expect(decrypted).toEqual(payload);
  });

  it('stores salt in localStorage on first call', async () => {
    await initIdbEncryption('pass');
    expect(localStorageMock.getItem('worldscript-idb-kdf-salt-v1')).not.toBeNull();
  });

  it('reuses existing salt from localStorage', async () => {
    await initIdbEncryption('pass');
    const salt1 = localStorageMock.getItem('worldscript-idb-kdf-salt-v1');
    clearIdbEncryptionKey();
    await initIdbEncryption('pass');
    const salt2 = localStorageMock.getItem('worldscript-idb-kdf-salt-v1');
    expect(salt1).toBe(salt2);
  });

  it('fails setup instead of deriving a key with a deterministic salt when persistence is unavailable', async () => {
    const originalSetItem = localStorageMock.setItem;
    try {
      localStorageMock.setItem = () => {
        throw new Error('storage blocked');
      };

      await expect(initIdbEncryption('pass')).rejects.toThrow('Unable to persist encryption salt');
      expect(isIdbEncryptionReady()).toBe(false);
    } finally {
      localStorageMock.setItem = originalSetItem;
    }
  });

  it('fails closed instead of deriving a new (incompatible) salt when a sentinel already exists', async () => {
    await setupIdbEncryption('original-pass');
    clearIdbEncryptionKey();
    // QNBS-v3: simulate the salt being lost (e.g. localStorage cleared) while the sentinel survives.
    localStorageMock.clear();

    await expect(initIdbEncryption('original-pass')).rejects.toBeInstanceOf(
      IdbEncryptionSaltLostError,
    );
    expect(isIdbEncryptionReady()).toBe(false);
    // QNBS-v3: no replacement salt must have been written — that would make the loss permanent.
    expect(localStorageMock.getItem('worldscript-idb-kdf-salt-v1')).toBeNull();
  });

  it('verifyAndInitIdbEncryption also fails closed when the sentinel survives but the salt is lost', async () => {
    await setupIdbEncryption('original-pass');
    clearIdbEncryptionKey();
    localStorageMock.clear();

    await expect(verifyAndInitIdbEncryption('original-pass')).rejects.toBeInstanceOf(
      IdbEncryptionSaltLostError,
    );
    expect(isIdbEncryptionReady()).toBe(false);
  });
});

// ── Sentinel-backed API ───────────────────────────────────────────────────────

describe('setupIdbEncryption', () => {
  it('derives key, encrypts sentinel, and activates encryption', async () => {
    await setupIdbEncryption('my-secret');
    expect(isIdbEncryptionReady()).toBe(true);
  });

  it('throws on empty passphrase', async () => {
    await expect(setupIdbEncryption('')).rejects.toThrow('must not be empty');
  });

  it('stores sentinel in IDB (hasPassphraseSentinel returns true)', async () => {
    await setupIdbEncryption('secret');
    expect(await hasPassphraseSentinel()).toBe(true);
  });

  it('refuses to overwrite an existing verifier outside the resumable rotation flow', async () => {
    await setupIdbEncryption('first-passphrase');

    await expect(setupIdbEncryption('second-passphrase')).rejects.toThrow(
      'Encryption is already configured',
    );
    clearIdbEncryptionKey();
    await expect(verifyAndInitIdbEncryption('first-passphrase')).resolves.toBeUndefined();
  });
});

describe('verifyAndInitIdbEncryption', () => {
  it('activates key when passphrase matches sentinel', async () => {
    await setupIdbEncryption('correct');
    clearIdbEncryptionKey();
    expect(isIdbEncryptionReady()).toBe(false);
    await verifyAndInitIdbEncryption('correct');
    expect(isIdbEncryptionReady()).toBe(true);
  });

  it('throws when no sentinel exists', async () => {
    await expect(verifyAndInitIdbEncryption('any')).rejects.toThrow('No passphrase sentinel found');
  });

  it('fails closed without replacing missing salt for an existing encrypted library', async () => {
    await setupIdbEncryption('correct');
    clearIdbEncryptionKey();
    localStorageMock.removeItem('worldscript-idb-kdf-salt-v1');

    await expect(verifyAndInitIdbEncryption('correct')).rejects.toThrow(
      'Encryption salt is missing',
    );
    expect(localStorageMock.getItem('worldscript-idb-kdf-salt-v1')).toBeNull();
  });

  it('does not replace the active key while a journal owns the encryption lifecycle', async () => {
    await setupIdbEncryption('correct');
    clearIdbEncryptionKey();
    const journal = await beginEncryptionMigration({
      operationId: 'lock-setup-and-unlock',
      operation: 'rekey',
      phase: 'prepared',
      sourceGeneration: 'source',
      targetGeneration: 'target',
      targetVerifier: [1, 2, 3],
      stores: [],
    });

    await expect(verifyAndInitIdbEncryption('correct')).rejects.toBeInstanceOf(
      IdbMigrationInProgressError,
    );
    await expect(initIdbEncryption('correct')).rejects.toBeInstanceOf(IdbMigrationInProgressError);
    await expect(setupIdbEncryption('replacement')).rejects.toBeInstanceOf(
      IdbMigrationInProgressError,
    );
    // QNBS-v3: route through the legal prepared→migrating→verifying→committing chain so this journal does not leak into later tests.
    const migrating = await updateEncryptionMigrationJournal(journal, {
      phase: 'migrating',
      stores: journal.stores,
    });
    const verifying = await updateEncryptionMigrationJournal(migrating, {
      phase: 'verifying',
      stores: migrating.stores,
    });
    const committing = await updateEncryptionMigrationJournal(verifying, {
      phase: 'committing',
      stores: verifying.stores,
    });
    await completeEncryptionMigration(committing);
  });

  it('throws on wrong passphrase (AES-GCM auth-tag mismatch)', async () => {
    await setupIdbEncryption('correct');
    clearIdbEncryptionKey();
    await expect(verifyAndInitIdbEncryption('wrong')).rejects.toThrow();
  });

  it('throws on empty passphrase', async () => {
    await expect(verifyAndInitIdbEncryption('')).rejects.toThrow('must not be empty');
  });
});

describe('hasPassphraseSentinel', () => {
  it('returns false before setup', async () => {
    expect(await hasPassphraseSentinel()).toBe(false);
  });

  it('returns true after setup', async () => {
    await setupIdbEncryption('pass');
    expect(await hasPassphraseSentinel()).toBe(true);
  });
});

describe('clearIdbPassphrase', () => {
  it('throws IdbStorageLockedError when the session is locked', async () => {
    await setupIdbEncryption('pass');
    clearIdbEncryptionKey();
    await expect(clearIdbPassphrase()).rejects.toBeInstanceOf(IdbStorageLockedError);
    // QNBS-v3: a locked, failed disable attempt must not touch the durable verifier.
    expect(await hasPassphraseSentinel()).toBe(true);
  });

  it('migrates every protected store to plaintext, deletes the sentinel, and clears the active key', async () => {
    await setupIdbEncryption('pass');
    expect(isIdbEncryptionReady()).toBe(true);
    expect(await hasPassphraseSentinel()).toBe(true);

    await expect(clearIdbPassphrase()).resolves.toBeUndefined();

    expect(isIdbEncryptionReady()).toBe(false);
    expect(await hasPassphraseSentinel()).toBe(false);
  });
});

// ── Atomic write-key resolution (TOCTOU fix) ─────────────────────────────────

describe('resolveProtectedWriteKey', () => {
  it('returns the active key without an IDB read when a key is present', async () => {
    await initIdbEncryption('pass');
    const spy = vi.spyOn(sentinelModule, 'getPassphraseSentinel');
    const key = await resolveProtectedWriteKey();
    expect(key).toBeInstanceOf(CryptoKey);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns null when encryption was never configured', async () => {
    await expect(resolveProtectedWriteKey()).resolves.toBeNull();
  });

  it('throws IdbStorageLockedError when configured but locked', async () => {
    await setupIdbEncryption('pass');
    clearIdbEncryptionKey();
    await expect(resolveProtectedWriteKey()).rejects.toBeInstanceOf(IdbStorageLockedError);
  });
});

describe('idbEncryptWithKey', () => {
  it('encrypts with the exact key passed in, independent of the active session key', async () => {
    const explicitKey = await freshKey('explicit-pass');
    const bytes = await idbEncryptWithKey(explicitKey, { title: 'Novel' });
    expect(isEncryptedBlob(bytes)).toBe(true);
    const decrypted = await svc.decrypt(explicitKey, { bytes });
    expect(decrypted).toEqual({ title: 'Novel' });
  });

  it('remains decryptable with the captured key even after clearIdbEncryptionKey() clears the session', async () => {
    await initIdbEncryption('pass');
    const capturedKey = (await resolveProtectedWriteKey())!;
    clearIdbEncryptionKey();
    const bytes = await idbEncryptWithKey(capturedKey, 'still works');
    expect(await svc.decrypt(capturedKey, { bytes })).toBe('still works');
  });
});

// ── hasPassphraseSentinel caching ────────────────────────────────────────────

describe('hasPassphraseSentinel caching', () => {
  it('does not re-read IDB on repeated calls once a positive result is cached', async () => {
    await setupIdbEncryption('pass');
    const spy = vi.spyOn(sentinelModule, 'getPassphraseSentinel');
    await hasPassphraseSentinel();
    await hasPassphraseSentinel();
    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT cache a negative result — repeated calls with no sentinel keep re-reading IDB', async () => {
    // QNBS-v3 regression: caching "false" could survive setupIdbEncryption() happening in another
    // tab, permanently stranding resolveProtectedWriteKey() on a stale "never configured" answer.
    expect(await hasPassphraseSentinel()).toBe(false);
    const spy = vi.spyOn(sentinelModule, 'getPassphraseSentinel');
    await hasPassphraseSentinel();
    await hasPassphraseSentinel();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('picks up a sentinel created after an earlier negative lookup (simulated cross-tab setup)', async () => {
    expect(await hasPassphraseSentinel()).toBe(false);
    await setupIdbEncryption('pass');
    expect(await hasPassphraseSentinel()).toBe(true);
  });

  it('setupIdbEncryption primes the cache without an extra read', async () => {
    await setupIdbEncryption('pass');
    const spy = vi.spyOn(sentinelModule, 'getPassphraseSentinel');
    expect(await hasPassphraseSentinel()).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('verifyAndInitIdbEncryption primes the cache without an extra read', async () => {
    await setupIdbEncryption('pass');
    clearIdbEncryptionKey();
    await verifyAndInitIdbEncryption('pass');
    const spy = vi.spyOn(sentinelModule, 'getPassphraseSentinel');
    expect(await hasPassphraseSentinel()).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it('clearIdbEncryptionKey() resets the cache so the next call re-reads IDB', async () => {
    await setupIdbEncryption('pass');
    clearIdbEncryptionKey();
    const spy = vi.spyOn(sentinelModule, 'getPassphraseSentinel');
    expect(await hasPassphraseSentinel()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('rotateIdbPassphrase', () => {
  it('re-keys to the new passphrase; the old passphrase no longer unlocks', async () => {
    await setupIdbEncryption('old');
    await expect(rotateIdbPassphrase('old', 'new')).resolves.toBeUndefined();
    expect(isIdbEncryptionReady()).toBe(true);

    clearIdbEncryptionKey();
    await expect(verifyAndInitIdbEncryption('new')).resolves.toBeUndefined();
    expect(isIdbEncryptionReady()).toBe(true);

    clearIdbEncryptionKey();
    await expect(verifyAndInitIdbEncryption('old')).rejects.toThrow();
  });

  it('does not replace the verifier when passed a wrong old passphrase', async () => {
    await setupIdbEncryption('old');
    clearIdbEncryptionKey();

    await expect(rotateIdbPassphrase('wrong', 'new')).rejects.toThrow();

    clearIdbEncryptionKey();
    await expect(verifyAndInitIdbEncryption('old')).resolves.toBeUndefined();
  });
});

// QNBS-v3: covers the desktop fs-data migration bridge's key-derivation dependency — see
// services/fs/fsEncryptionMigration.ts, which must independently derive the SAME target key
// rotateIdbPassphrase() will activate, without running any migration itself.
describe('deriveRotationTargetKey', () => {
  it('derives a key that decrypts data rotateIdbPassphrase() re-encrypts under the new passphrase', async () => {
    await setupIdbEncryption('old');

    // Derive the target key BEFORE rotation runs, exactly as the fs migration bridge does.
    const targetKey = await deriveRotationTargetKey('new');
    const ciphertext = await idbEncryptWithKey(targetKey, { secret: 'fs-backed-value' });

    await rotateIdbPassphrase('old', 'new');

    // The now-active session key (post-rotation) must be able to decrypt the SAME bytes.
    const activeKey = await resolveProtectedWriteKey();
    expect(activeKey).not.toBeNull();
    await expect(
      idbDecryptWithKey<{ secret: string }>(activeKey as CryptoKey, ciphertext),
    ).resolves.toEqual({ secret: 'fs-backed-value' });
  });

  it('does not activate a session or touch the sentinel', async () => {
    await setupIdbEncryption('old');
    clearIdbEncryptionKey();

    await deriveRotationTargetKey('some-candidate-passphrase');

    expect(isIdbEncryptionReady()).toBe(false);
    expect(await hasPassphraseSentinel()).toBe(true);
    // The real passphrase still unlocks normally — deriving a rotation target key for an
    // unrelated candidate passphrase must not have mutated the sentinel or salt.
    await expect(verifyAndInitIdbEncryption('old')).resolves.toBeUndefined();
  });
});

// QNBS-v3: a 'recovery-required' journal has no legal transition back to 'completed' via the
// checked API (by design — it requires the dedicated recovery UX, not a normal migration retry),
// so this suite plants and removes it with raw IDB access rather than the journal module's API.
async function deleteJournalRecordForTest(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(STATE_DB_NAME, DB_VERSION);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(APP_DATA_STORE, 'readwrite');
      tx.objectStore(APP_DATA_STORE).delete(__encryptionMigrationJournalRecordKeyForTest);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

describe('disable/rotate blocked by a stuck recovery-required journal', () => {
  it('clearIdbPassphrase and rotateIdbPassphrase both refuse to start a new migration', async () => {
    await setupIdbEncryption('pass');
    const journal = await beginEncryptionMigration({
      operationId: 'stuck-recovery',
      operation: 'rekey',
      phase: 'prepared',
      targetVerifier: [1, 2, 3],
      stores: [],
    });
    await updateEncryptionMigrationJournal(journal, {
      phase: 'recovery-required',
      stores: journal.stores,
    });

    try {
      await expect(clearIdbPassphrase()).rejects.toBeInstanceOf(
        IdbEncryptionMigrationRequiredError,
      );
      await expect(rotateIdbPassphrase('pass', 'new')).rejects.toBeInstanceOf(
        IdbEncryptionMigrationRequiredError,
      );
      expect(isIdbEncryptionReady()).toBe(true);
      expect(await hasPassphraseSentinel()).toBe(true);
    } finally {
      await deleteJournalRecordForTest();
    }
  });
});

// QNBS-v3: exercises the primary-store adapters (primaryProtectedStoreAdapters.ts) against real
// data through the public dbService API — the earlier disable/rotate tests above only prove the
// migration completes over EMPTY stores; this proves round-tripped content survives both operations.
describe('production migration round-trip with real data', () => {
  it('preserves an image through rekey then disable', async () => {
    await setupIdbEncryption('test-fixture-original-passphrase');
    await dbService.saveImage('recovery-img', 'recovery-content');
    expect(await dbService.getImage('recovery-img')).toBe('recovery-content');

    await rotateIdbPassphrase('test-fixture-original-passphrase', 'test-fixture-new-passphrase');
    expect(await dbService.getImage('recovery-img')).toBe('recovery-content');

    await clearIdbPassphrase();
    expect(isIdbEncryptionReady()).toBe(false);
    expect(await dbService.getImage('recovery-img')).toBe('recovery-content');
  });

  it('preserves a story codex (3-shape dispatch) through rekey then disable', async () => {
    const codex: StoryCodex = {
      projectId: 'recovery-project',
      extractedAt: '2026-01-01T00:00:00.000Z',
      entities: [
        {
          id: 'e1',
          name: 'Ada',
          type: 'character',
          known: true,
          mentionCount: 3,
          mentions: [],
        },
      ],
      summary: 'A test codex',
    };

    await setupIdbEncryption('test-fixture-original-passphrase');
    await dbService.saveStoryCodex(codex);
    expect(await dbService.getStoryCodex('recovery-project')).toEqual(codex);

    await rotateIdbPassphrase('test-fixture-original-passphrase', 'test-fixture-new-passphrase');
    expect(await dbService.getStoryCodex('recovery-project')).toEqual(codex);

    await clearIdbPassphrase();
    expect(await dbService.getStoryCodex('recovery-project')).toEqual(codex);
  });

  it('preserves a binder asset (Blob <-> bytes conversion) through rekey then disable', async () => {
    const originalBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const meta = { mimeType: 'application/pdf', originalFileName: 'notes.pdf', byteSize: 0 };

    await setupIdbEncryption('test-fixture-original-passphrase');
    await dbService.saveBinderAsset('proj-1', 'asset-1', originalBytes.buffer, meta);

    async function readAssetBytes(): Promise<number[]> {
      const payload = await dbService.getBinderAsset('proj-1', 'asset-1');
      if (!payload) throw new Error('binder asset not found');
      return Array.from(new Uint8Array(payload.data));
    }

    expect(await readAssetBytes()).toEqual([1, 2, 3, 4, 5]);

    await rotateIdbPassphrase('test-fixture-original-passphrase', 'test-fixture-new-passphrase');
    expect(await readAssetBytes()).toEqual([1, 2, 3, 4, 5]);

    await clearIdbPassphrase();
    expect(await readAssetBytes()).toEqual([1, 2, 3, 4, 5]);
  });

  it('preserves RAG vectors (aggregate <-> individual-record duality) through rekey then disable', async () => {
    const vectors = [
      { id: 'chunk-1', embedding: [0.1, 0.2], text: 'first chunk' },
      { id: 'chunk-2', embedding: [0.3, 0.4], text: 'second chunk' },
    ];

    await setupIdbEncryption('test-fixture-original-passphrase');
    await dbService.saveRagVectors('recovery-project-vec', vectors);
    expect(await dbService.getRagVectors('recovery-project-vec')).toEqual(vectors);

    await rotateIdbPassphrase('test-fixture-original-passphrase', 'test-fixture-new-passphrase');
    expect(await dbService.getRagVectors('recovery-project-vec')).toEqual(vectors);

    await clearIdbPassphrase();
    // QNBS-v3: disable's target shape is N individual plain records — the projectId field is
    // re-added by writeProjectVectors(), so the round-tripped records carry it too.
    expect(await dbService.getRagVectors('recovery-project-vec')).toEqual(
      vectors.map((vector) => ({ ...vector, projectId: 'recovery-project-vec' })),
    );
  });

  // QNBS-v3 (CodeAnt/qodo #342): IdbKeyStore stores its non-extractable CryptoKey
  // (local_crypto_key_v2) and per-provider encrypted API keys (api_key_<provider>_enc/_iv) in the
  // SAME physical store (APP_DATA_STORE) as project/settings data. The app-data primary-store
  // adapter previously had no way to tell them apart from ordinary JSON project data, so a
  // disable/rekey migration would JSON.stringify the raw CryptoKey (destroying it) and re-encrypt
  // the already-independently-encrypted API-key bytes as if they were plaintext — silently making
  // every stored API key permanently unreadable. This is the regression test for that bug.
  it('does not corrupt a stored provider API key while rekeying then disabling encryption', async () => {
    await setupIdbEncryption('test-fixture-original-passphrase');
    await dbService.saveApiKey('openai', 'sk-test-should-survive-migration');
    expect(await dbService.getApiKey('openai')).toBe('sk-test-should-survive-migration');

    await rotateIdbPassphrase('test-fixture-original-passphrase', 'test-fixture-new-passphrase');
    expect(await dbService.getApiKey('openai')).toBe('sk-test-should-survive-migration');

    await clearIdbPassphrase();
    expect(await dbService.getApiKey('openai')).toBe('sk-test-should-survive-migration');
  });
});

describe('resumeEncryptionMigration (recovery UX)', () => {
  function readCurrentSaltForTest(): Uint8Array {
    const stored = localStorageMock.getItem('worldscript-idb-kdf-salt-v1');
    if (!stored) throw new Error('No salt found — call setupIdbEncryption first');
    return Uint8Array.from(atob(stored), (character) => character.charCodeAt(0));
  }

  async function buildPendingRekeyJournal(targetPassphrase: string) {
    const salt = readCurrentSaltForTest();
    const targetKey = await svc.deriveKey(targetPassphrase, salt);
    const targetVerifier = await createIdbMigrationTargetVerifier(targetKey);
    const { getRegisteredPrimaryProtectedStoreAdapters } = await import(
      '../../../services/storage/primaryProtectedStoreAdapters'
    );
    const { getRegisteredSecondaryProtectedStoreAdapters } = await import(
      '../../../services/storage/secondaryProtectedStoreAdapters'
    );
    const adapters = [
      ...getRegisteredPrimaryProtectedStoreAdapters(),
      ...getRegisteredSecondaryProtectedStoreAdapters(),
    ];
    return beginEncryptionMigration({
      operationId: `recovery-test-${Math.random().toString(36).slice(2)}`,
      operation: 'rekey',
      phase: 'prepared',
      targetVerifier,
      stores: adapters.map((adapter) => ({
        id: adapter.id,
        processed: 0,
        verified: 0,
        done: false,
      })),
    });
  }

  it('re-derives keys from passphrases and completes a pending rekey journal', async () => {
    await setupIdbEncryption('test-fixture-original-passphrase');
    await dbService.saveImage('recovery-img-2', 'recovery-content-2');
    const journal = await buildPendingRekeyJournal('test-fixture-new-passphrase');
    clearIdbEncryptionKey();

    try {
      await expect(
        resumeEncryptionMigration(journal, {
          sourcePassphrase: 'test-fixture-original-passphrase',
          targetPassphrase: 'test-fixture-new-passphrase',
        }),
      ).resolves.toBeUndefined();

      expect(isIdbEncryptionReady()).toBe(true);
      expect(await dbService.getImage('recovery-img-2')).toBe('recovery-content-2');

      clearIdbEncryptionKey();
      await expect(
        verifyAndInitIdbEncryption('test-fixture-new-passphrase'),
      ).resolves.toBeUndefined();
    } finally {
      await deleteJournalRecordForTest();
    }
  });

  it('rejects a wrong source passphrase without mutating the journal or sentinel', async () => {
    await setupIdbEncryption('test-fixture-original-passphrase');
    const journal = await buildPendingRekeyJournal('test-fixture-new-passphrase');
    clearIdbEncryptionKey();

    try {
      // QNBS-v3: fails before the journal is ever claimed/advanced — assertNoActiveEncryptionMigration
      // correctly keeps rejecting other operations until this still-'prepared' journal is resolved,
      // by design (it doesn't know the resume attempt failed on key derivation, not on the migration).
      await expect(
        resumeEncryptionMigration(journal, {
          sourcePassphrase: 'wrong',
          targetPassphrase: 'test-fixture-new-passphrase',
        }),
      ).rejects.toThrow();
      expect(await hasPassphraseSentinel()).toBe(true);
    } finally {
      await deleteJournalRecordForTest();
    }

    clearIdbEncryptionKey();
    await expect(
      verifyAndInitIdbEncryption('test-fixture-original-passphrase'),
    ).resolves.toBeUndefined();
  });

  it('rejects a resume attempt missing the target passphrase for a rekey operation', async () => {
    await setupIdbEncryption('test-fixture-original-passphrase');
    const journal = await buildPendingRekeyJournal('test-fixture-new-passphrase');
    clearIdbEncryptionKey();

    try {
      await expect(
        resumeEncryptionMigration(journal, {
          sourcePassphrase: 'test-fixture-original-passphrase',
        }),
      ).rejects.toThrow('new passphrase is required');
    } finally {
      await deleteJournalRecordForTest();
    }
  });

  // QNBS-v3 (CodeAnt/CodeRabbit/qodo #342): a journal already at 'committing' means every store's
  // data migration is done and verified — only the commitDisableMigration/commitRekeyMigration
  // bookkeeping (sentinel/salt mutation + journal completion) remains. If a PRIOR commit attempt
  // crashed partway through that bookkeeping, the sentinel it mutates may already reflect the
  // post-commit state (deleted for disable, replaced for rekey) — these tests cover both the
  // not-yet-committed and partially-committed sub-states for each operation.
  describe('resuming a journal already at the committing phase (interrupted commit)', () => {
    it('disable: finishes the journal without a passphrase when the sentinel is already gone', async () => {
      await setupIdbEncryption('test-fixture-original-passphrase');
      const journal = await beginEncryptionMigration({
        operationId: 'committing-disable-gone',
        operation: 'disable',
        phase: 'committing',
        stores: [],
      });
      // Simulate a crash inside commitDisableMigration: sentinel already deleted, journal not yet completed.
      await sentinelModule.deletePassphraseSentinel();
      clearIdbEncryptionKey();

      try {
        await expect(
          resumeEncryptionMigration(journal, { sourcePassphrase: 'irrelevant-already-gone' }),
        ).resolves.toBeUndefined();
        expect(await hasPassphraseSentinel()).toBe(false);
      } finally {
        await deleteJournalRecordForTest();
      }
    });

    it('disable: verifies the passphrase and commits normally when commit never started', async () => {
      await setupIdbEncryption('test-fixture-original-passphrase');
      const journal = await beginEncryptionMigration({
        operationId: 'committing-disable-fresh',
        operation: 'disable',
        phase: 'committing',
        stores: [],
      });
      clearIdbEncryptionKey();

      try {
        expect(await hasPassphraseSentinel()).toBe(true);
        await expect(
          resumeEncryptionMigration(journal, {
            sourcePassphrase: 'test-fixture-original-passphrase',
          }),
        ).resolves.toBeUndefined();
        expect(await hasPassphraseSentinel()).toBe(false);
      } finally {
        await deleteJournalRecordForTest();
      }
    });

    it('disable: rejects a wrong passphrase when the sentinel is still present', async () => {
      await setupIdbEncryption('test-fixture-original-passphrase');
      const journal = await beginEncryptionMigration({
        operationId: 'committing-disable-wrongpass',
        operation: 'disable',
        phase: 'committing',
        stores: [],
      });
      clearIdbEncryptionKey();

      try {
        await expect(
          resumeEncryptionMigration(journal, { sourcePassphrase: 'wrong' }),
        ).rejects.toThrow();
        expect(await hasPassphraseSentinel()).toBe(true);
      } finally {
        await deleteJournalRecordForTest();
      }
    });

    it('rekey: finishes via the target verifier when the sentinel already reflects the new passphrase', async () => {
      await setupIdbEncryption('test-fixture-original-passphrase');
      const salt = readCurrentSaltForTest();
      const targetKey = await svc.deriveKey('test-fixture-new-passphrase', salt);
      const targetVerifier = await createIdbMigrationTargetVerifier(targetKey);
      const journal = await beginEncryptionMigration({
        operationId: 'committing-rekey-replaced',
        operation: 'rekey',
        phase: 'committing',
        targetVerifier,
        stores: [],
      });
      // Simulate a crash inside commitRekeyMigration: new sentinel already saved, journal not yet completed.
      const newSentinel = await svc.encrypt(targetKey, { v: 1 });
      await sentinelModule.savePassphraseSentinel(newSentinel.bytes);
      clearIdbEncryptionKey();

      try {
        await expect(
          resumeEncryptionMigration(journal, {
            sourcePassphrase: 'test-fixture-original-passphrase',
            targetPassphrase: 'test-fixture-new-passphrase',
          }),
        ).resolves.toBeUndefined();

        clearIdbEncryptionKey();
        await expect(
          verifyAndInitIdbEncryption('test-fixture-new-passphrase'),
        ).resolves.toBeUndefined();
      } finally {
        await deleteJournalRecordForTest();
      }
    });

    it('rekey: verifies the old passphrase and commits normally when commit never started', async () => {
      await setupIdbEncryption('test-fixture-original-passphrase');
      const salt = readCurrentSaltForTest();
      const targetKey = await svc.deriveKey('test-fixture-new-passphrase', salt);
      const targetVerifier = await createIdbMigrationTargetVerifier(targetKey);
      const journal = await beginEncryptionMigration({
        operationId: 'committing-rekey-fresh',
        operation: 'rekey',
        phase: 'committing',
        targetVerifier,
        stores: [],
      });
      clearIdbEncryptionKey();

      try {
        await expect(
          resumeEncryptionMigration(journal, {
            sourcePassphrase: 'test-fixture-original-passphrase',
            targetPassphrase: 'test-fixture-new-passphrase',
          }),
        ).resolves.toBeUndefined();

        clearIdbEncryptionKey();
        await expect(
          verifyAndInitIdbEncryption('test-fixture-new-passphrase'),
        ).resolves.toBeUndefined();
      } finally {
        await deleteJournalRecordForTest();
      }
    });

    it('rekey: rejects when neither the old nor new passphrase matches the current sentinel', async () => {
      await setupIdbEncryption('test-fixture-original-passphrase');
      const salt = readCurrentSaltForTest();
      const targetKey = await svc.deriveKey('test-fixture-new-passphrase', salt);
      const targetVerifier = await createIdbMigrationTargetVerifier(targetKey);
      const journal = await beginEncryptionMigration({
        operationId: 'committing-rekey-wrongboth',
        operation: 'rekey',
        phase: 'committing',
        targetVerifier,
        stores: [],
      });
      clearIdbEncryptionKey();

      try {
        await expect(
          resumeEncryptionMigration(journal, {
            sourcePassphrase: 'test-fixture-wrong-old-passphrase',
            targetPassphrase: 'test-fixture-wrong-new-passphrase',
          }),
        ).rejects.toThrow();
        // QNBS-v3: the recovery failed — the journal must remain resumable and the sentinel unchanged, matching the disable counterpart's assertion above.
        expect(await hasPassphraseSentinel()).toBe(true);
      } finally {
        await deleteJournalRecordForTest();
      }
    });
  });
});
