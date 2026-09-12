/**
 * Tests for idbAssetStore.ts — saveImage/getImage/deleteImage + binder asset CRUD.
 * QNBS-v3: Uncovered storage branch coverage.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IdbAssetStore } from '../../../../services/storage/idbAssetStore';

// ── IDB mock store ────────────────────────────────────────────────────────────

// QNBS-v3: a fake transaction object so a wait-for-commit contract is exercisable in tests -- shared shape for both stores below.
type MockTransaction = {
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  error: unknown;
};

function makeMockTransaction(): MockTransaction {
  return { oncomplete: null, onerror: null, onabort: null, error: null };
}

const mockImagesTransaction = makeMockTransaction();

const mockIdbStore = {
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  openCursor: vi.fn(),
  transaction: mockImagesTransaction,
};

const mockAppDataTransaction = makeMockTransaction();

// QNBS-v3: a separate mock store for APP_DATA_STORE (the legacy-image-ownership marker) so its
// get/put calls never contaminate the IMAGES_STORE-shaped mock behavior the tests below set up.
const mockAppDataStore = {
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  transaction: mockAppDataTransaction,
};

// QNBS-v3: hoisted so tests can inspect exactly which store/mode getObjectStore was called with (e.g. to prove the ownership claim uses one readwrite transaction, not a separate readonly + readwrite pair).
const mockGetObjectStore = vi.fn((storeName: string) =>
  Promise.resolve(storeName === 'app-data' ? mockAppDataStore : mockIdbStore),
);

vi.mock('../../../../services/storage/idbCodexStore', () => ({
  IdbCodexStore: class {
    protected getObjectStore = mockGetObjectStore;
  },
}));

vi.mock('../../../../services/storage/idbCore', () => ({
  getUserFriendlyDbError: (err: unknown) => String(err),
  retryDb: async (fn: () => Promise<unknown>) => fn(),
}));

vi.mock('../../../../services/storage/storageEncryptionService', () => ({
  assertIdbProtectedWriteAllowed: async () => {},
  assertNoActiveEncryptionMigration: async () => {},
  assertSecureStorageReadable: async () => false,
  idbEncryptWithKey: async (_key: unknown, data: unknown) => data,
  idbReadSecure: async (data: unknown) => data,
  isIdbEncryptionReady: () => false,
  isEncryptedBlob: () => false,
  // QNBS-v3: null mirrors isIdbEncryptionReady() => false — every write here takes the
  // never-configured plaintext branch, matching what these tests assert on mockIdbStore.put.
  resolveProtectedWriteKey: async () => null,
}));

vi.mock('../../../../services/dbConstants', () => ({
  IMAGES_STORE: 'images',
  BINDER_ASSETS_STORE: 'binder-assets',
  APP_DATA_STORE: 'app-data',
  LEGACY_IMAGE_OWNER_KEY: '__legacy_image_owner_project_id__',
}));

// QNBS-v3: mock matches production contract — sanitize spaces/colons and use :: delimiter
vi.mock('../../../../services/storageBackend', () => ({
  makeBinderAssetIdsPrefix: (projectId: string) =>
    `${projectId.replace(/[\s:]/g, '_').slice(0, 200)}::`,
  makeBinderAssetStorageKey: (projectId: string, assetId: string) =>
    `${projectId.replace(/[\s:]/g, '_').slice(0, 200)}::${assetId}`,
  makeImageStorageKey: (projectId: string, entityId: string) =>
    Promise.resolve(`${projectId.replace(/[\s:]/g, '_').slice(0, 200)}::${entityId}`),
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

// QNBS-v3: shared factory so APP_DATA_STORE and IMAGES_STORE reuse identical wait-for-commit/abort-after-success mocks instead of near-duplicate copies.
function makeTransactionTracker(transaction: MockTransaction) {
  // QNBS-v3: tracks pending requests on this transaction so oncomplete fires only once every request issued on it (including one chained from another's onsuccess) has settled.
  let pending = 0;
  return {
    reset(): void {
      pending = 0;
      transaction.oncomplete = null;
      transaction.onerror = null;
      transaction.onabort = null;
      transaction.error = null;
    },
    success<T>(result: T): MockReq<T> {
      pending += 1;
      const req: MockReq<T> = { result, error: null, onsuccess: null, onerror: null };
      setTimeout(() => {
        req.onsuccess?.();
        pending -= 1;
        if (pending === 0) transaction.oncomplete?.();
      }, 0);
      return req;
    },
    error(err: DOMException): MockReq<undefined> {
      pending += 1;
      const req: MockReq<undefined> = {
        result: undefined,
        error: err,
        onsuccess: null,
        onerror: null,
      };
      setTimeout(() => {
        req.onerror?.(err);
        pending -= 1;
        transaction.error = err;
        transaction.onabort?.();
      }, 0);
      return req;
    },
    // QNBS-v3: simulates a request that succeeds but whose transaction then aborts -- proves a caller waiting on oncomplete never acts on a request that was never durably committed.
    successThatThenAborts<T>(result: T): MockReq<T> {
      pending += 1;
      const req: MockReq<T> = { result, error: null, onsuccess: null, onerror: null };
      setTimeout(() => {
        req.onsuccess?.();
        pending -= 1;
        transaction.error = new DOMException('simulated transaction abort');
        transaction.onabort?.();
      }, 0);
      return req;
    },
  };
}

const appDataTracker = makeTransactionTracker(mockAppDataTransaction);
const imagesTracker = makeTransactionTracker(mockImagesTransaction);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IdbAssetStore', () => {
  let store: IdbAssetStore;

  beforeEach(() => {
    vi.clearAllMocks();
    appDataTracker.reset();
    imagesTracker.reset();
    // QNBS-v3: default "no legacy-image-owner claim yet" so every test's first legacy-fallback access claims for its own project id, matching prior (pre-ownership-check) fallback behavior unless a test deliberately overrides this to simulate a rival claim.
    mockAppDataStore.get.mockImplementation(() => appDataTracker.success(undefined));
    mockAppDataStore.put.mockImplementation(() => appDataTracker.success(undefined));
    store = new IdbAssetStore();
  });

  describe('saveImage', () => {
    it('calls put with base64 payload and the project-qualified key', async () => {
      mockIdbStore.put.mockImplementation(() => makeSuccessReq(undefined));
      await store.saveImage('img-1', 'data:image/png;base64,abc', 'proj-1');
      expect(mockIdbStore.put).toHaveBeenCalledWith('data:image/png;base64,abc', 'proj-1::img-1');
    });

    it('refuses the image write when final admission no longer proves authority', async () => {
      const admission = vi.fn(() => {
        throw new Error('stale project incarnation');
      });

      await expect(
        store.saveImage('img-1', 'data:image/png;base64,abc', 'proj-1', admission),
      ).rejects.toThrow('stale project incarnation');
      expect(admission).toHaveBeenCalledTimes(1);
      expect(mockIdbStore.put).not.toHaveBeenCalled();
    });

    it('rejects when IDB put errors', async () => {
      mockIdbStore.put.mockImplementation(() => makeErrorReq(new DOMException('put failed')));
      await expect(store.saveImage('img-1', 'abc', 'proj-1')).rejects.toBeDefined();
    });
  });

  describe('getImage', () => {
    it('returns null when neither the qualified nor legacy key exists', async () => {
      mockIdbStore.get.mockImplementation(() => makeSuccessReq(null));
      const result = await store.getImage('missing-id', 'proj-1');
      expect(result).toBeNull();
    });

    it('returns the stored base64 string from the project-qualified key', async () => {
      mockIdbStore.get.mockImplementation((key: string) =>
        makeSuccessReq(key === 'proj-1::img-1' ? 'data:image/png;base64,XYZ' : null),
      );
      const result = await store.getImage('img-1', 'proj-1');
      expect(result).toBe('data:image/png;base64,XYZ');
      expect(mockIdbStore.get).toHaveBeenCalledWith('proj-1::img-1');
    });

    // QNBS-v3: pre-project-qualification images must stay reachable without a forced migration.
    it('falls back to the legacy unqualified key when the qualified key is absent', async () => {
      mockIdbStore.get.mockImplementation((key: string) =>
        makeSuccessReq(key === 'img-1' ? 'data:image/png;base64,LEGACY' : null),
      );
      const result = await store.getImage('img-1', 'proj-1');
      expect(result).toBe('data:image/png;base64,LEGACY');
      expect(mockIdbStore.get).toHaveBeenCalledWith('proj-1::img-1');
      expect(mockIdbStore.get).toHaveBeenCalledWith('img-1');
    });

    it('rejects when IDB get errors', async () => {
      mockIdbStore.get.mockImplementation(() => makeErrorReq(new DOMException('get failed')));
      await expect(store.getImage('img-1', 'proj-1')).rejects.toBeDefined();
    });
  });

  describe('deleteImage', () => {
    // QNBS-v3: both keys must be cleared so a stale legacy record can never resurface via getImage's fallback -- but only once ownership of the legacy namespace is already provable for this project (simulated here via a pre-existing claim).
    it('deletes both the qualified and legacy key when this project already owns the legacy namespace', async () => {
      mockAppDataStore.get.mockImplementation(() => appDataTracker.success('proj-1'));
      mockIdbStore.delete.mockImplementation(() => makeSuccessReq(undefined));
      await store.deleteImage('img-1', 'proj-1');
      expect(mockIdbStore.delete).toHaveBeenCalledWith('proj-1::img-1');
      expect(mockIdbStore.delete).toHaveBeenCalledWith('img-1');
    });

    // QNBS-v3: preserve-first -- a delete must never itself establish a first ownership claim, so with no prior claim the unattributed legacy copy is left untouched rather than guessed-and-destroyed.
    it('does not delete the legacy key when this project has not yet claimed the legacy namespace', async () => {
      mockIdbStore.delete.mockImplementation(() => makeSuccessReq(undefined));
      await store.deleteImage('img-1', 'proj-1');
      expect(mockIdbStore.delete).toHaveBeenCalledWith('proj-1::img-1');
      expect(mockIdbStore.delete).not.toHaveBeenCalledWith('img-1');
    });

    // QNBS-v3: a legacy blob already claimed by a DIFFERENT project must never be deleted by this one either.
    it('does not delete the legacy key when a different project already owns the legacy namespace', async () => {
      mockAppDataStore.get.mockImplementation(() => appDataTracker.success('other-project'));
      mockIdbStore.delete.mockImplementation(() => makeSuccessReq(undefined));
      await store.deleteImage('img-1', 'proj-1');
      expect(mockIdbStore.delete).toHaveBeenCalledWith('proj-1::img-1');
      expect(mockIdbStore.delete).not.toHaveBeenCalledWith('img-1');
    });

    it('rejects when IDB delete errors', async () => {
      mockAppDataStore.get.mockImplementation(() => appDataTracker.success('proj-1'));
      mockIdbStore.delete.mockImplementation(() => makeErrorReq(new DOMException('del failed')));
      await expect(store.deleteImage('img-1', 'proj-1')).rejects.toBeDefined();
    });

    it('refuses deletion when the current incarnation no longer has authority', async () => {
      mockIdbStore.delete.mockImplementation(() => makeSuccessReq(undefined));
      const admission = vi.fn(() => {
        throw new Error('stale project incarnation');
      });

      await expect(store.deleteImage('img-1', 'proj-1', admission)).rejects.toThrow(
        'stale project incarnation',
      );
      expect(admission).toHaveBeenCalledTimes(1);
      expect(mockIdbStore.delete).not.toHaveBeenCalled();
    });
  });

  describe('legacy image ownership', () => {
    // QNBS-v3: the exact scenario this fix closes -- an orphaned legacy blob from a previously-active, now-replaced project must not leak into a new project reusing the same entity id.
    it('fails closed on the legacy fallback once a different project already claimed the legacy namespace', async () => {
      mockAppDataStore.get.mockImplementation(() => appDataTracker.success('project-a'));
      mockIdbStore.get.mockImplementation((key: string) =>
        makeSuccessReq(key === 'img-1' ? 'data:image/png;base64,PROJECT_A_IMAGE' : null),
      );
      const result = await store.getImage('img-1', 'project-b');
      expect(result).toBeNull();
    });

    it('still serves the legacy fallback for the project that already owns the legacy namespace', async () => {
      mockAppDataStore.get.mockImplementation(() => appDataTracker.success('project-a'));
      mockIdbStore.get.mockImplementation((key: string) =>
        makeSuccessReq(key === 'img-1' ? 'data:image/png;base64,PROJECT_A_IMAGE' : null),
      );
      const result = await store.getImage('img-1', 'project-a');
      expect(result).toBe('data:image/png;base64,PROJECT_A_IMAGE');
    });

    it('claims the legacy namespace for the first project that ever consults it', async () => {
      mockIdbStore.get.mockImplementation((key: string) =>
        makeSuccessReq(key === 'img-1' ? 'data:image/png;base64,FIRST_CLAIM' : null),
      );
      const result = await store.getImage('img-1', 'project-a');
      expect(result).toBe('data:image/png;base64,FIRST_CLAIM');
      expect(mockAppDataStore.put).toHaveBeenCalledWith(
        'project-a',
        '__legacy_image_owner_project_id__',
      );
    });

    // QNBS-v3: the lookup and the conditional write must share one readwrite transaction (not a separate readonly lookup + readwrite write) so two concurrent claims for different projects can never both observe "unclaimed" and both succeed.
    it('performs the ownership lookup and conditional write in a single readwrite transaction', async () => {
      mockIdbStore.get.mockImplementation((key: string) =>
        makeSuccessReq(key === 'img-1' ? 'data:image/png;base64,ATOMIC' : null),
      );
      await store.getImage('img-1', 'project-a');

      const appDataStoreCalls = mockGetObjectStore.mock.calls.filter(
        ([name]) => name === 'app-data',
      );
      expect(appDataStoreCalls).toEqual([['app-data', 'readwrite']]);
    });

    // QNBS-v3: a put request can report success and still be rolled back if its transaction later aborts (e.g. quota exceeded) -- proves the claim is not admitted (rejects, matching this class's established "propagate IDB errors" contract already covered by "rejects when IDB get/put/delete errors" above) rather than silently resolving as though the legacy image were safe to serve.
    it('rejects instead of admitting the legacy fallback when the ownership-claim transaction aborts after the put reports success', async () => {
      mockAppDataStore.put.mockImplementation(() =>
        appDataTracker.successThatThenAborts(undefined),
      );
      mockIdbStore.get.mockImplementation((key: string) =>
        makeSuccessReq(key === 'img-1' ? 'data:image/png;base64,SHOULD_NOT_BE_SERVED' : null),
      );

      await expect(store.getImage('img-1', 'project-a')).rejects.toBeDefined();
    });

    it('rejects when the ownership-marker lookup itself errors', async () => {
      mockAppDataStore.get.mockImplementation(() =>
        appDataTracker.error(new DOMException('app-data get failed')),
      );
      mockIdbStore.get.mockImplementation(() => makeSuccessReq(null));

      await expect(store.getImage('img-1', 'project-a')).rejects.toBeDefined();
    });
  });

  // QNBS-v3: these exist so a rollback snapshot can't be handed a differently-provenanced legacy blob instead of a genuinely empty qualified slot.
  describe('getQualifiedImage / deleteQualifiedImage — rollback/transaction primitives', () => {
    it('reports absent (not the legacy blob) when only the legacy unqualified key exists', async () => {
      mockIdbStore.get.mockImplementation((key: string) =>
        makeSuccessReq(key === 'img-1' ? 'data:image/png;base64,LEGACY' : null),
      );
      const qualifiedResult = await store.getQualifiedImage('img-1', 'proj-1');
      expect(qualifiedResult).toBeNull();
      // QNBS-v3: the merged-semantics getImage would return the legacy blob for the same call -- proves the two reads genuinely disagree, not just that getQualifiedImage happens to return null.
      const mergedResult = await store.getImage('img-1', 'proj-1');
      expect(mergedResult).toBe('data:image/png;base64,LEGACY');
    });

    it('does not claim legacy ownership merely by peeking at the qualified slot', async () => {
      mockIdbStore.get.mockImplementation(() => makeSuccessReq(null));
      await store.getQualifiedImage('img-1', 'proj-1');
      expect(mockAppDataStore.put).not.toHaveBeenCalled();
      expect(mockAppDataStore.get).not.toHaveBeenCalled();
    });

    it('returns the qualified value when present, ignoring an unrelated legacy key', async () => {
      mockIdbStore.get.mockImplementation((key: string) =>
        makeSuccessReq(
          key === 'proj-1::img-1'
            ? 'data:image/png;base64,QUALIFIED'
            : key === 'img-1'
              ? 'data:image/png;base64,LEGACY'
              : null,
        ),
      );
      const result = await store.getQualifiedImage('img-1', 'proj-1');
      expect(result).toBe('data:image/png;base64,QUALIFIED');
    });

    it('propagates a read failure instead of collapsing it to null', async () => {
      mockIdbStore.get.mockImplementation(() => makeErrorReq(new DOMException('get failed')));
      await expect(store.getQualifiedImage('img-1', 'proj-1')).rejects.toBeDefined();
    });

    it('deletes only the qualified key, preserving an unrelated legacy key', async () => {
      mockIdbStore.delete.mockImplementation(() => imagesTracker.success(undefined));
      await store.deleteQualifiedImage('img-1', 'proj-1');
      expect(mockIdbStore.delete).toHaveBeenCalledWith('proj-1::img-1');
      expect(mockIdbStore.delete).not.toHaveBeenCalledWith('img-1');
      // QNBS-v3: never even consults the ownership marker, unlike deleteImage.
      expect(mockAppDataStore.get).not.toHaveBeenCalled();
    });

    it('propagates a delete failure instead of swallowing it', async () => {
      mockIdbStore.delete.mockImplementation(() =>
        imagesTracker.error(new DOMException('del failed')),
      );
      await expect(store.deleteQualifiedImage('img-1', 'proj-1')).rejects.toBeDefined();
    });

    // QNBS-v3: a delete request can report success and still be rolled back if its transaction later aborts (e.g. quota exceeded) -- proves deleteQualifiedImage does not resolve until the transaction actually commits, matching the same "wait for transaction.oncomplete" contract already established for the legacy-ownership claim above.
    it('rejects instead of resolving successfully when the delete transaction aborts after the request reports success', async () => {
      mockIdbStore.delete.mockImplementation(() => imagesTracker.successThatThenAborts(undefined));
      await expect(store.deleteQualifiedImage('img-1', 'proj-1')).rejects.toBeDefined();
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
