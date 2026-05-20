// QNBS-v3: P2 — verify DuckDB RAG write path and DuckDB-backed retrieveContext.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/duckdb/duckdbAnalytics', () => ({
  duckdbRagWrite: vi.fn().mockResolvedValue(undefined),
  queryRagSimilarity: vi.fn(),
}));

vi.mock('../../services/storageService', () => ({
  storageService: {
    saveRagVectors: vi.fn().mockResolvedValue(undefined),
    getRagVectors: vi.fn(),
  },
}));

// embedText may not be available in test env — mock it to avoid loading ONNX
vi.mock('../../services/ai/localEmbeddingService', () => ({
  embedText: vi.fn().mockRejectedValue(new Error('model not loaded')),
  cosineSimilarity: vi.fn(),
}));

import { duckdbRagWrite, queryRagSimilarity } from '../../services/duckdb/duckdbAnalytics';
import { rebuildHybridRagIndex, retrieveContext } from '../../services/localRagService';
import { storageService } from '../../services/storageService';

const mockRagWrite = vi.mocked(duckdbRagWrite);
const mockRagSimilarity = vi.mocked(queryRagSimilarity);
const mockSaveRagVectors = vi.mocked(storageService.saveRagVectors);
const mockGetRagVectors = vi.mocked(storageService.getRagVectors);

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveRagVectors.mockResolvedValue(undefined);
  mockGetRagVectors.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// rebuildHybridRagIndex — DuckDB dual-write
// ---------------------------------------------------------------------------
describe('rebuildHybridRagIndex — DuckDB dual-write', () => {
  const manuscript = [
    { id: 's1', title: 'Chapter 1', content: 'The hero arrived at dawn ready for battle.' },
    { id: 's2', title: 'Chapter 2', content: 'She crossed the river slowly under moonlight.' },
  ];

  it('calls duckdbRagWrite when duckDbEnabled=true', async () => {
    await rebuildHybridRagIndex('p1', manuscript, true);

    expect(mockSaveRagVectors).toHaveBeenCalledOnce();
    // Give fire-and-forget time to settle
    await Promise.resolve();
    expect(mockRagWrite).toHaveBeenCalledOnce();
    const [projectId, chunks] = mockRagWrite.mock.calls[0] as [
      string,
      { id: string; sectionId: string; chunkIndex: number; vector: number[] }[],
    ];
    expect(projectId).toBe('p1');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toMatchObject({ sectionId: 's1', chunkIndex: 0 });
    expect(Array.isArray(chunks[0]?.vector)).toBe(true);
  });

  it('does NOT call duckdbRagWrite when duckDbEnabled=false (default)', async () => {
    await rebuildHybridRagIndex('p1', manuscript);
    await Promise.resolve();
    expect(mockRagWrite).not.toHaveBeenCalled();
  });

  it('does NOT call duckdbRagWrite for empty manuscript', async () => {
    await rebuildHybridRagIndex('p1', [], true);
    await Promise.resolve();
    expect(mockRagWrite).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// retrieveContext — DuckDB query path
// ---------------------------------------------------------------------------
describe('retrieveContext — DuckDB path', () => {
  const idbChunks = [
    {
      id: 's1:0',
      sectionId: 's1',
      chunkIndex: 0,
      text: 'The hero arrived at dawn.',
      vector: new Array(64).fill(0.1),
      indexedAt: Date.now(),
    },
    {
      id: 's2:0',
      sectionId: 's2',
      chunkIndex: 0,
      text: 'She crossed the river.',
      vector: new Array(64).fill(0.05),
      indexedAt: Date.now() - 1000,
    },
  ];

  beforeEach(() => {
    mockGetRagVectors.mockResolvedValue(idbChunks);
    mockRagSimilarity.mockResolvedValue([
      { chunk_id: 's1:0', section_id: 's1', chunk_index: 0, score: 0.92 },
    ]);
  });

  it('uses DuckDB ranking when useDuckDb=true and queryEmbedding provided', async () => {
    const embedding = new Float32Array(64).fill(0.5);
    const results = await retrieveContext('p1', 'hero', 5, 'semantic', embedding, true);

    expect(mockRagSimilarity).toHaveBeenCalledWith('p1', embedding, 5);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      score: 0.92,
      text: 'The hero arrived at dawn.',
      sectionId: 's1',
    });
  });

  it('returns empty when DuckDB row has no matching IDB record', async () => {
    mockRagSimilarity.mockResolvedValue([
      { chunk_id: 'missing:0', section_id: 'missing', chunk_index: 0, score: 0.8 },
    ]);

    const embedding = new Float32Array(64).fill(0.5);
    const results = await retrieveContext('p1', 'hero', 5, 'semantic', embedding, true);
    expect(results).toHaveLength(0);
  });

  it('falls back to JS path when useDuckDb=false', async () => {
    const embedding = new Float32Array(64).fill(0.5);
    await retrieveContext('p1', 'hero', 5, 'lexical', embedding, false);
    expect(mockRagSimilarity).not.toHaveBeenCalled();
    expect(mockGetRagVectors).toHaveBeenCalled();
  });

  it('falls back to JS path when queryEmbedding absent even if useDuckDb=true', async () => {
    await retrieveContext('p1', 'hero', 5, 'lexical', undefined, true);
    expect(mockRagSimilarity).not.toHaveBeenCalled();
    expect(mockGetRagVectors).toHaveBeenCalled();
  });
});
