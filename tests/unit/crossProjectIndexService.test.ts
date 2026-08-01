// @vitest-environment node
// QNBS-v3: node environment + global.indexedDB = fake-indexeddb avoids jsdom's stub.
//          Module imported once — singleton dbPromise reused; tests clean own records via removeProjectIndex.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

global.indexedDB = new IDBFactory();
global.IDBKeyRange = IDBKeyRange;

// QNBS-v3: Mock embedding service so enrichProjectIndex tests don't need the worker loaded.
const mockEmbedText = vi.fn();
const mockCosineSimilarity = vi.fn();
vi.mock('../../services/ai/localEmbeddingService', () => ({
  embedText: (...args: unknown[]) => mockEmbedText(...args),
  cosineSimilarity: (...args: unknown[]) => mockCosineSimilarity(...args),
}));

// QNBS-v3: SEC — mock the DuckDB loader so we can assert the cross-project mirror write is gated by
// the duckDbEnabled callback (re-evaluated at the write site) without touching real DuckDB-WASM.
const { mockCrossProjectWrite } = vi.hoisted(() => ({ mockCrossProjectWrite: vi.fn() }));
vi.mock('../../services/duckdb/duckdbListenerLoader', () => ({
  loadDuckdbAnalytics: () => Promise.resolve({ duckdbCrossProjectWrite: mockCrossProjectWrite }),
}));

import type { ProjectData } from '../../features/project/projectSlice';
import {
  _resetCrossProjectIndexDbForTest,
  enrichProjectIndex,
  indexProject,
  listIndexedProjects,
  removeProjectIndex,
  semanticSearchProjects,
} from '../../services/crossProjectIndexService';
import { DATA_DB_NAME, DB_VERSION, PROJECTS_INDEX_STORE } from '../../services/dbConstants';
import { _resetPassphraseSentinelForTest } from '../../services/storage/idbPassphraseSentinel';
import {
  clearIdbEncryptionKey,
  isSecureRecordEnvelope,
  SecureRecordCorruptError,
  SecureRecordLockedError,
  setupIdbEncryption,
} from '../../services/storage/storageEncryptionService';

// ─── Helpers ────────────────────────────────────────────────────────────────

const TEST_IDS = ['proj-1', 'proj-2'];

async function readRawIndex(projectId: string): Promise<Record<string, unknown> | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATA_DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const request = db
      .transaction(PROJECTS_INDEX_STORE, 'readonly')
      .objectStore(PROJECTS_INDEX_STORE)
      .get(projectId);
    request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function writeRawIndex(record: Record<string, unknown>): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATA_DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PROJECTS_INDEX_STORE, 'readwrite');
    transaction.objectStore(PROJECTS_INDEX_STORE).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function makeProjectData(overrides: Partial<Record<string, unknown>> = {}): ProjectData {
  return {
    id: 'proj-1',
    title: 'My Novel',
    logline: 'A hero saves the world.',
    manuscript: [
      {
        id: 's1',
        title: 'Chapter 1',
        content: 'Once upon a time there were three words.',
      },
    ],
    characters: { ids: [], entities: {} },
    outline: { id: 'outline-1', sections: [] },
    tags: [],
    worldBuilding: { id: 'wb-1', entries: [] },
    ...overrides,
  } as unknown as ProjectData;
}

// Clear known test records before each test to avoid cross-test state pollution.
beforeEach(async () => {
  _resetCrossProjectIndexDbForTest();
  _resetPassphraseSentinelForTest();
  clearIdbEncryptionKey();
  global.indexedDB = new IDBFactory();
  global.IDBKeyRange = IDBKeyRange;
  vi.clearAllMocks();
  // Default: embedding succeeds with a small Float32Array
  mockEmbedText.mockResolvedValue(new Float32Array([0.5, 0.5, 0.0]));
  mockCosineSimilarity.mockReturnValue(0.8);
  mockCrossProjectWrite.mockResolvedValue(undefined);
  for (const id of TEST_IDS) await removeProjectIndex(id).catch(() => {});
});

