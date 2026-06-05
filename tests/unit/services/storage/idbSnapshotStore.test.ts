/**
 * Tests for idbSnapshotStore.ts — Snapshot CRUD operations.
 * QNBS-v3: P1 tests for uncovered code paths.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdbSnapshotStore } from '../../../../services/storage/idbSnapshotStore';

// Mock IndexedDB
const mockStore = {
  add: vi.fn(),
  openCursor: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  clear: vi.fn(),
};

// Mock the dependencies
vi.mock('../../../../services/storage/idbCore', () => ({
  compressData: (data: unknown) => data,
  decompressData: (data: unknown) => data,
  getUserFriendlyDbError: (err: unknown) => String(err),
  retryDb: async (fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../../../../services/storage/storageEncryptionService', () => ({
  idbEncrypt: async (data: unknown) => data,
  idbDecrypt: async (data: unknown) => data,
  isIdbEncryptionReady: () => false,
  isEncryptedBlob: () => false,
}));

vi.mock('../../../../services/dbConstants', () => ({
  SNAPSHOTS_STORE: 'snapshots',
}));

vi.mock('../../../../services/storage/idbCodexStore', () => ({
  IdbCodexStore: class {
    protected getObjectStore = vi.fn().mockResolvedValue(mockStore);
  },
}));

describe('IdbSnapshotStore', () => {
  let store: IdbSnapshotStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new IdbSnapshotStore();
  });

  describe('createSnapshot', () => {
    it('creates snapshot with default name', async () => {
      const mockRequest = {
        result: 1,
        error: null,
        onsuccess: null as (() => void) | null,
        onerror: null as ((err: unknown) => void) | null,
      };
      mockStore.add.mockImplementation(() => {
        setTimeout(() => mockRequest.onsuccess?.(), 0);
        return mockRequest;
      });

      const result = await store.createSnapshot({
        manuscript: [],
        title: 'Test',
        logline: '',
        characters: { ids: [], entities: {} },
        worlds: { ids: [], entities: {} },
        outline: [],
      });
      expect(result).toBe(1);
    });

    it('creates snapshot with custom name', async () => {
      const mockRequest = {
        result: 2,
        error: null,
        onsuccess: null as (() => void) | null,
        onerror: null as ((err: unknown) => void) | null,
      };
      mockStore.add.mockImplementation(() => {
        setTimeout(() => mockRequest.onsuccess?.(), 0);
        return mockRequest;
      });

      const result = await store.saveSnapshot('My Snapshot', {
        manuscript: [],
        title: 'Test',
        logline: '',
        characters: { ids: [], entities: {} },
        worlds: { ids: [], entities: {} },
        outline: [],
      });
      expect(result).toBe(2);
    });
  });

  describe('listSnapshots', () => {
    it('returns empty array when no snapshots exist', async () => {
      const mockRequest = {
        result: null,
        error: null,
        onsuccess: null as (() => void) | null,
      };
      mockStore.openCursor.mockReturnValue(mockRequest);

      // Simulate cursor end
      setTimeout(() => {
        mockRequest.onsuccess?.();
      }, 0);

      const result = await store.listSnapshots();
      expect(result).toEqual([]);
    });
  });
});
