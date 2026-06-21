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

vi.mock('../../services/ai/localEmbeddingService', () => ({
  embedText: vi.fn().mockImplementation(async () => new Float32Array(384).fill(0.1)),
  cosineSimilarity: vi.fn(),
}));

import { embedText } from '../../services/ai/localEmbeddingService';
import { duckdbRagWrite, queryRagSimilarity } from '../../services/duckdb/duckdbAnalytics';
import { rebuildHybridRagIndex, retrieveContext } from '../../services/localRagService';
import { storageService } from '../../services/storageService';

const mockRagWrite = vi.mocked(duckdbRagWrite);
const mockRagSimilarity = vi.mocked(queryRagSimilarity);
const mockSaveRagVectors = vi.mocked(storageService.saveRagVectors);
const mockGetRagVectors = vi.mocked(storageService.getRagVectors);
const mockEmbed = vi.mocked(embedText);

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
      { id: string; sectionId: string; chunkIndex: number; embedding: Float32Array }[],
    ];
    expect(projectId).toBe('p1');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toMatchObject({ sectionId: 's1', chunkIndex: 0 });
    expect(chunks[0]?.embedding).toBeInstanceOf(Float32Array);
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

  // QNBS-v3: SEC — the gate may be a callback re-evaluated at write time (after the async embedding
  // loop), so a privacy opt-out toggled mid-rebuild is honoured.
  it('calls duckdbRagWrite when the duckDbEnabled callback returns true at write time', async () => {
    await rebuildHybridRagIndex('p1', manuscript, () => true);
    await Promise.resolve();
    expect(mockRagWrite).toHaveBeenCalledOnce();
  });

  it('does NOT call duckdbRagWrite when the duckDbEnabled callback returns false at write time', async () => {
    await rebuildHybridRagIndex('p1', manuscript, () => false);
    await Promise.resolve();
    expect(mockRagWrite).not.toHaveBeenCalled();
  });

  // QNBS-v3: SEC — prove the decision is made at WRITE time, not function entry: flip the gate to
  // false DURING the async embedding loop (embedText is awaited per chunk). A service that evaluated
  // the callback once at entry (when it was true) would still write; the write-time contract must not.
  it('honours a mid-rebuild opt-out: gate flipped false during embedding suppresses the write', async () => {
    let allowed = true;
    mockEmbed.mockImplementation(async () => {
      allowed = false; // user toggles Privacy → Analytics off while embeddings are computing
      return new Float32Array(384).fill(0.1);
    });
    await rebuildHybridRagIndex('p1', manuscript, () => allowed);
    await Promise.resolve();
    expect(mockSaveRagVectors).toHaveBeenCalledOnce(); // local index still rebuilt
    expect(mockRagWrite).not.toHaveBeenCalled(); // but no DuckDB mirror write
  });

  it('mid-rebuild opt-IN: gate flipped true during embedding allows the write', async () => {
    let allowed = false;
    mockEmbed.mockImplementation(async () => {
      allowed = true;
      return new Float32Array(384).fill(0.1);
    });
    await rebuildHybridRagIndex('p1', manuscript, () => allowed);
    await Promise.resolve();
    expect(mockRagWrite).toHaveBeenCalledOnce();
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