// Flush the fire-and-forget DuckDB write chain (loadDuckdbAnalytics().then(...)) deterministically —
// it is a pure microtask chain (mocked loader resolves synchronously), so awaiting a few microtask
// ticks settles it without depending on real timers / wall-clock scheduling.
async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('crossProjectIndexService', () => {
  it('indexProject persists a record readable by listIndexedProjects', async () => {
    await indexProject('proj-1', makeProjectData());
    const results = await listIndexedProjects();
    const found = results.find((r) => r.projectId === 'proj-1');
    expect(found).toBeDefined();
    expect(found?.title).toBe('My Novel');
    expect(found?.logline).toBe('A hero saves the world.');
  });

  it('indexProject stores character names from normalized structure', async () => {
    const data = makeProjectData({
      characters: {
        ids: ['c1', 'c2'],
        entities: {
          c1: { id: 'c1', name: 'Alice' },
          c2: { id: 'c2', name: 'Bob' },
        },
      },
    });
    await indexProject('proj-1', data);
    const results = await listIndexedProjects();
    const found = results.find((r) => r.projectId === 'proj-1');
    expect(found?.characterNames).toContain('Alice');
    expect(found?.characterNames).toContain('Bob');
  });

  it('indexProject counts manuscript words', async () => {
    // "Once upon a time there were three words." = 8 words
    await indexProject('proj-1', makeProjectData());
    const results = await listIndexedProjects();
    const found = results.find((r) => r.projectId === 'proj-1');
    expect(found?.manuscriptWordCount).toBe(8);
  });

  it('listIndexedProjects returns records sorted by lastIndexed descending', async () => {
    await indexProject('proj-1', makeProjectData({ title: 'First' }));
    await new Promise((r) => setTimeout(r, 5));
    await indexProject('proj-2', makeProjectData({ id: 'proj-2', title: 'Second' }));

    const results = await listIndexedProjects();
    const p1 = results.find((r) => r.projectId === 'proj-1');
    const p2 = results.find((r) => r.projectId === 'proj-2');
    expect(p1).toBeDefined();
    expect(p2).toBeDefined();
    // proj-2 was indexed later so should appear first (higher lastIndexed)
    const p1Idx = results.indexOf(p1!);
    const p2Idx = results.indexOf(p2!);
    expect(p2Idx).toBeLessThan(p1Idx);
  });

  it('removeProjectIndex deletes the record', async () => {
    await indexProject('proj-1', makeProjectData());
    await removeProjectIndex('proj-1');
    const results = await listIndexedProjects();
    expect(results.find((r) => r.projectId === 'proj-1')).toBeUndefined();
  });

  it('indexProject truncates title to 256 chars and logline to 512 chars', async () => {
    const data = makeProjectData({
      title: 'T'.repeat(300),
      logline: 'L'.repeat(600),
    });
    await indexProject('proj-1', data);
    const results = await listIndexedProjects();
    const found = results.find((r) => r.projectId === 'proj-1');
    expect(found?.title.length).toBe(256);
    expect(found?.logline.length).toBe(512);
  });

  it('indexProject sets lastIndexed to approximately now', async () => {
    const before = Date.now();
    await indexProject('proj-1', makeProjectData());
    const after = Date.now();
    const results = await listIndexedProjects();
    const found = results.find((r) => r.projectId === 'proj-1');
    expect(found?.lastIndexed).toBeGreaterThanOrEqual(before);
    expect(found?.lastIndexed).toBeLessThanOrEqual(after);
  });

  // QNBS-v3: SEC — the DuckDB mirror write is gated by the duckDbEnabled callback, evaluated AFTER the
  // IDB put (so a mid-call opt-out is honoured). The IDB index itself is written regardless.
  it('indexProject writes the DuckDB mirror when the gate callback returns true', async () => {
    await indexProject('proj-1', makeProjectData(), () => true);
    await flushMicrotasks();
    expect(mockCrossProjectWrite).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1', title: 'My Novel' }),
    );
  });

  it('indexProject skips the DuckDB mirror when the gate callback returns false (IDB still written)', async () => {
    await indexProject('proj-1', makeProjectData(), () => false);
    await flushMicrotasks();
    expect(mockCrossProjectWrite).not.toHaveBeenCalled();
    // IDB search index is still populated — search works regardless of analytics opt-out.
    const results = await listIndexedProjects();
    expect(results.find((r) => r.projectId === 'proj-1')).toBeDefined();
  });
});

