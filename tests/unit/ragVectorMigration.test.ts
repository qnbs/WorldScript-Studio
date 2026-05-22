import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/duckdb/duckdbClient', () => ({
  duckdbClient: {
    query: vi.fn(),
    exec: vi.fn(),
  },
}));

vi.mock('../../services/duckdb/duckdbAnalytics', () => ({
  duckdbRagWrite: vi.fn(),
}));

vi.mock('../../services/ai/localEmbeddingService', () => ({
  embedText: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
}));

vi.mock('../../services/localRagService', () => ({
  rebuildHybridRagIndex: vi.fn(),
}));

vi.mock('../../services/storageService', () => ({
  storageService: {
    getRagVectors: vi.fn(),
  },
}));

vi.mock('../../services/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { duckdbClient } from '../../services/duckdb/duckdbClient';
import {
  isRagVectorMigrationDone,
  runRagVectorMigration,
  verifyEmbeddingColumn,
} from '../../services/duckdb/ragVectorMigration';
import { storageService } from '../../services/storageService';

const mockQuery = vi.mocked(duckdbClient.query);
const mockExec = vi.mocked(duckdbClient.exec);
const mockGetRagVectors = vi.mocked(storageService.getRagVectors);

beforeEach(() => {
  vi.clearAllMocks();
  mockExec.mockResolvedValue({ messageId: 'm', ok: true });
});

// ---------------------------------------------------------------------------
// verifyEmbeddingColumn — CI smoke-test export (DB-1)
// ---------------------------------------------------------------------------
describe('verifyEmbeddingColumn', () => {
  it('returns true when embedding column exists in information_schema', async () => {
    mockQuery.mockResolvedValueOnce({
      messageId: 'm',
      ok: true,
      rows: [{ column_name: 'embedding' }],
    });
    expect(await verifyEmbeddingColumn()).toBe(true);
  });

  it('returns false when embedding column is absent (empty rows)', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [] });
    expect(await verifyEmbeddingColumn()).toBe(false);
  });

  it('returns false when query fails (ok: false)', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: false });
    expect(await verifyEmbeddingColumn()).toBe(false);
  });

  it('queries information_schema.columns for rag_chunks.embedding', async () => {
    mockQuery.mockResolvedValueOnce({
      messageId: 'm',
      ok: true,
      rows: [{ column_name: 'embedding' }],
    });
    await verifyEmbeddingColumn();
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("table_name = 'rag_chunks'"));
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("column_name = 'embedding'"));
  });
});

// ---------------------------------------------------------------------------
// isRagVectorMigrationDone
// ---------------------------------------------------------------------------
describe('isRagVectorMigrationDone', () => {
  it('returns true when _meta row exists', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [{ value: '1' }] });
    expect(await isRagVectorMigrationDone()).toBe(true);
  });

  it('returns false when no _meta row', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [] });
    expect(await isRagVectorMigrationDone()).toBe(false);
  });

  it('returns false when query returns ok: false', async () => {
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: false });
    expect(await isRagVectorMigrationDone()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runRagVectorMigration
// ---------------------------------------------------------------------------
describe('runRagVectorMigration', () => {
  it('returns { migrated: 0 } when migration already done', async () => {
    // _meta query returns a row → migration already done
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [{ value: '1' }] });
    const result = await runRagVectorMigration('proj-1', []);
    expect(result).toEqual({ migrated: 0 });
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('rebuilds RAG index when IDB has no vectors but manuscript has sections', async () => {
    const { rebuildHybridRagIndex } = await import('../../services/localRagService');
    // migration not done
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [] });
    mockGetRagVectors.mockResolvedValueOnce([]);
    const manuscript = [{ id: 's1', title: 'Ch1', content: 'Text.' }];
    await runRagVectorMigration('proj-1', manuscript as never);
    expect(vi.mocked(rebuildHybridRagIndex)).toHaveBeenCalledWith('proj-1', manuscript, true);
    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('rag_vectors_v2_migrated'));
  });

  it('migrates stored IDB chunks into DuckDB and marks migration done', async () => {
    const { duckdbRagWrite } = await import('../../services/duckdb/duckdbAnalytics');
    const { embedText } = await import('../../services/ai/localEmbeddingService');
    // migration not done
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [] });
    mockGetRagVectors.mockResolvedValueOnce([
      {
        id: 'c1',
        sectionId: 's1',
        chunkIndex: 0,
        text: 'Some scene text.',
        vector: [0.1, 0.2],
      },
    ]);
    await runRagVectorMigration('proj-1', []);
    expect(vi.mocked(embedText)).toHaveBeenCalledWith('Some scene text.');
    expect(vi.mocked(duckdbRagWrite)).toHaveBeenCalledWith(
      'proj-1',
      expect.arrayContaining([expect.objectContaining({ id: 'c1', sectionId: 's1' })]),
    );
    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('rag_vectors_v2_migrated'));
  });

  it('skips blank-text chunks during migration', async () => {
    const { embedText } = await import('../../services/ai/localEmbeddingService');
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [] });
    mockGetRagVectors.mockResolvedValueOnce([
      { id: 'c-blank', sectionId: 's1', chunkIndex: 0, text: '   ', vector: [] },
    ]);
    const result = await runRagVectorMigration('proj-1', []);
    expect(vi.mocked(embedText)).not.toHaveBeenCalled();
    expect(result.migrated).toBe(0);
  });

  it('skips chunk and continues when embedText throws', async () => {
    const { embedText } = await import('../../services/ai/localEmbeddingService');
    vi.mocked(embedText).mockRejectedValueOnce(new Error('embed failed'));
    mockQuery.mockResolvedValueOnce({ messageId: 'm', ok: true, rows: [] });
    mockGetRagVectors.mockResolvedValueOnce([
      { id: 'c1', sectionId: 's1', chunkIndex: 0, text: 'Good text.', vector: [] },
    ]);
    const result = await runRagVectorMigration('proj-1', []);
    // chunk was skipped due to embed error — migrated stays 0
    expect(result.migrated).toBe(0);
  });
});
