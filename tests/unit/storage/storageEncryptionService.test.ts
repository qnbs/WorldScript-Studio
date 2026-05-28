// @vitest-environment jsdom
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

import {
  clearIdbEncryptionKey,
  idbDecrypt,
  idbEncrypt,
  initIdbEncryption,
  isEncryptedBlob,
  isIdbEncryptionReady,
  StorageEncryptionService,
} from '../../../services/storage/storageEncryptionService';

const svc = new StorageEncryptionService();

async function freshKey(passphrase = 'test-pass'): Promise<CryptoKey> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  return svc.deriveKey(passphrase, salt);
}

beforeEach(() => {
  localStorageMock.clear();
  clearIdbEncryptionKey();
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