describe('crossProjectIndexService encrypted persistence', () => {
  it('encrypts all descriptive metadata and embeddings in raw IndexedDB', async () => {
    await setupIdbEncryption('index-passphrase');
    const data = makeProjectData({
      title: 'PROJECT_TITLE_CANARY',
      logline: 'PROJECT_LOGLINE_CANARY',
      characters: {
        ids: ['c1'],
        entities: { c1: { id: 'c1', name: 'CHARACTER_NAME_CANARY' } },
      },
    });

    await indexProject('p-encrypted', data);
    await enrichProjectIndex('p-encrypted');
    const raw = await readRawIndex('p-encrypted');

    expect(raw?.['projectId']).toBe('p-encrypted');
    expect(typeof raw?.['lastIndexed']).toBe('number');
    expect(isSecureRecordEnvelope(raw?.['payload'])).toBe(true);
    expect(JSON.stringify(raw)).not.toContain('PROJECT_TITLE_CANARY');
    expect(JSON.stringify(raw)).not.toContain('PROJECT_LOGLINE_CANARY');
    expect(JSON.stringify(raw)).not.toContain('CHARACTER_NAME_CANARY');
    const [decoded] = await listIndexedProjects();
    expect(decoded?.title).toBe('PROJECT_TITLE_CANARY');
    expect(decoded?.embeddingVector).toEqual([0.5, 0.5, 0]);
  });

  it('rejects index reads and writes while configured encryption is locked', async () => {
    await setupIdbEncryption('index-passphrase');
    await indexProject('p-locked', makeProjectData());
    clearIdbEncryptionKey();

    await expect(listIndexedProjects()).rejects.toBeInstanceOf(SecureRecordLockedError);
    await expect(indexProject('p-new', makeProjectData())).rejects.toBeInstanceOf(
      SecureRecordLockedError,
    );
  });

  it('lazily rewrites a legacy plaintext index record after unlock', async () => {
    await indexProject('seed', makeProjectData());
    const legacy = {
      projectId: 'p-legacy',
      title: 'LEGACY_PROJECT_TITLE_CANARY',
      logline: 'LEGACY_PROJECT_LOGLINE_CANARY',
      manuscriptWordCount: 7,
      characterNames: ['LEGACY_CHARACTER_CANARY'],
      lastIndexed: 123,
    };
    await writeRawIndex(legacy);
    await setupIdbEncryption('index-passphrase');

    const decoded = (await listIndexedProjects()).find((entry) => entry.projectId === 'p-legacy');
    expect(decoded).toEqual(legacy);
    const migrated = await readRawIndex('p-legacy');
    expect(isSecureRecordEnvelope(migrated?.['payload'])).toBe(true);
    expect(JSON.stringify(migrated)).not.toContain('LEGACY_PROJECT_TITLE_CANARY');
  });

  it('fails closed when encrypted project metadata is corrupted', async () => {
    await setupIdbEncryption('index-passphrase');
    await indexProject('p-corrupt', makeProjectData());
    const raw = await readRawIndex('p-corrupt');
    const payload = raw?.['payload'];
    if (!raw || !isSecureRecordEnvelope(payload)) throw new Error('Expected index envelope');
    const ciphertext = new Uint8Array(payload.ciphertext);
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;
    await writeRawIndex({ ...raw, payload: { ...payload, ciphertext } });

    await expect(listIndexedProjects()).rejects.toBeInstanceOf(SecureRecordCorruptError);
  });
});

