import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BinderAssetMeta } from '../../services/storageBackend';

// ---------------------------------------------------------------------------
// Fake IDB store for binder-asset tests
// ---------------------------------------------------------------------------

type BinderRecord = { meta: BinderAssetMeta & { byteSize: number }; blob: Blob };
const binderStore = new Map<string, BinderRecord>();

function createBinderFakeStore() {
  return {
    put: (value: unknown, key: string) => {
      const req: Record<string, unknown> = { onsuccess: null, onerror: null };
      Promise.resolve().then(() => {
        binderStore.set(key, value as BinderRecord);
        (req['onsuccess'] as (() => void) | null)?.();
      });
      return req;
    },
    get: (key: string) => {
      const req: Record<string, unknown> = {
        onsuccess: null,
        onerror: null,
        result: binderStore.get(key),
        error: null,
      };
      Promise.resolve().then(() => {
        (req['onsuccess'] as ((e: Event) => void) | null)?.({} as Event);
      });
      return req;
    },
    delete: (key: string) => {
      const req: Record<string, unknown> = { onsuccess: null, onerror: null };
      Promise.resolve().then(() => {
        binderStore.delete(key);
        (req['onsuccess'] as ((e: Event) => void) | null)?.({} as Event);
      });
      return req;
    },
    openCursor: () => {
      const entries = [...binderStore.entries()];
      let index = 0;
      const req: Record<string, unknown> = { onsuccess: null, onerror: null, result: null };

      const advance = () => {
        if (index >= entries.length) {
          req['result'] = null;
          (req['onsuccess'] as ((e: Event) => void) | null)?.({} as Event);
          return;
        }
        const [key] = entries[index++] as [string, BinderRecord];
        req['result'] = {
          key,
          continue: () => {
            Promise.resolve().then(advance);
          },
        };
        (req['onsuccess'] as ((e: Event) => void) | null)?.({} as Event);
      };

      Promise.resolve().then(advance);
      return req;
    },
  };
}

const fakeDataDb = {
  transaction: vi.fn().mockImplementation(() => ({
    objectStore: () => createBinderFakeStore(),
  })),
};

