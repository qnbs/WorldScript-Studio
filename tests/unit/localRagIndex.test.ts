import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashEmbedText, rebuildLocalRagIndex, searchLocalRag } from '../../services/localRagIndex';
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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRagVectors.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// hashEmbedText
// ---------------------------------------------------------------------------
describe('hashEmbedText', () => {
  it('returns a vector of the default length (64)', () => {
    const vec = hashEmbedText('hello world');
    expect(vec).toHaveLength(64);
  });

  it('returns a vector of a custom dimension', () => {
    const vec = hashEmbedText('hello', 32);
    expect(vec).toHaveLength(32);
  });

  it('returns L2-normalised vector (magnitude ≈ 1)', () => {
    const vec = hashEmbedText('the quick brown fox jumps');
    const mag = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
    expect(mag).toBeCloseTo(1, 5);
  });

  it('is deterministic — same text always produces same vector', () => {
    expect(hashEmbedText('repeat me')).toEqual(hashEmbedText('repeat me'));
  });

  it('produces different vectors for different texts', () => {
    const a = hashEmbedText('alpha text');
    const b = hashEmbedText('beta text totally different');
    expect(a).not.toEqual(b);
  });

  it('handles empty string without throwing', () => {
    const vec = hashEmbedText('');
    expect(vec).toHaveLength(64);
    // Empty → no tokens → zero vector → norm branch returns 1/1 * 0 = 0
    expect(vec.every((v) => v === 0)).toBe(true);
  });

  it('handles unicode text', () => {
    const vec = hashEmbedText('Über die Bäche und Wälder');
    expect(vec).toHaveLength(64);
    const mag = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
    expect(mag).toBeCloseTo(1, 5);
  });
});

// ---------------------------------------------------------------------------
// rebuildLocalRagIndex
// ---------------------------------------------------------------------------
describe('rebuildLocalRagIndex', () => {
  it('returns 0 for empty manuscript', async () => {
    const count = await rebuildLocalRagIndex('proj-1', []);
    expect(count).toBe(0);
    expect(mockSaveRagVectors).toHaveBeenCalledWith('proj-1', []);
  });

  it('creates one record per non-empty chunk', async () => {
    const sections: StorySection[] = [
      {
        id: 's1',
        title: 'Act I',
        content: 'Short paragraph.',
        wordCount: 2,
      } as unknown as StorySection,
    ];
    const count = await rebuildLocalRagIndex('proj-1', sections);
    expect(count).toBeGreaterThan(0);
    const savedRecords = mockSaveRagVectors.mock.calls[0]?.[1] as unknown[];
    expect(Array.isArray(savedRecords)).toBe(true);
    expect(savedRecords.length).toBe(count);
  });

  it('skips sections with empty content', async () => {
    const sections: StorySection[] = [
      { id: 's1', title: 'Empty', content: '', wordCount: 0 } as unknown as StorySection,
      {
        id: 's2',
        title: 'Full',
        content: 'Some real content here.',
        wordCount: 4,
      } as unknown as StorySection,
    ];
    const count = await rebuildLocalRagIndex('proj-2', sections);
    expect(count).toBe(1);
  });

  it('passes the correct projectId to saveRagVectors', async () => {
    const sections: StorySection[] = [
      { id: 's1', title: 'S1', content: 'Hello', wordCount: 1 } as unknown as StorySection,
    ];
    await rebuildLocalRagIndex('my-project-id', sections);
    expect(mockSaveRagVectors).toHaveBeenCalledWith('my-project-id', expect.any(Array));
  });
});

// ---------------------------------------------------------------------------
// searchLocalRag
// ---------------------------------------------------------------------------
describe('searchLocalRag', () => {
  it('returns empty array when index is empty', async () => {
    const results = await searchLocalRag('proj-1', 'anything');
    expect(results).toEqual([]);
  });

  it('returns results sorted by descending score', async () => {
    const vec = hashEmbedText('the quick brown fox');
    const unrelated = hashEmbedText('zzzzzz totally different content here hello');
    mockGetRagVectors.mockResolvedValue([
      { id: 'a', sectionId: 's2', chunkIndex: 0, text: 'Unrelated content', vector: unrelated },
      { id: 'b', sectionId: 's1', chunkIndex: 0, text: 'the quick brown fox', vector: vec },
    ]);
    const results = await searchLocalRag('proj-1', 'the quick brown fox');
    expect(results[0]?.sectionId).toBe('s1');
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it('limits results to topK', async () => {
    const records = Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`,
      sectionId: `s${i}`,
      chunkIndex: 0,
      text: `content ${i}`,
      vector: hashEmbedText(`content ${i}`),
    }));
    mockGetRagVectors.mockResolvedValue(records);
    const results = await searchLocalRag('proj-1', 'content', 3);
    expect(results).toHaveLength(3);
  });

  it('filters out records with wrong vector dimension', async () => {
    mockGetRagVectors.mockResolvedValue([
      { id: 'x', sectionId: 'sx', chunkIndex: 0, text: 'text', vector: [1, 2, 3] }, // wrong dim
    ]);
    const results = await searchLocalRag('proj-1', 'text');
    expect(results).toHaveLength(0);
  });
});
