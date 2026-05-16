import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectData } from '../../features/project/projectSlice';

// ---------------------------------------------------------------------------
// Fake IDB store factory for snapshot tests
// ---------------------------------------------------------------------------

interface SnapshotRecord {
  date: string;
  name: string;
  wordCount: number;
  data: string; // LZ-compressed
}

type TestDbService = {
  stateDb?: unknown;
  dataDb?: unknown;
  createSnapshot: (data: ProjectData, name?: string) => Promise<number>;
  saveSnapshot: (name: string, data: ProjectData) => Promise<number>;
  listSnapshots: () => Promise<{ id: number; date: string; name: string; wordCount: number }[]>;
  getSnapshotData: (id: number) => Promise<ProjectData>;
  deleteSnapshot: (id: number) => Promise<void>;
  hasSavedData: () => Promise<boolean>;
  MAX_AUTO_SNAPSHOTS: number;
  [key: string]: unknown;
};

// Map-based fake store shared within each test; keyed by auto-increment integer
const snapshotStore = new Map<number, SnapshotRecord>();
const appDataStore = new Map<string, unknown>();
let nextSnapshotKey = 1;

function createSnapshotFakeStore() {
  return {
    add: (value: unknown) => {
      const key = nextSnapshotKey++;
      const req: Record<string, unknown> = {
        onsuccess: null,
        onerror: null,
        result: key,
        error: null,
      };
      Promise.resolve().then(() => {
        snapshotStore.set(key, value as SnapshotRecord);
        (req['onsuccess'] as (() => void) | null)?.();
      });
      return req;
    },
    get: (key: number) => {
      const req: Record<string, unknown> = {
        onsuccess: null,
        onerror: null,
        result: snapshotStore.get(key),
        error: null,
      };
      Promise.resolve().then(() => {
        (req['onsuccess'] as ((e: Event) => void) | null)?.({} as Event);
      });
      return req;
    },
    delete: (key: number) => {
      const req: Record<string, unknown> = {
        onsuccess: null,
        onerror: null,
      };
      Promise.resolve().then(() => {
        snapshotStore.delete(key);
        (req['onsuccess'] as ((e: Event) => void) | null)?.({} as Event);
      });
      return req;
    },
    // openCursor with 'prev' direction for listSnapshots
    openCursor: (_range: unknown, direction?: string) => {
      const entries = [...snapshotStore.entries()];
      if (direction === 'prev') entries.reverse();
      let index = 0;

      const req: Record<string, unknown> = {
        onsuccess: null,
        onerror: null,
        result: null,
      };

      const advance = () => {
        if (index >= entries.length) {
          req['result'] = null;
          (req['onsuccess'] as ((e: Event) => void) | null)?.({} as Event);
          return;
        }
        const [key, value] = entries[index++] as [number, SnapshotRecord];
        req['result'] = {
          key,
          value: { ...value },
          continue: () => {
            Promise.resolve().then(advance);
          },
        };
        (req['onsuccess'] as ((e: Event) => void) | null)?.({} as Event);
      };

      Promise.resolve().then(advance);
      return req;
    },
    // getAllKeys for pruneAutoSnapshots
    getAllKeys: () => {
      const req: Record<string, unknown> = {
        onsuccess: null,
        onerror: null,
        result: [...snapshotStore.keys()].sort((a, b) => a - b),
      };
      Promise.resolve().then(() => {
        (req['onsuccess'] as ((e: Event) => void) | null)?.({} as Event);
      });
      return req;
    },
  };
}

function createAppDataFakeStore() {
  return {
    count: () => {
      const req: Record<string, unknown> = {
        onsuccess: null,
        onerror: null,
        result: appDataStore.size,
      };
      Promise.resolve().then(() => {
        (req['onsuccess'] as (() => void) | null)?.();
      });
      return req;
    },
  };
}

const SNAPSHOTS_STORE_NAME = 'snapshots-store';

