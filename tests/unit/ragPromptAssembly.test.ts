import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/ai/localEmbeddingService', () => ({
  embedText: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
}));

vi.mock('../../services/localRagService', () => ({
  retrieveContext: vi.fn(),
}));

import { retrieveContext } from '../../services/localRagService';
import {
  assembleRAGPrompt,
  buildRAGContextBlock,
  deduplicateChunksBySection,
  estimateTokens,
} from '../../services/ragPromptAssembly';

const mockRetrieve = vi.mocked(retrieveContext);

beforeEach(() => {
  vi.clearAllMocks();
  mockRetrieve.mockResolvedValue([
    {
      score: 0.9,
      text: 'The hero arrived at dawn.',
      sectionId: 's1',
      chunkIndex: 0,
      indexedAt: Date.now(),
    },
    {
      score: 0.85,
      text: 'The hero arrived again.',
      sectionId: 's1',
      chunkIndex: 1,
      indexedAt: Date.now(),
    },
  ]);
});

describe('estimateTokens', () => {
  it('returns positive estimate for non-empty text', () => {
    expect(estimateTokens('hello world')).toBeGreaterThan(0);
  });
});

describe('deduplicateChunksBySection', () => {
  it('keeps highest score per section', () => {
    const chunks = deduplicateChunksBySection([
      { score: 0.5, text: 'a', sectionId: 's1', chunkIndex: 0, indexedAt: 0 },
      { score: 0.9, text: 'b', sectionId: 's1', chunkIndex: 1, indexedAt: 0 },
      { score: 0.7, text: 'c', sectionId: 's2', chunkIndex: 0, indexedAt: 0 },
    ]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.text).toBe('b');
  });
});

describe('buildRAGContextBlock', () => {
  it('includes section attribution', () => {
    const block = buildRAGContextBlock(
      [{ score: 0.8, text: 'Scene text here.', sectionId: 's1', chunkIndex: 0, indexedAt: 0 }],
      [{ id: 's1', title: 'Chapter 1', content: '' }],
      2000,
    );
    expect(block).toContain('Chapter 1');
    expect(block).toContain('Scene text');
  });
});

describe('assembleRAGPrompt', () => {
  it('assembles writer continuation with RAG block', async () => {
    const result = await assembleRAGPrompt(
      'writerContinuation',
      {
        projectId: 'p1',
        currentText: 'She opened the door.',
        style: 'literary',
        lang: 'en',
        manuscript: [{ id: 's1', title: 'Ch1', content: 'x' }],
      },
      { topK: 5, ragMode: 'hybrid', maxTokens: 4000, duckDbEnabled: false, useRag: true },
    );
    expect(result.ragUsed).toBe(true);
    expect(result.prompt).toContain('RELEVANT STORY CONTEXT');
    expect(result.chunks.length).toBeGreaterThan(0);
  });

  it('falls back without RAG when useRag false', async () => {
    const result = await assembleRAGPrompt(
      'writerContinuation',
      { projectId: 'p1', currentText: 'Text.', lang: 'en' },
      { topK: 5, ragMode: 'lexical', maxTokens: 4000, duckDbEnabled: false, useRag: false },
    );
    expect(result.ragUsed).toBe(false);
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(result.prompt).toContain('CURRENT PASSAGE');
  });
});