// stateDb is not used by binder methods — but must be non-null to skip init()
const fakeStateDb = {
  transaction: vi.fn().mockImplementation(() => ({
    objectStore: () => ({ count: () => ({ onsuccess: null, onerror: null, result: 0 }) }),
  })),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMeta(overrides: Partial<BinderAssetMeta> = {}): BinderAssetMeta {
  return {
    mimeType: 'application/pdf',
    originalFileName: 'doc.pdf',
    byteSize: 0,
    ...overrides,
  };
}

function makeBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

type TestDbService = {
  stateDb?: unknown;
  dataDb?: unknown;
  saveBinderAsset: (
    projectId: string,
    assetId: string,
    data: ArrayBuffer,
    meta: BinderAssetMeta,
  ) => Promise<void>;
  getBinderAsset: (
    projectId: string,
    assetId: string,
  ) => Promise<{ data: ArrayBuffer; meta: BinderAssetMeta } | null>;
  deleteBinderAsset: (projectId: string, assetId: string) => Promise<void>;
  listBinderAssetIds: (projectId: string) => Promise<string[]>;
  deleteAllBinderAssetsForProject: (projectId: string) => Promise<void>;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dbService — binder assets', () => {
  let dbService: TestDbService;

  beforeEach(async () => {
    binderStore.clear();
    vi.clearAllMocks();

    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn(async () => new Uint8Array(32).buffer),
        importKey: vi.fn(async () => ({})),
        generateKey: vi.fn(async () => ({})),
        encrypt: vi.fn(async (_a: unknown, _b: unknown, data: unknown) => data),
        decrypt: vi.fn(async (_a: unknown, _b: unknown, data: unknown) => data),
      },
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    } as unknown as Crypto);

    vi.resetModules();
    const mod = await import('../../services/dbService');
    dbService = mod.dbService as unknown as TestDbService;
    dbService.stateDb = fakeStateDb;
    dbService.dataDb = fakeDataDb;
  });

  // -------------------------------------------------------------------------
  // saveBinderAsset
  // -------------------------------------------------------------------------
  describe('saveBinderAsset', () => {
    it('stores the asset under the composite key', async () => {
      const buf = makeBuffer('pdf content');
      await dbService.saveBinderAsset('proj-1', 'asset-1', buf, makeMeta());
      // Key format: projectId::assetId (from makeBinderAssetStorageKey)
      expect(binderStore.has('proj-1::asset-1')).toBe(true);
    });

    it('stores the meta with byteSize set to the buffer length', async () => {
      const buf = makeBuffer('hello');
      await dbService.saveBinderAsset(
        'proj-1',
        'asset-2',
        buf,
        makeMeta({ mimeType: 'image/png' }),
      );
      const record = binderStore.get('proj-1::asset-2');
      expect(record?.meta.byteSize).toBe(buf.byteLength);
      expect(record?.meta.mimeType).toBe('image/png');
    });

    it('stores a Blob object', async () => {
      const buf = makeBuffer('data');
      await dbService.saveBinderAsset('proj-1', 'asset-3', buf, makeMeta());
      const record = binderStore.get('proj-1::asset-3');
      expect(record?.blob).toBeInstanceOf(Blob);
    });
  });

  // -------------------------------------------------------------------------
  // getBinderAsset
  // -------------------------------------------------------------------------
  describe('getBinderAsset', () => {
    it('returns null when the asset does not exist', async () => {
      const result = await dbService.getBinderAsset('proj-x', 'nonexistent');
      expect(result).toBeNull();
    });

    it('returns the asset data and meta when the asset exists', async () => {
      const buf = makeBuffer('hello world');
      await dbService.saveBinderAsset(
        'proj-2',
        'asset-4',
        buf,
        makeMeta({ originalFileName: 'hello.pdf' }),
      );

      const result = await dbService.getBinderAsset('proj-2', 'asset-4');
      expect(result).not.toBeNull();
      expect(result?.data).toBeInstanceOf(ArrayBuffer);
      expect(result?.meta.originalFileName).toBe('hello.pdf');
    });

    it('returns an ArrayBuffer with the original content', async () => {
      const original = 'test file content';
      const buf = makeBuffer(original);
      await dbService.saveBinderAsset('proj-2', 'asset-5', buf, makeMeta());

      const result = await dbService.getBinderAsset('proj-2', 'asset-5');
      const decoded = new TextDecoder().decode(result?.data);
      expect(decoded).toBe(original);
    });
  });

  // -------------------------------------------------------------------------
  // deleteBinderAsset
  // -------------------------------------------------------------------------
  describe('deleteBinderAsset', () => {
    it('removes the asset from the store', async () => {
      await dbService.saveBinderAsset('proj-3', 'asset-6', makeBuffer('data'), makeMeta());
      expect(binderStore.has('proj-3::asset-6')).toBe(true);

      await dbService.deleteBinderAsset('proj-3', 'asset-6');
      expect(binderStore.has('proj-3::asset-6')).toBe(false);
    });

    it('does not throw when deleting a non-existent asset', async () => {
      await expect(dbService.deleteBinderAsset('proj-3', 'ghost')).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // listBinderAssetIds
  // -------------------------------------------------------------------------
  describe('listBinderAssetIds', () => {
    it('returns empty array when no assets exist for the project', async () => {
      const ids = await dbService.listBinderAssetIds('proj-empty');
      expect(ids).toEqual([]);
    });

    it('returns all asset ids for the given project', async () => {
      await dbService.saveBinderAsset('proj-4', 'pdf-1', makeBuffer('a'), makeMeta());
      await dbService.saveBinderAsset('proj-4', 'pdf-2', makeBuffer('b'), makeMeta());
      await dbService.saveBinderAsset('proj-other', 'pdf-3', makeBuffer('c'), makeMeta());

      const ids = await dbService.listBinderAssetIds('proj-4');
      expect(ids).toContain('pdf-1');
      expect(ids).toContain('pdf-2');
      expect(ids).not.toContain('pdf-3');
    });

    it('strips the project prefix from returned ids', async () => {
      await dbService.saveBinderAsset('proj-5', 'my-asset', makeBuffer('x'), makeMeta());
      const ids = await dbService.listBinderAssetIds('proj-5');
      expect(ids[0]).toBe('my-asset');
    });
  });

  // -------------------------------------------------------------------------
  // deleteAllBinderAssetsForProject
  // -------------------------------------------------------------------------
  describe('deleteAllBinderAssetsForProject', () => {
    it('removes all assets for the given project', async () => {
      await dbService.saveBinderAsset('proj-6', 'a1', makeBuffer('a'), makeMeta());
      await dbService.saveBinderAsset('proj-6', 'a2', makeBuffer('b'), makeMeta());
      await dbService.saveBinderAsset('proj-other', 'a3', makeBuffer('c'), makeMeta());

      await dbService.deleteAllBinderAssetsForProject('proj-6');

      expect(binderStore.has('proj-6::a1')).toBe(false);
      expect(binderStore.has('proj-6::a2')).toBe(false);
      // Other project's assets must remain
      expect(binderStore.has('proj-other::a3')).toBe(true);
    });

    it('succeeds even when no assets exist for the project', async () => {
      await expect(dbService.deleteAllBinderAssetsForProject('proj-none')).resolves.not.toThrow();
    });
  });
});
