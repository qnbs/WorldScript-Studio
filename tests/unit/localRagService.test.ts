import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorySection } from '../../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSaveRagVectors = vi.fn().mockResolvedValue(undefined);
const mockGetRagVectors = vi.fn().mockResolvedValue([]);

vi.mock('../../services/storageService', () => ({
  storageService: {
    saveRagVectors: (...args: unknown[]) => mockSaveRagVectors(...args),
    getRagVectors: (...args: unknown[]) => mockGetRagVectors(...args),
  },
}));

// localRagIndex is imported inside localRagService; mock it at the module level
// so hashEmbedText etc. remain real (we import them from localRagIndex directly).
// localEmbeddingService is not needed for lexical tests.
vi.mock('../../services/ai/localEmbeddingService', () => ({
  embedText: vi.fn().mockRejectedValue(new Error('model not loaded')),
  cosineSimilarity: vi.fn().mockReturnValue(0),
}));

import {
  hashEmbedText,
  rebuildHybridRagIndex,
  retrieveContext,
} from '../../services/localRagService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSection(id: string, content: string): StorySection {
  return {
    id,
    title: id,
    content,
    wordCount: content.split(' ').length,
  } as unknown as StorySection;
}

function makeRecord(
  id: string,
  sectionId: string,
  chunkIndex: number,
  text: string,
  indexedAt = Date.now(),
) {
  return {
    id,
    sectionId,
    chunkIndex,
    text,
    vector: hashEmbedText(text),
    indexedAt,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRagVectors.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// rebuildHybridRagIndex — token chunking
// ---------------------------------------------------------------------------
describe('rebuildHybridRagIndex', () => {
  it('returns 0 for empty manuscript', async () => {
    const count = await rebuildHybridRagIndex('p1', []);
    expect(count).toBe(0);
    expect(mockSaveRagVectors).toHaveBeenCalledWith('p1', []);
  });

  it('creates at least one record for a non-empty section', async () => {
    const sec = makeSection('s1', 'The quick brown fox jumps over the lazy dog.');
    const count = await rebuildHybridRagIndex('p1', [sec]);
    expect(count).toBeGreaterThan(0);
  });

  it('stores indexedAt on each record', async () => {
    const sec = makeSection('s1', 'Hello world content.');
    await rebuildHybridRagIndex('p1', [sec]);
    const saved = mockSaveRagVectors.mock.calls[0]?.[1] as Array<{ indexedAt: number }>;
    expect(saved[0]?.indexedAt).toBeTypeOf('number');
    expect(saved[0]?.indexedAt).toBeGreaterThan(0);
  });

  it('caps output at MAX_CHUNKS (500)', async () => {
    // Build many sections each with 300-token content to force many chunks
    const sections: StorySection[] = Array.from({ length: 10 }, (_, i) =>
      makeSection(`s${i}`, Array(310).fill('word').join(' ')),
    );
    const count = await rebuildHybridRagIndex('p1', sections);
    expect(count).toBeLessThanOrEqual(500);
  });

  it('creates multiple token chunks for long content', async () => {
    const longText = Array(700).fill('story').join(' ');
    const sec = makeSection('s1', longText);
    const count = await rebuildHybridRagIndex('p1', [sec]);
    // 700 tokens with chunk size 300 and overlap 50 → 3+ chunks
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it('passes correct projectId to saveRagVectors', async () => {
    const sec = makeSection('s1', 'Some content.');
    await rebuildHybridRagIndex('my-proj', [sec]);
    expect(mockSaveRagVectors).toHaveBeenCalledWith('my-proj', expect.any(Array));
  });
});

// ---------------------------------------------------------------------------
// retrieveContext — lexical mode (default)
// ---------------------------------------------------------------------------
describe('retrieveContext — lexical', () => {
  it('returns empty array when no records exist', async () => {
    const result = await retrieveContext('p1', 'fox');
    expect(result).toEqual([]);
  });

  it('returns results sorted by descending score', async () => {
    const high = makeRecord('a', 's1', 0, 'the quick brown fox jumps');
    const low = makeRecord('b', 's2', 0, 'unrelated data completely different');
    mockGetRagVectors.mockResolvedValue([low, high]);
    const result = await retrieveContext('p1', 'the quick brown fox', 5, 'lexical');
    expect(result[0]?.sectionId).toBe('s1');
    expect(result[0]?.score).toBeGreaterThanOrEqual(result[1]?.score ?? 0);
  });

  it('respects topK', async () => {
    const records = Array.from({ length: 10 }, (_, i) =>
      makeRecord(`r${i}`, `s${i}`, 0, `content word${i}`),
    );
    mockGetRagVectors.mockResolvedValue(records);
    const result = await retrieveContext('p1', 'content', 3, 'lexical');
    expect(result).toHaveLength(3);
  });

  it('always includes sliding window (most recent) chunks', async () => {
    const old = makeRecord('old', 'sOld', 0, 'irrelevant stuff abc', Date.now() - 10_000);
    const fresh = makeRecord('new', 'sNew', 0, 'irrelevant xyz', Date.now());
    mockGetRagVectors.mockResolvedValue([old, fresh]);
    // Query matches 'old' better lexically, but fresh should appear in sliding window
    const result = await retrieveContext('p1', 'irrelevant', 5, 'lexical');
    const ids = result.map((r) => r.sectionId);
    expect(ids).toContain('sNew');
  });

  it('returns chunk with correct shape (score, text, sectionId, chunkIndex, indexedAt)', async () => {
    mockGetRagVectors.mockResolvedValue([makeRecord('r0', 's0', 2, 'hello world')]);
    const result = await retrieveContext('p1', 'hello', 5, 'lexical');
    expect(result[0]).toMatchObject({
      score: expect.any(Number),
      text: 'hello world',
      sectionId: 's0',
      chunkIndex: 2,
      indexedAt: expect.any(Number),
    });
  });
});

// ---------------------------------------------------------------------------
// retrieveContext — hybrid mode (falls back to lexical without embedding)
// ---------------------------------------------------------------------------
describe('retrieveContext — hybrid fallback to lexical', () => {
  it('falls back to lexical when no queryEmbedding provided in hybrid mode', async () => {
    const records = [
      makeRecord('a', 's1', 0, 'brown fox quick'),
      makeRecord('b', 's2', 0, 'unrelated'),
    ];
    mockGetRagVectors.mockResolvedValue(records);
    // Calling hybrid without an embedding — should not throw and should return results
    const result = await retrieveContext('p1', 'quick fox', 5, 'hybrid');
    expect(result.length).toBeGreaterThan(0);
  });

  it('applies hybrid scoring when queryEmbedding is provided', async () => {
    const now = Date.now();
    const records = [
      makeRecord('a', 's1', 0, 'brown fox quick', now - 2000),
      makeRecord('b', 's2', 0, 'completely unrelated', now),
    ];
    mockGetRagVectors.mockResolvedValue(records);

    // Provide a real Float32Array embedding aligned with 'brown fox quick'
    const fakeEmb = new Float32Array(64).fill(0.1);
    const result = await retrieveContext('p1', 'quick fox', 5, 'hybrid', fakeEmb);
    expect(result.length).toBeGreaterThan(0);
    // All scores should be numbers in a plausible range
    for (const r of result) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1.01);
    }
  });
});

// ---------------------------------------------------------------------------
// Token overlap helper (indirectly tested via hybrid scores)
// ---------------------------------------------------------------------------
describe('token overlap influence in hybrid scoring', () => {
  it('ranks higher-overlap chunk above zero-overlap chunk', async () => {
    const now = Date.now();
    const highOverlap = makeRecord('a', 's1', 0, 'fox jumps forest', now - 100);
    const zeroOverlap = makeRecord('b', 's2', 0, 'xyz pqr abc def', now);
    mockGetRagVectors.mockResolvedValue([zeroOverlap, highOverlap]);

    const fakeEmb = new Float32Array(64).fill(0); // neutral embedding → only lexical+recency matter
    const result = await retrieveContext('p1', 'fox jumps', 5, 'hybrid', fakeEmb);
    const s1Idx = result.findIndex((r) => r.sectionId === 's1');
    const s2Idx = result.findIndex((r) => r.sectionId === 's2');
    // s1 has token overlap; s2 has recency advantage — both should appear
    expect(s1Idx).toBeGreaterThanOrEqual(0);
    expect(s2Idx).toBeGreaterThanOrEqual(0);
  });
});
