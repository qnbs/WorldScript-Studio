/**
 * Tests for idbAssetStore.ts — saveImage/getImage/deleteImage + binder asset CRUD.
 * QNBS-v3: Uncovered storage branch coverage.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdbAssetStore } from '../../../../services/storage/idbAssetStore';

// ── IDB mock store ────────────────────────────────────────────────────────────

const mockIdbStore = {
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  openCursor: vi.fn(),
};

vi.mock('../../../../services/storage/idbCodexStore', () => ({
  IdbCodexStore: class {
    protected getObjectStore = vi.fn().mockResolvedValue(mockIdbStore);
  },
}));

vi.mock('../../../../services/storage/idbCore', () => ({
  getUserFriendlyDbError: (err: unknown) => String(err),
  retryDb: async (fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../../../../services/storage/storageEncryptionService', () => ({
  idbEncrypt: async (data: unknown) => data,
  idbReadSecure: async (data: unknown) => data,
  isIdbEncryptionReady: () => false,
  isEncryptedBlob: () => false,
}));

vi.mock('../../../../services/dbConstants', () => ({
  IMAGES_STORE: 'images',
  BINDER_ASSETS_STORE: 'binder-assets',
}));

// QNBS-v3: mock matches production contract — sanitize spaces/colons and use :: delimiter
vi.mock('../../../../services/storageBackend', () => ({
  makeBinderAssetIdsPrefix: (projectId: string) =>
    `${projectId.replace(/[\s:]/g, '_').slice(0, 200)}::`,
  makeBinderAssetStorageKey: (projectId: string, assetId: string) =>
    `${projectId.replace(/[\s:]/g, '_').slice(0, 200)}::${assetId}`,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

type MockReq<T> = {
  result: T;
  error: null | DOMException;
  onsuccess: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
};

function makeSuccessReq<T>(result: T): MockReq<T> {
  const req: MockReq<T> = { result, error: null, onsuccess: null, onerror: null };
  setTimeout(() => req.onsuccess?.(), 0);
  return req;
}

function makeErrorReq(err: DOMException): MockReq<undefined> {
  const req: MockReq<undefined> = { result: undefined, error: err, onsuccess: null, onerror: null };
  setTimeout(() => req.onerror?.(err), 0);
  return req;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IdbAssetStore', () => {
  let store: IdbAssetStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new IdbAssetStore();
  });

  describe('saveImage', () => {
    it('calls put with base64 payload and key', async () => {
      mockIdbStore.put.mockImplementation(() => makeSuccessReq(undefined));
      await store.saveImage('img-1', 'data:image/png;base64,abc');
      expect(mockIdbStore.put).toHaveBeenCalledWith('data:image/png;base64,abc', 'img-1');
    });

    it('rejects when IDB put errors', async () => {
      mockIdbStore.put.mockImplementation(() => makeErrorReq(new DOMException('put failed')));
      await expect(store.saveImage('img-1', 'abc')).rejects.toBeDefined();
    });
  });

  describe('getImage', () => {
    it('returns null when key is absent', async () => {
      mockIdbStore.get.mockImplementation(() => makeSuccessReq(null));
      const result = await store.getImage('missing-id');
      expect(result).toBeNull();
    });

    it('returns the stored base64 string', async () => {
      mockIdbStore.get.mockImplementation(() => makeSuccessReq('data:image/png;base64,XYZ'));
      const result = await store.getImage('img-1');
      expect(result).toBe('data:image/png;base64,XYZ');
    });

    it('rejects when IDB get errors', async () => {
      mockIdbStore.get.mockImplementation(() => makeErrorReq(new DOMException('get failed')));
      await expect(store.getImage('img-1')).rejects.toBeDefined();
    });
  });

  describe('deleteImage', () => {
    it('calls delete with the given id', async () => {
      mockIdbStore.delete.mockImplementation(() => makeSuccessReq(undefined));
      await store.deleteImage('img-1');
      expect(mockIdbStore.delete).toHaveBeenCalledWith('img-1');
    });

    it('rejects when IDB delete errors', async () => {
      mockIdbStore.delete.mockImplementation(() => makeErrorReq(new DOMException('del failed')));
      await expect(store.deleteImage('img-1')).rejects.toBeDefined();
    });
  });

  describe('saveBinderAsset', () => {
    it('stores asset at proj-1::asset-1 key (production key format)', async () => {
      mockIdbStore.put.mockImplementation(() => makeSuccessReq(undefined));
      const data = new ArrayBuffer(4);
      await store.saveBinderAsset('proj-1', 'asset-1', data, {
        mimeType: 'application/pdf',
        originalFileName: 'doc.pdf',
        byteSize: 4,
      });
      expect(mockIdbStore.put).toHaveBeenCalledWith(expect.anything(), 'proj-1::asset-1');
    });
  });

  describe('getBinderAsset', () => {
    it('returns null when key is absent', async () => {
      mockIdbStore.get.mockImplementation(() => makeSuccessReq(null));
      const result = await store.getBinderAsset('proj-1', 'missing');
      expect(result).toBeNull();
    });

    it('reconstructs ArrayBuffer from stored blob payload', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      // QNBS-v3: use exact BinderAssetMeta shape — originalFileName + byteSize required
      mockIdbStore.get.mockImplementation(() =>
        makeSuccessReq({
          meta: { mimeType: 'application/pdf', originalFileName: 'x.pdf', byteSize: 4 },
          blob,
        }),
      );
      const result = await store.getBinderAsset('proj-1', 'asset-1');
      expect(result).not.toBeNull();
      expect(result?.data.byteLength).toBe(4);
    });
  });

  describe('deleteBinderAsset', () => {
    it('calls delete with the correct composite key', async () => {
      mockIdbStore.delete.mockImplementation(() => makeSuccessReq(undefined));
      await store.deleteBinderAsset('proj-1', 'asset-1');
      expect(mockIdbStore.delete).toHaveBeenCalledWith('proj-1::asset-1');
    });
  });

  describe('listBinderAssetIds', () => {
    it('returns empty array when no assets exist', async () => {
      const req = { result: null, onsuccess: null as (() => void) | null };
      mockIdbStore.openCursor.mockReturnValue(req);
      setTimeout(() => req.onsuccess?.(), 0);
      const ids = await store.listBinderAssetIds('proj-1');
      expect(ids).toEqual([]);
    });

    it('returns ids for the project prefix only', async () => {
      // Simulate two cursors for proj-1 and one for proj-2
      const cursors = [
        { key: 'proj-1::a1' },
        { key: 'proj-1::a2' },
        { key: 'proj-2::other' },
        null, // end of cursor
      ];
      let idx = 0;
      const req = {
        result: cursors[0],
        onsuccess: null as (() => void) | null,
        onerror: null as ((e: unknown) => void) | null,
      };
      // Each cursor's continue() advances to next
      const advance = () => {
        idx++;
        req.result = cursors[idx] ?? null;
        setTimeout(() => req.onsuccess?.(), 0);
      };
      // Attach continue() to each cursor object
      for (const c of cursors) {
        if (c) Object.assign(c, { continue: advance });
      }
      mockIdbStore.openCursor.mockReturnValue(req);
      setTimeout(() => req.onsuccess?.(), 0);

      const ids = await store.listBinderAssetIds('proj-1');
      expect(ids).toContain('a1');
      expect(ids).toContain('a2');
      expect(ids).not.toContain('other');
    });
  });
});