const fakeMixedDb = {
  transaction: vi.fn().mockImplementation((storeName: string) => {
    const store =
      storeName === SNAPSHOTS_STORE_NAME ? createSnapshotFakeStore() : createAppDataFakeStore();
    return { objectStore: () => store };
  }),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProjectData(wordCountWords = 10): ProjectData {
  const content = Array.from({ length: wordCountWords }, (_, i) => `word${i}`).join(' ');
  return {
    id: 'proj-test',
    title: 'Test Project',
    logline: '',
    outline: [],
    manuscript: [{ id: 's1', title: 'Chapter 1', content }],
    characters: { ids: [], entities: {} },
    worlds: { ids: [], entities: {} },
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('dbService — snapshots', () => {
  let dbService: TestDbService;

  beforeEach(async () => {
    snapshotStore.clear();
    appDataStore.clear();
    nextSnapshotKey = 1;
    vi.clearAllMocks();

    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn(async () => new Uint8Array(32).buffer),
        importKey: vi.fn(async () => ({ type: 'secret', algorithm: { name: 'AES-GCM' } })),
        generateKey: vi.fn(async () => ({
          type: 'secret',
          algorithm: { name: 'AES-GCM' },
          extractable: false,
        })),
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
    dbService.stateDb = fakeMixedDb;
    dbService.dataDb = fakeMixedDb;
  });

  // -------------------------------------------------------------------------
  // createSnapshot
  // -------------------------------------------------------------------------
  describe('createSnapshot', () => {
    it('returns an auto-incremented numeric id', async () => {
      const id = await dbService.createSnapshot(makeProjectData());
      expect(typeof id).toBe('number');
      expect(id).toBe(1);
    });

    it('auto-increments ids across multiple snapshots', async () => {
      const id1 = await dbService.createSnapshot(makeProjectData());
      const id2 = await dbService.createSnapshot(makeProjectData());
      expect(id2).toBeGreaterThan(id1);
    });

    it('uses "Automatic Snapshot" as default name', async () => {
      const id = await dbService.createSnapshot(makeProjectData());
      expect(snapshotStore.get(id)?.name).toBe('Automatic Snapshot');
    });

    it('uses the provided name when given', async () => {
      const id = await dbService.createSnapshot(makeProjectData(), 'Before chapter 5');
      expect(snapshotStore.get(id)?.name).toBe('Before chapter 5');
    });

    it('computes wordCount from manuscript content', async () => {
      const id = await dbService.createSnapshot(makeProjectData(5));
      expect(snapshotStore.get(id)?.wordCount).toBe(5);
    });

    it('stores data (raw or compressed) in the snapshot record', async () => {
      // QNBS-v3: compressData only compresses payloads > 10 KB; small test data stays as-is
      const id = await dbService.createSnapshot(makeProjectData());
      expect(snapshotStore.get(id)).toHaveProperty('data');
    });
  });

  // -------------------------------------------------------------------------
  // saveSnapshot (alias for createSnapshot with name)
  // -------------------------------------------------------------------------
  describe('saveSnapshot', () => {
    it('creates a snapshot with the given name', async () => {
      const id = await dbService.saveSnapshot('Manual Save', makeProjectData());
      expect(snapshotStore.get(id)?.name).toBe('Manual Save');
    });
  });

  // -------------------------------------------------------------------------
  // listSnapshots
  // -------------------------------------------------------------------------
  describe('listSnapshots', () => {
    it('returns empty array when no snapshots exist', async () => {
      const list = await dbService.listSnapshots();
      expect(list).toEqual([]);
    });

    it('returns snapshots in reverse (newest-first) order', async () => {
      await dbService.createSnapshot(makeProjectData(), 'First');
      await dbService.createSnapshot(makeProjectData(), 'Second');
      const list = await dbService.listSnapshots();
      // Newest (highest key) should be first
      expect(list[0]?.name).toBe('Second');
      expect(list[1]?.name).toBe('First');
    });

    it('does not include the raw data field', async () => {
      await dbService.createSnapshot(makeProjectData());
      const list = await dbService.listSnapshots();
      expect(Object.keys(list[0] ?? {})).not.toContain('data');
    });

    it('includes the id, name, date, and wordCount fields', async () => {
      await dbService.createSnapshot(makeProjectData(3), 'My Snapshot');
      const list = await dbService.listSnapshots();
      const snap = list[0];
      expect(snap).toHaveProperty('id');
      expect(snap).toHaveProperty('name', 'My Snapshot');
      expect(snap).toHaveProperty('date');
      expect(snap).toHaveProperty('wordCount', 3);
    });
  });

  // -------------------------------------------------------------------------
  // getSnapshotData
  // -------------------------------------------------------------------------
  describe('getSnapshotData', () => {
    it('returns the original ProjectData after decompression', async () => {
      const data = makeProjectData(7);
      const id = await dbService.createSnapshot(data);
      const restored = await dbService.getSnapshotData(id);
      expect(restored.title).toBe('Test Project');
      expect(restored.manuscript[0]?.content).toBe(data.manuscript[0]?.content);
    });
  });

  // -------------------------------------------------------------------------
  // deleteSnapshot
  // -------------------------------------------------------------------------
  describe('deleteSnapshot', () => {
    it('removes the snapshot from the store', async () => {
      const id = await dbService.createSnapshot(makeProjectData());
      await dbService.deleteSnapshot(id);
      expect(snapshotStore.has(id)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // hasSavedData
  // -------------------------------------------------------------------------
  describe('hasSavedData', () => {
    it('returns false when store is empty', async () => {
      appDataStore.clear();
      const result = await dbService.hasSavedData();
      expect(result).toBe(false);
    });

    it('returns true when store has entries', async () => {
      appDataStore.set('someKey', 'someValue');
      const result = await dbService.hasSavedData();
      expect(result).toBe(true);
    });
  });
});
