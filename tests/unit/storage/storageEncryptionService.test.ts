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
  clearIdbEncryptionKey,
  clearIdbPassphrase,
  hasPassphraseSentinel,
  idbDecrypt,
  idbEncrypt,
  initIdbEncryption,
  isEncryptedBlob,
  isIdbEncryptionReady,
  rotateIdbPassphrase,
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
  await clearIdbPassphrase();
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
    expect(localStorageMock.getItem('storycraft-idb-kdf-salt-v1')).not.toBeNull();
  });

  it('reuses existing salt from localStorage', async () => {
    await initIdbEncryption('pass');
    const salt1 = localStorageMock.getItem('storycraft-idb-kdf-salt-v1');
    clearIdbEncryptionKey();
    await initIdbEncryption('pass');
    const salt2 = localStorageMock.getItem('storycraft-idb-kdf-salt-v1');
    expect(salt1).toBe(salt2);
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

  it('returns false after clearIdbPassphrase', async () => {
    await setupIdbEncryption('pass');
    await clearIdbPassphrase();
    expect(await hasPassphraseSentinel()).toBe(false);
  });
});

describe('clearIdbPassphrase', () => {
  it('deletes sentinel and clears active key', async () => {
    await setupIdbEncryption('pass');
    expect(isIdbEncryptionReady()).toBe(true);
    await clearIdbPassphrase();
    expect(isIdbEncryptionReady()).toBe(false);
    expect(await hasPassphraseSentinel()).toBe(false);
  });
});

describe('rotateIdbPassphrase', () => {
  it('changes passphrase and keeps encryption active', async () => {
    await setupIdbEncryption('old');
    await rotateIdbPassphrase('old', 'new');
    expect(isIdbEncryptionReady()).toBe(true);
    // Verify new passphrase works
    clearIdbEncryptionKey();
    await verifyAndInitIdbEncryption('new');
    expect(isIdbEncryptionReady()).toBe(true);
  });

  it('throws on wrong old passphrase', async () => {
    await setupIdbEncryption('old');
    await expect(rotateIdbPassphrase('wrong', 'new')).rejects.toThrow();
  });

  it('new passphrase can encrypt/decrypt data', async () => {
    await setupIdbEncryption('old');
    await rotateIdbPassphrase('old', 'new');
    const payload = { test: 'data' };
    const encrypted = await idbEncrypt(payload);
    const decrypted = await idbDecrypt<typeof payload>(encrypted);
    expect(decrypted).toEqual(payload);
  });

  it('calls reEncrypt callback with old and new keys', async () => {
    await setupIdbEncryption('old');
    const mockReEncrypt = vi.fn().mockResolvedValue(undefined);
    await rotateIdbPassphrase('old', 'new', mockReEncrypt);
    expect(mockReEncrypt).toHaveBeenCalledTimes(1);
    const [oldKey, newKey] = mockReEncrypt.mock.calls[0] as [CryptoKey, CryptoKey];
    expect(oldKey).toBeInstanceOf(CryptoKey);
    expect(newKey).toBeInstanceOf(CryptoKey);
    expect(oldKey).not.toBe(newKey);
  });
});
