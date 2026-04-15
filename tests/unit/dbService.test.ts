import { describe, it, expect, vi, beforeEach } from 'vitest';

// NOTE: dbService relies heavily on IndexedDB + Web Crypto which are limited in jsdom.
// These tests cover the module structure and exportable logic.
// Full integration tests for encryption/compression need a browser environment.

// Mock IndexedDB for import
const mockOpen = vi.fn().mockReturnValue({
  onsuccess: null,
  onerror: null,
  onupgradeneeded: null,
  result: {
    transaction: vi.fn().mockReturnValue({
      objectStore: vi.fn().mockReturnValue({
        put: vi.fn().mockReturnValue({ onsuccess: null, onerror: null }),
        get: vi.fn().mockReturnValue({ onsuccess: null, onerror: null }),
        delete: vi.fn().mockReturnValue({ onsuccess: null, onerror: null }),
        getAll: vi.fn().mockReturnValue({ onsuccess: null, onerror: null }),
      }),
    }),
    onversionchange: null,
    close: vi.fn(),
    objectStoreNames: { contains: vi.fn().mockReturnValue(true) },
  },
});

Object.defineProperty(window, 'indexedDB', {
  writable: true,
  value: { open: mockOpen },
});

// Mock Web Crypto API (minimal for import)
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    writable: true,
    value: {
      subtle: {
        digest: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
        importKey: vi.fn().mockResolvedValue({}),
        encrypt: vi.fn().mockResolvedValue(new ArrayBuffer(16)),
        decrypt: vi.fn().mockResolvedValue(new ArrayBuffer(16)),
      },
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
        return arr;
      },
    },
  });
}

describe('dbService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dbService: Record<string, any>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../services/dbService');
    dbService = mod.dbService;
  });

  it('should export dbService singleton', () => {
    expect(dbService).toBeDefined();
  });

  it('should have initDB method', () => {
    expect(typeof dbService.initDB).toBe('function');
  });

  it('should have key management methods', () => {
    expect(typeof dbService.saveGeminiApiKey).toBe('function');
    expect(typeof dbService.getGeminiApiKey).toBe('function');
    expect(typeof dbService.hasGeminiApiKey).toBe('function');
    expect(typeof dbService.clearGeminiApiKey).toBe('function');
  });

  it('should have generic API key methods', () => {
    expect(typeof dbService.saveApiKey).toBe('function');
    expect(typeof dbService.getApiKey).toBe('function');
    expect(typeof dbService.clearApiKey).toBe('function');
  });

  it('should have project/settings save methods', () => {
    expect(typeof dbService.saveSlice).toBe('function');
    expect(typeof dbService.saveProject).toBe('function');
    expect(typeof dbService.saveSettings).toBe('function');
  });

  it('should have snapshot methods', () => {
    expect(typeof dbService.saveSnapshot).toBe('function');
    expect(typeof dbService.listSnapshots).toBe('function');
    expect(typeof dbService.deleteSnapshot).toBe('function');
  });

  it('should have image methods', () => {
    expect(typeof dbService.saveImage).toBe('function');
    expect(typeof dbService.getImage).toBe('function');
    expect(typeof dbService.deleteImage).toBe('function');
  });

  describe('DECRYPT_FAILED behavior', () => {
    it('hasGeminiApiKey should filter DECRYPT_FAILED', async () => {
      // Mock getGeminiApiKey to return DECRYPT_FAILED
      const originalGet = dbService.getGeminiApiKey;
      dbService.getGeminiApiKey = vi.fn().mockResolvedValue('DECRYPT_FAILED');

      const result = await dbService.hasGeminiApiKey();
      expect(result).toBe(false);

      dbService.getGeminiApiKey = originalGet;
    });

    it('hasGeminiApiKey should return true for valid key', async () => {
      const originalGet = dbService.getGeminiApiKey;
      dbService.getGeminiApiKey = vi.fn().mockResolvedValue('AIzaSy_valid_key');

      const result = await dbService.hasGeminiApiKey();
      expect(result).toBe(true);

      dbService.getGeminiApiKey = originalGet;
    });

    it('hasGeminiApiKey should return false for null', async () => {
      const originalGet = dbService.getGeminiApiKey;
      dbService.getGeminiApiKey = vi.fn().mockResolvedValue(null);

      const result = await dbService.hasGeminiApiKey();
      expect(result).toBe(false);

      dbService.getGeminiApiKey = originalGet;
    });
  });
});
