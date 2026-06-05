/**
 * Tests for duckdbEncryption.ts — DuckDB OPFS encryption layer.
 * QNBS-v3: P1 tests for P0-4 DuckDB encryption.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the storageEncryptionService
vi.mock('../../../../services/storage/storageEncryptionService', () => ({
  initIdbEncryption: vi.fn().mockResolvedValue(undefined),
  idbEncrypt: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  idbDecrypt: vi.fn().mockResolvedValue({ test: 'data' }),
}));

describe('duckdbEncryption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initDuckDbEncryption', () => {
    it('calls initIdbEncryption with the passphrase', async () => {
      const { initDuckDbEncryption } = await import('../../../../services/duckdb/duckdbEncryption');
      const { initIdbEncryption } = await import(
        '../../../../services/storage/storageEncryptionService'
      );
      await initDuckDbEncryption('test-passphrase');
      expect(initIdbEncryption).toHaveBeenCalledWith('test-passphrase');
    });
  });

  describe('encryptDuckDbData', () => {
    it('delegates to idbEncrypt', async () => {
      const { encryptDuckDbData } = await import('../../../../services/duckdb/duckdbEncryption');
      const { idbEncrypt } = await import('../../../../services/storage/storageEncryptionService');
      const result = await encryptDuckDbData({ key: 'value' });
      expect(idbEncrypt).toHaveBeenCalledWith({ key: 'value' });
      expect(result).toBeInstanceOf(Uint8Array);
    });
  });

  describe('decryptDuckDbData', () => {
    it('delegates to idbDecrypt', async () => {
      const { decryptDuckDbData } = await import('../../../../services/duckdb/duckdbEncryption');
      const { idbDecrypt } = await import('../../../../services/storage/storageEncryptionService');
      const result = await decryptDuckDbData(new Uint8Array([1, 2, 3]));
      expect(idbDecrypt).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
      expect(result).toEqual({ test: 'data' });
    });
  });

  describe('clearDuckDbEncryptionKey', () => {
    it('clears the encryption key reference', async () => {
      const { initDuckDbEncryption, clearDuckDbEncryptionKey, getDuckDbEncryptionKey } =
        await import('../../../../services/duckdb/duckdbEncryption');
      await initDuckDbEncryption('test-passphrase');
      clearDuckDbEncryptionKey();
      expect(getDuckDbEncryptionKey()).toBeNull();
    });
  });

  describe('reEncryptDuckDbFiles', () => {
    it('is a placeholder function (no-op)', async () => {
      const { reEncryptDuckDbFiles } = await import('../../../../services/duckdb/duckdbEncryption');
      // Should not throw - it's a placeholder
      await expect(
        reEncryptDuckDbFiles({} as CryptoKey, {} as CryptoKey, ['/path/to/file']),
      ).resolves.toBeUndefined();
    });
  });
});
