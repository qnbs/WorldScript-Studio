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

  it('uses cursorPosition slice for writer query', async () => {
    await assembleRAGPrompt(
      'writerContinuation',
      {
        projectId: 'p1',
        currentText: 'ABCDEFGHIJ',
        cursorPosition: 3,
        lang: 'en',
      },
      { topK: 3, ragMode: 'lexical', maxTokens: 2000, duckDbEnabled: false, useRag: true },
    );
    expect(mockRetrieve).toHaveBeenCalledWith('p1', 'ABC', 3, 'lexical', undefined, false);
  });

  it('assembles plotSuggestion with German lang line', async () => {
    const result = await assembleRAGPrompt(
      'plotSuggestion',
      {
        projectId: 'p1',
        plotSummary: 'Hero confronts villain.',
        selectedSectionIds: [],
        lang: 'de',
      },
      { topK: 3, ragMode: 'lexical', maxTokens: 3000, duckDbEnabled: false, useRag: true },
    );
    expect(result.prompt).toContain('German');
    expect(mockRetrieve).toHaveBeenCalled();
  });

  it('assembles consistencyCheck task', async () => {
    const result = await assembleRAGPrompt(
      'consistencyCheck',
      {
        projectId: 'p1',
        plotSummary: 'Timeline check.',
        selectedSectionIds: ['s1'],
        lang: 'fr',
      },
      { topK: 4, ragMode: 'hybrid', maxTokens: 4000, duckDbEnabled: false, useRag: true },
    );
    expect(result.prompt).toContain('French');
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it('continues when RAG retrieval throws', async () => {
    mockRetrieve.mockRejectedValueOnce(new Error('index offline'));
    const result = await assembleRAGPrompt(
      'writerContinuation',
      { projectId: 'p1', currentText: 'Scene text.', lang: 'en' },
      { topK: 5, ragMode: 'hybrid', maxTokens: 4000, duckDbEnabled: false, useRag: true },
    );
    expect(result.ragUsed).toBe(false);
    expect(result.chunks).toHaveLength(0);
    expect(result.prompt.length).toBeGreaterThan(10);
  });

  it('uses semantic mode with embedding when hybrid', async () => {
    const { embedText } = await import('../../services/ai/localEmbeddingService');
    await assembleRAGPrompt(
      'writerContinuation',
      { projectId: 'p1', currentText: 'Long passage for embedding.', lang: 'es' },
      { topK: 5, ragMode: 'hybrid', maxTokens: 4000, duckDbEnabled: true, useRag: true },
    );
    expect(vi.mocked(embedText)).toHaveBeenCalled();
    expect(mockRetrieve).toHaveBeenCalledWith(
      'p1',
      expect.any(String),
      5,
      'hybrid',
      expect.any(Float32Array),
      true,
    );
  });
});

describe('assembleRAGPrompt — additional branches', () => {
  it('uses Italian lang label', async () => {
    const result = await assembleRAGPrompt(
      'writerContinuation',
      { projectId: 'p1', currentText: 'La storia inizia.', lang: 'it' },
      { topK: 3, ragMode: 'lexical', maxTokens: 3000, duckDbEnabled: false, useRag: false },
    );
    expect(result.prompt).toContain('Italian');
  });

  it('falls back to full text slice when cursorPosition is 0', async () => {
    await assembleRAGPrompt(
      'writerContinuation',
      { projectId: 'p1', currentText: 'Start of the story.', cursorPosition: 0, lang: 'en' },
      { topK: 3, ragMode: 'lexical', maxTokens: 2000, duckDbEnabled: false, useRag: true },
    );
    // QNBS-v3: cursorPosition 0 → empty slice → || fallback slices full text up to 500 chars.
    expect(mockRetrieve).toHaveBeenCalledWith(
      'p1',
      'Start of the story.',
      3,
      'lexical',
      undefined,
      false,
    );
  });

  it('uses plotSuggestion fallback template for consistencyCheck when no RAG chunks', async () => {
    mockRetrieve.mockResolvedValueOnce([]);
    const result = await assembleRAGPrompt(
      'consistencyCheck',
      { projectId: 'p1', plotSummary: 'Timeline check.', selectedSectionIds: [], lang: 'en' },
      { topK: 2, ragMode: 'lexical', maxTokens: 2000, duckDbEnabled: false, useRag: true },
    );
    // QNBS-v3: empty RAG block → fallbackId = 'plotSuggestion' template used instead of base.
    expect(result.ragUsed).toBe(false);
    expect(result.chunks).toHaveLength(0);
    expect(result.prompt.length).toBeGreaterThan(10);
  });
});

describe('buildRAGContextBlock token budget', () => {
  it('stops adding chunks when budget exceeded', () => {
    const short = 'Brief scene beat.';
    const longText = `${'word '.repeat(400)}end.`;
    const block = buildRAGContextBlock(
      [
        { score: 0.9, text: short, sectionId: 's1', chunkIndex: 0, indexedAt: 0 },
        { score: 0.8, text: longText, sectionId: 's2', chunkIndex: 0, indexedAt: 0 },
      ],
      [
        { id: 's1', title: 'A', content: '' },
        { id: 's2', title: 'B', content: '' },
      ],
      80,
    );
    expect(block).toContain('Brief scene');
    expect(block).not.toContain('word word');
  });

  it('truncateAtSentence keeps text when short', () => {
    const block = buildRAGContextBlock(
      [{ score: 1, text: 'Hi.', sectionId: 's1', chunkIndex: 0, indexedAt: 0 }],
      undefined,
      500,
    );
    expect(block).toContain('Hi.');
  });
});
