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

import {
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
  hasPassphraseSentinel,
  IdbEncryptionMigrationRequiredError,
  IdbEncryptionSaltLostError,
  IdbStorageLockedError,
  idbDecrypt,
  idbEncrypt,
  idbEncryptWithKey,
  initIdbEncryption,
  isEncryptedBlob,
  isIdbEncryptionReady,
  isSecureRecordEnvelope,
  prepareSecureRecordPayload,
  readSecureRecordPayload,
  resolveProtectedWriteKey,
  rotateIdbPassphrase,
  SECURE_RECORD_VERSION,
  SecureRecordCorruptError,
  SecureRecordLockedError,
  StorageEncryptionService,
  setupIdbEncryption,
  verifyAndInitIdbEncryption,
} from '../../../services/storage/storageEncryptionService';

const svc = new StorageEncryptionService();

async function freshKey(passphrase = 'test-pass'): Promise<CryptoKey> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  return svc.deriveKey(passphrase, salt);
}

beforeEach(async () => {
  localStorageMock.clear();
  clearIdbEncryptionKey();
  // QNBS-v3: the sentinel store is a module singleton with a cached connection — clear its record
  //          between tests so sentinel-presence assertions start from a clean slate.
  await sentinelModule.deletePassphraseSentinel();
});

afterEach(() => {
  clearIdbEncryptionKey();
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

  it('preserves the sentinel when an unsafe disable is requested', async () => {
    await setupIdbEncryption('pass');
    await expect(clearIdbPassphrase()).rejects.toBeInstanceOf(IdbEncryptionMigrationRequiredError);
    expect(await hasPassphraseSentinel()).toBe(true);
  });
});

describe('clearIdbPassphrase', () => {
  it('fails closed without deleting the sentinel or clearing the active key', async () => {
    await setupIdbEncryption('pass');
    expect(isIdbEncryptionReady()).toBe(true);
    await expect(clearIdbPassphrase()).rejects.toBeInstanceOf(IdbEncryptionMigrationRequiredError);
    expect(isIdbEncryptionReady()).toBe(true);
    expect(await hasPassphraseSentinel()).toBe(true);
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
  it('fails closed until a resumable migration journal is available', async () => {
    await setupIdbEncryption('old');
    await expect(rotateIdbPassphrase('old', 'new')).rejects.toBeInstanceOf(
      IdbEncryptionMigrationRequiredError,
    );
    expect(isIdbEncryptionReady()).toBe(true);
    clearIdbEncryptionKey();
    await verifyAndInitIdbEncryption('old');
    expect(isIdbEncryptionReady()).toBe(true);
  });

  it('does not replace the verifier when passed a wrong old passphrase', async () => {
    await setupIdbEncryption('old');
    await expect(rotateIdbPassphrase('wrong', 'new')).rejects.toBeInstanceOf(
      IdbEncryptionMigrationRequiredError,
    );
    clearIdbEncryptionKey();
    await expect(verifyAndInitIdbEncryption('old')).resolves.toBeUndefined();
  });
});