// ---------------------------------------------------------------------------
// enrichProjectIndex
// ---------------------------------------------------------------------------
describe('enrichProjectIndex', () => {
  it('no-ops silently when project is not yet indexed', async () => {
    await expect(enrichProjectIndex('proj-1')).resolves.toBeUndefined();
    expect(mockEmbedText).not.toHaveBeenCalled();
  });

  it('adds aiSummary and embeddingVector to an existing record', async () => {
    await indexProject('proj-1', makeProjectData());
    await enrichProjectIndex('proj-1');
    const results = await listIndexedProjects();
    const found = results.find((r) => r.projectId === 'proj-1');
    expect(found?.aiSummary).toBeTypeOf('string');
    expect(found?.aiSummary?.length).toBeGreaterThan(0);
    expect(Array.isArray(found?.embeddingVector)).toBe(true);
    expect(found?.embeddingVector?.length).toBeGreaterThan(0);
  });

  it('aiSummary is at most 100 characters', async () => {
    await indexProject(
      'proj-1',
      makeProjectData({ title: 'T'.repeat(200), logline: 'L'.repeat(200) }),
    );
    await enrichProjectIndex('proj-1');
    const results = await listIndexedProjects();
    const found = results.find((r) => r.projectId === 'proj-1');
    expect(found?.aiSummary?.length ?? 0).toBeLessThanOrEqual(100);
  });

  it('silently skips when embedText throws (model not loaded)', async () => {
    mockEmbedText.mockRejectedValue(new Error('model not loaded'));
    await indexProject('proj-1', makeProjectData());
    await expect(enrichProjectIndex('proj-1')).resolves.toBeUndefined();
    // Record should remain unchanged (no embeddingVector)
    const results = await listIndexedProjects();
    const found = results.find((r) => r.projectId === 'proj-1');
    expect(found?.embeddingVector).toBeUndefined();
  });

  it('calls embedText with a synopsis derived from title + logline + characters', async () => {
    await indexProject('proj-1', makeProjectData());
    await enrichProjectIndex('proj-1');
    expect(mockEmbedText).toHaveBeenCalledOnce();
    const arg: string = mockEmbedText.mock.calls[0]?.[0];
    expect(arg).toContain('My Novel');
    expect(arg).toContain('A hero saves the world');
  });
});

// ---------------------------------------------------------------------------
// semanticSearchProjects
// ---------------------------------------------------------------------------
describe('semanticSearchProjects', () => {
  it('returns empty array when index is empty', async () => {
    const results = await semanticSearchProjects('adventure');
    expect(results).toEqual([]);
  });

  it('returns up to topK results', async () => {
    await indexProject('proj-1', makeProjectData({ title: 'Alpha' }));
    await indexProject('proj-2', makeProjectData({ id: 'proj-2', title: 'Beta' }));
    mockCosineSimilarity.mockReturnValue(0.5);
    const results = await semanticSearchProjects('some query', 1);
    expect(results).toHaveLength(1);
  });

  it('uses cosineSimilarity when records have embeddingVector', async () => {
    await indexProject('proj-1', makeProjectData());
    await enrichProjectIndex('proj-1'); // adds embeddingVector
    mockCosineSimilarity.mockReturnValue(0.9);
    const results = await semanticSearchProjects('adventure hero', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(mockCosineSimilarity).toHaveBeenCalled();
  });

  it('falls back to keyword scoring when embedText throws', async () => {
    mockEmbedText.mockRejectedValue(new Error('no model'));
    await indexProject(
      'proj-1',
      makeProjectData({ title: 'Dragon Quest', logline: 'A dragon epic.' }),
    );
    const results = await semanticSearchProjects('dragon');
    expect(results.length).toBeGreaterThan(0);
    // Keyword fallback should find the matching project
    expect(results[0]?.projectId).toBe('proj-1');
  });

  it('keyword fallback scores title/logline matches', async () => {
    mockEmbedText.mockRejectedValue(new Error('no model'));
    await indexProject(
      'proj-1',
      makeProjectData({ title: 'Space Opera', logline: 'Spaceship battles.' }),
    );
    await indexProject(
      'proj-2',
      makeProjectData({ id: 'proj-2', title: 'Farm Story', logline: 'Cows and fields.' }),
    );
    const results = await semanticSearchProjects('space');
    const first = results[0];
    expect(first?.projectId).toBe('proj-1');
  });
});
