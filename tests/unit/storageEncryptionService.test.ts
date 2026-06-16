// @vitest-environment jsdom
/**
 * Unit tests for services/storage/storageEncryptionService.ts (B-1)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock idbPassphraseSentinel so sentinel-backed functions don't need real IDB
// vi.hoisted ensures these variables are available when vi.mock factory runs
// ---------------------------------------------------------------------------

const { mockSaveSentinel, mockGetSentinel, mockDeleteSentinel } = vi.hoisted(() => ({
  mockSaveSentinel: vi.fn<(bytes: Uint8Array) => Promise<void>>().mockResolvedValue(undefined),
  mockGetSentinel: vi.fn<() => Promise<Uint8Array | null>>().mockResolvedValue(null),
  mockDeleteSentinel: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock('../../services/storage/idbPassphraseSentinel', () => ({
  savePassphraseSentinel: (...args: Parameters<typeof mockSaveSentinel>) =>
    mockSaveSentinel(...args),
  getPassphraseSentinel: () => mockGetSentinel(),
  deletePassphraseSentinel: () => mockDeleteSentinel(),
}));

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
} from '../../services/storage/storageEncryptionService';

describe('StorageEncryptionService (class)', () => {
  const svc = new StorageEncryptionService();

  const makeSalt = () => crypto.getRandomValues(new Uint8Array(32));

  it('deriveKey returns a non-extractable AES-GCM CryptoKey', async () => {
    const key = await svc.deriveKey('hello', makeSalt());
    expect(key.type).toBe('secret');
    expect(key.extractable).toBe(false);
    expect(key.algorithm.name).toBe('AES-GCM');
  });

  it('encrypt produces sentinel-prefixed output longer than plaintext', async () => {
    const salt = makeSalt();
    const key = await svc.deriveKey('pass', salt);
    const blob = await svc.encrypt(key, { hello: 'world' });
    expect(blob.bytes).toBeInstanceOf(Uint8Array);
    // sentinel(6) + iv(12) + at least ciphertext > 0
    expect(blob.bytes.length).toBeGreaterThan(18);
    // Sentinel bytes
    expect(blob.bytes[0]).toBe(0x00);
    expect(blob.bytes[1]).toBe(0x65); // 'e'
    expect(blob.bytes[2]).toBe(0x6e); // 'n'
    expect(blob.bytes[3]).toBe(0x63); // 'c'
  });

  it('encrypt → decrypt roundtrips correctly', async () => {
    const salt = makeSalt();
    const key = await svc.deriveKey('correctHorseBatteryStaple', salt);
    const original = { title: 'My Story', words: 12345 };
    const blob = await svc.encrypt(key, original);
    const recovered = await svc.decrypt(key, blob);
    expect(recovered).toEqual(original);
  });

  it('decrypt throws on wrong key', async () => {
    const salt = makeSalt();
    const rightKey = await svc.deriveKey('right', salt);
    const wrongKey = await svc.deriveKey('wrong', salt);
    const blob = await svc.encrypt(rightKey, 'secret');
    await expect(svc.decrypt(wrongKey, blob)).rejects.toThrow();
  });

  it('decrypt throws on sentinel mismatch', async () => {
    const salt = makeSalt();
    const key = await svc.deriveKey('pass', salt);
    const fakeBlob = { bytes: new Uint8Array(30) };
    await expect(svc.decrypt(key, fakeBlob)).rejects.toThrow('sentinel mismatch');
  });

  it('decrypt throws when blob is too short', async () => {
    const salt = makeSalt();
    const key = await svc.deriveKey('pass', salt);
    await expect(svc.decrypt(key, { bytes: new Uint8Array(3) })).rejects.toThrow('too short');
  });

  it('two encryptions of same data produce different ciphertexts (random IV)', async () => {
    const salt = makeSalt();
    const key = await svc.deriveKey('pass', salt);
    const b1 = await svc.encrypt(key, 'hello');
    const b2 = await svc.encrypt(key, 'hello');
    expect(b1.bytes).not.toEqual(b2.bytes);
  });
});

describe('Module-level singleton API', () => {
  beforeEach(() => {
    clearIdbEncryptionKey();
    // Use a fixed localStorage key to avoid cross-test salt conflicts
    localStorage.setItem(
      'worldscript-idb-kdf-salt-v1',
      // deterministic base64 salt (32 bytes of 0x01)
      btoa(String.fromCharCode(...new Array(32).fill(1))),
    );
  });

  afterEach(() => {
    clearIdbEncryptionKey();
    localStorage.clear();
  });

  it('isIdbEncryptionReady returns false before init', () => {
    expect(isIdbEncryptionReady()).toBe(false);
  });

  it('isIdbEncryptionReady returns true after initIdbEncryption', async () => {
    await initIdbEncryption('my-passphrase');
    expect(isIdbEncryptionReady()).toBe(true);
  });

  it('clearIdbEncryptionKey resets ready state', async () => {
    await initIdbEncryption('my-passphrase');
    clearIdbEncryptionKey();
    expect(isIdbEncryptionReady()).toBe(false);
  });

  it('initIdbEncryption throws on empty passphrase', async () => {
    await expect(initIdbEncryption('')).rejects.toThrow('Passphrase must not be empty');
  });

  it('idbEncrypt/idbDecrypt roundtrip', async () => {
    await initIdbEncryption('my-passphrase');
    const data = { manuscript: 'Once upon a time…' };
    const encrypted = await idbEncrypt(data);
    const decrypted = await idbDecrypt<typeof data>(encrypted);
    expect(decrypted).toEqual(data);
  });

  it('idbEncrypt throws when not initialised', async () => {
    await expect(idbEncrypt('test')).rejects.toThrow('not initialised');
  });

  it('idbDecrypt throws when not initialised', async () => {
    await expect(idbDecrypt(new Uint8Array(30))).rejects.toThrow('not initialised');
  });

  it('isEncryptedBlob returns false for plain Uint8Array', () => {
    expect(isEncryptedBlob(new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]))).toBe(false);
  });

  it('isEncryptedBlob returns true for encrypted output', async () => {
    await initIdbEncryption('my-passphrase');
    const bytes = await idbEncrypt('test');
    expect(isEncryptedBlob(bytes)).toBe(true);
  });

  it('isEncryptedBlob returns false for non-Uint8Array', () => {
    expect(isEncryptedBlob('not bytes')).toBe(false);
    expect(isEncryptedBlob(null)).toBe(false);
    expect(isEncryptedBlob(42)).toBe(false);
  });

  it('same passphrase + same salt produces consistent decryption', async () => {
    await initIdbEncryption('consistent-pass');
    const bytes = await idbEncrypt({ chapter: 1 });
    // Re-init with same passphrase (same salt from localStorage)
    await initIdbEncryption('consistent-pass');
    const result = await idbDecrypt<{ chapter: number }>(bytes);
    expect(result.chapter).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Sentinel-backed API (setupIdbEncryption / verifyAndInitIdbEncryption / etc.)
// ---------------------------------------------------------------------------

describe('Sentinel-backed API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearIdbEncryptionKey();
    // deterministic salt (32 bytes of 0x01)
    localStorage.setItem(
      'worldscript-idb-kdf-salt-v1',
      btoa(String.fromCharCode(...new Array(32).fill(1))),
    );
    mockGetSentinel.mockResolvedValue(null);
    mockSaveSentinel.mockResolvedValue(undefined);
    mockDeleteSentinel.mockResolvedValue(undefined);
  });

  afterEach(() => {
    clearIdbEncryptionKey();
    localStorage.clear();
  });

  // ── setupIdbEncryption ────────────────────────────────────────────────────

  it('setupIdbEncryption saves a sentinel and sets the key ready', async () => {
    await setupIdbEncryption('correct-horse');
    expect(mockSaveSentinel).toHaveBeenCalledTimes(1);
    expect(mockSaveSentinel.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array);
    expect(isIdbEncryptionReady()).toBe(true);
  });

  it('setupIdbEncryption throws on empty passphrase', async () => {
    await expect(setupIdbEncryption('')).rejects.toThrow('Passphrase must not be empty');
  });

  // ── verifyAndInitIdbEncryption ────────────────────────────────────────────

  it('verifyAndInitIdbEncryption succeeds with the correct passphrase', async () => {
    // First set up so a sentinel is stored
    await setupIdbEncryption('my-secret');
    // Retrieve the sentinel bytes that were saved
    const savedBytes = mockSaveSentinel.mock.calls[0]?.[0] as Uint8Array;
    clearIdbEncryptionKey();

    // Make getPassphraseSentinel return the stored bytes
    mockGetSentinel.mockResolvedValue(savedBytes);
    await verifyAndInitIdbEncryption('my-secret');
    expect(isIdbEncryptionReady()).toBe(true);
  });

  it('verifyAndInitIdbEncryption throws with the wrong passphrase', async () => {
    await setupIdbEncryption('correct');
    const savedBytes = mockSaveSentinel.mock.calls[0]?.[0] as Uint8Array;
    clearIdbEncryptionKey();

    mockGetSentinel.mockResolvedValue(savedBytes);
    await expect(verifyAndInitIdbEncryption('wrong')).rejects.toThrow();
    expect(isIdbEncryptionReady()).toBe(false);
  });

  it('verifyAndInitIdbEncryption throws when no sentinel exists', async () => {
    mockGetSentinel.mockResolvedValue(null);
    await expect(verifyAndInitIdbEncryption('any')).rejects.toThrow('No passphrase sentinel found');
  });

  it('verifyAndInitIdbEncryption throws on empty passphrase', async () => {
    await expect(verifyAndInitIdbEncryption('')).rejects.toThrow('Passphrase must not be empty');
  });

  // ── hasPassphraseSentinel ─────────────────────────────────────────────────

  it('hasPassphraseSentinel returns false when no sentinel is stored', async () => {
    mockGetSentinel.mockResolvedValue(null);
    expect(await hasPassphraseSentinel()).toBe(false);
  });

  it('hasPassphraseSentinel returns true when a sentinel is stored', async () => {
    mockGetSentinel.mockResolvedValue(new Uint8Array(30));
    expect(await hasPassphraseSentinel()).toBe(true);
  });

  // ── clearIdbPassphrase ────────────────────────────────────────────────────

  it('clearIdbPassphrase deletes the sentinel and clears the active key', async () => {
    await setupIdbEncryption('pass');
    expect(isIdbEncryptionReady()).toBe(true);

    await clearIdbPassphrase();
    expect(mockDeleteSentinel).toHaveBeenCalledTimes(1);
    expect(isIdbEncryptionReady()).toBe(false);
  });

  // ── rotateIdbPassphrase ───────────────────────────────────────────────────

  it('rotateIdbPassphrase fails with wrong old passphrase', async () => {
    await setupIdbEncryption('original');
    const savedBytes = mockSaveSentinel.mock.calls[0]?.[0] as Uint8Array;
    clearIdbEncryptionKey();

    mockGetSentinel.mockResolvedValue(savedBytes);
    await expect(rotateIdbPassphrase('wrong-old', 'new-pass')).rejects.toThrow();
  });

  it('rotateIdbPassphrase replaces sentinel and activates new key', async () => {
    await setupIdbEncryption('original');
    const firstSentinel = mockSaveSentinel.mock.calls[0]?.[0] as Uint8Array;
    clearIdbEncryptionKey();

    // verifyAndInitIdbEncryption will read firstSentinel; setupIdbEncryption will write a new one
    mockGetSentinel.mockResolvedValue(firstSentinel);
    mockSaveSentinel.mockClear();

    await rotateIdbPassphrase('original', 'new-pass');

    // A new sentinel was written
    expect(mockSaveSentinel).toHaveBeenCalledTimes(1);
    // The new sentinel is different from the first (new key, random IV)
    const newSentinel = mockSaveSentinel.mock.calls[0]?.[0] as Uint8Array;
    expect(newSentinel).not.toEqual(firstSentinel);
    expect(isIdbEncryptionReady()).toBe(true);
  });
});
