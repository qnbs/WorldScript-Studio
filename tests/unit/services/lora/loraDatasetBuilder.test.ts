import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../services/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../../../services/geminiService', () => ({
  generateText: vi
    .fn()
    .mockResolvedValue(
      'Generated synthetic output text for testing purposes that is definitely long enough to pass the minimum character threshold of eighty characters required by the generateSyntheticPairs function in the loraDatasetBuilder module.',
    ),
}));

vi.mock('../../../../services/storageService', () => ({
  storageService: {
    loadProject: vi.fn().mockResolvedValue({
      manuscript: [
        {
          id: '1',
          title: 'Test Scene',
          content:
            'This is test scene content with enough words to pass the minimum word count threshold for extraction.',
        },
        { id: '2', title: 'Short', content: 'Too short' },
        {
          id: '3',
          title: 'Long Scene',
          content:
            'This is a very long scene content that exceeds the maximum word count threshold and should be filtered out during extraction. We need to add many more words to make sure this passes the six hundred word limit that is set in the dataset builder configuration for maximum word count per scene entry.',
        },
      ],
    }),
  },
}));

vi.mock('../../../../services/ai/localEmbeddingService', () => ({
  embedText: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loraDatasetBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('extractScenePairs', () => {
    it('extracts valid scene pairs within word count range', async () => {
      const { extractScenePairs } = await import('../../../../services/lora/loraDatasetBuilder');

      const result = await extractScenePairs('test-project');

      // Only the middle scene (30-600 words) should be extracted
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]?.source).toBe('extracted');
      expect(result[0]?.projectId).toBe('test-project');
    });

    it('returns empty array when project load fails', async () => {
      const { storageService } = await import('../../../../services/storageService');
      vi.mocked(storageService.loadProject).mockRejectedValueOnce(new Error('Load failed'));

      const { extractScenePairs } = await import('../../../../services/lora/loraDatasetBuilder');
      const result = await extractScenePairs('bad-project');

      expect(result).toEqual([]);
    });
  });

  describe('scoreDatasetEntries', () => {
    it('scores entries with quality scores', async () => {
      const { scoreDatasetEntries } = await import('../../../../services/lora/loraDatasetBuilder');

      const entries = [
        {
          id: '1',
          projectId: 'test',
          instruction: 'Continue this scene',
          input: 'Input text',
          output: 'Output text for scoring purposes',
          source: 'extracted' as const,
          qualityScore: 0,
          wordCount: 50,
          createdAt: Date.now(),
        },
      ];

      const result = await scoreDatasetEntries(entries);

      expect(result.length).toBe(1);
      expect(result[0]?.qualityScore).toBeGreaterThanOrEqual(0);
      expect(result[0]?.qualityScore).toBeLessThanOrEqual(1);
    });

    it('returns entries with default score on embedding failure', async () => {
      const { embedText } = await import('../../../../services/ai/localEmbeddingService');
      vi.mocked(embedText).mockRejectedValueOnce(new Error('Embedding failed'));

      const { scoreDatasetEntries } = await import('../../../../services/lora/loraDatasetBuilder');

      const entries = [
        {
          id: '1',
          projectId: 'test',
          instruction: 'Test instruction',
          input: 'Test input',
          output: 'Test output',
          source: 'extracted' as const,
          qualityScore: 0,
          wordCount: 50,
          createdAt: Date.now(),
        },
      ];

      const result = await scoreDatasetEntries(entries);

      expect(result[0]?.qualityScore).toBe(0.5);
    });

    it('returns empty array unchanged', async () => {
      const { scoreDatasetEntries } = await import('../../../../services/lora/loraDatasetBuilder');

      const result = await scoreDatasetEntries([]);

      expect(result).toEqual([]);
    });
  });

  describe('generateSyntheticPairs', () => {
    it('generates synthetic pairs from seed entries', async () => {
      const { generateSyntheticPairs } = await import(
        '../../../../services/lora/loraDatasetBuilder'
      );

      const seed = [
        {
          id: '1',
          projectId: 'test',
          instruction: 'Continue this scene',
          input: 'Input text',
          output:
            'Original output text that is long enough to generate synthetic variations from the seed data provided for testing the dataset builder functionality.',
          source: 'extracted' as const,
          qualityScore: 0.7,
          wordCount: 50,
          createdAt: Date.now(),
        },
      ];

      const result = await generateSyntheticPairs(seed, 3, new AbortController().signal);

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0]?.source).toBe('synthetic');
    });

    it('respects abort signal', async () => {
      const { generateSyntheticPairs } = await import(
        '../../../../services/lora/loraDatasetBuilder'
      );

      const abortController = new AbortController();
      abortController.abort();

      const seed = [
        {
          id: '1',
          projectId: 'test',
          instruction: 'Test',
          input: 'Input',
          output: 'Output text for synthetic generation testing purposes.',
          source: 'extracted' as const,
          qualityScore: 0.5,
          wordCount: 50,
          createdAt: Date.now(),
        },
      ];

      const result = await generateSyntheticPairs(seed, 10, abortController.signal);

      expect(result).toEqual([]);
    });
  });

  describe('estimateDatasetQuality', () => {
    it('estimates quality report for dataset', async () => {
      const { estimateDatasetQuality } = await import(
        '../../../../services/lora/loraDatasetBuilder'
      );

      const entries = [
        {
          id: '1',
          projectId: 'test',
          instruction: 'Test',
          input: 'Input',
          output: 'Output',
          source: 'extracted' as const,
          qualityScore: 0.7,
          wordCount: 100,
          createdAt: Date.now(),
        },
        {
          id: '2',
          projectId: 'test',
          instruction: 'Test2',
          input: 'Input2',
          output: 'Output2',
          source: 'synthetic' as const,
          qualityScore: 0.3,
          wordCount: 50,
          createdAt: Date.now(),
        },
      ];

      const result = estimateDatasetQuality(entries);

      expect(result.totalEntries).toBe(2);
      expect(result.averageQualityScore).toBeCloseTo(0.5);
      expect(result.averageWordCount).toBe(75);
      expect(result.sourceBreakdown.extracted).toBe(1);
      expect(result.sourceBreakdown.synthetic).toBe(1);
    });

    it('returns zeros for empty dataset', async () => {
      const { estimateDatasetQuality } = await import(
        '../../../../services/lora/loraDatasetBuilder'
      );

      const result = estimateDatasetQuality([]);

      expect(result.totalEntries).toBe(0);
      expect(result.averageQualityScore).toBe(0);
      expect(result.averageWordCount).toBe(0);
      expect(result.readyToTrain).toBe(false);
    });
  });

  describe('exportAsJsonl', () => {
    it('exports entries in alpaca format', async () => {
      const { exportAsJsonl } = await import('../../../../services/lora/loraDatasetBuilder');

      const entries = [
        {
          id: '1',
          projectId: 'test',
          instruction: 'Write a story',
          input: 'Once upon a time',
          output: 'The end.',
          source: 'extracted' as const,
          qualityScore: 0.7,
          wordCount: 100,
          createdAt: Date.now(),
        },
      ];

      const result = exportAsJsonl(entries, 'alpaca');

      expect(result).toContain('"instruction"');
      expect(result).toContain('"input"');
      expect(result).toContain('"output"');
    });

    it('exports entries in chatml format', async () => {
      const { exportAsJsonl } = await import('../../../../services/lora/loraDatasetBuilder');

      const entries = [
        {
          id: '1',
          projectId: 'test',
          instruction: 'Write a story',
          input: 'Once upon a time',
          output: 'The end.',
          source: 'extracted' as const,
          qualityScore: 0.7,
          wordCount: 100,
          createdAt: Date.now(),
        },
      ];

      const result = exportAsJsonl(entries, 'chatml');

      expect(result).toContain('"messages"');
      expect(result).toContain('"role"');
    });

    it('exports entries in sharegpt format', async () => {
      const { exportAsJsonl } = await import('../../../../services/lora/loraDatasetBuilder');

      const entries = [
        {
          id: '1',
          projectId: 'test',
          instruction: 'Write a story',
          input: 'Once upon a time',
          output: 'The end.',
          source: 'extracted' as const,
          qualityScore: 0.7,
          wordCount: 100,
          createdAt: Date.now(),
        },
      ];

      const result = exportAsJsonl(entries, 'sharegpt');

      expect(result).toContain('"conversations"');
      expect(result).toContain('"from"');
    });

    it('filters out low-quality entries', async () => {
      const { exportAsJsonl } = await import('../../../../services/lora/loraDatasetBuilder');

      const entries = [
        {
          id: '1',
          projectId: 'test',
          instruction: 'High quality',
          input: 'Input',
          output: 'Output',
          source: 'extracted' as const,
          qualityScore: 0.7,
          wordCount: 100,
          createdAt: Date.now(),
        },
        {
          id: '2',
          projectId: 'test',
          instruction: 'Low quality',
          input: 'Input',
          output: 'Output',
          source: 'extracted' as const,
          qualityScore: 0.2,
          wordCount: 100,
          createdAt: Date.now(),
        },
      ];

      const result = exportAsJsonl(entries, 'alpaca');

      // Only high quality entry should be exported
      const parsed = JSON.parse(result);
      expect(parsed.instruction).toBe('High quality');
    });
  });
});
