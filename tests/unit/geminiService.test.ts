import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Type } from '@google/genai';

const mockGenerateContent = vi.fn().mockResolvedValue({ text: 'mock response' });

// Mock the @google/genai module
vi.mock('@google/genai', () => {
  // Use a class so `new GoogleGenAI()` works as a constructor
  class MockGoogleGenAI {
    models = {
      generateContent: mockGenerateContent,
      generateContentStream: vi.fn().mockReturnValue(
        (async function* () {
          yield { text: 'chunk1' };
          yield { text: 'chunk2' };
        })()
      ),
    };
  }
  return {
    GoogleGenAI: MockGoogleGenAI,
    Type: { STRING: 'STRING', OBJECT: 'OBJECT', ARRAY: 'ARRAY', BOOLEAN: 'BOOLEAN' },
  };
});

// Mock storageService
vi.mock('../../services/storageService', () => ({
  storageService: {
    getGeminiApiKey: vi.fn().mockResolvedValue('AIzaTestKey12345'),
    clearGeminiApiKey: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock dbService
vi.mock('../../services/dbService', () => ({
  dbService: {
    getGeminiApiKey: vi.fn().mockResolvedValue('AIzaTestKey12345'),
  },
}));

describe('geminiService', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { onLine: true });
    mockGenerateContent.mockResolvedValue({ text: 'mock response' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('generateText', () => {
    it('should return text from AI model', async () => {
      const { generateText } = await import('../../services/geminiService');
      const result = await generateText('test prompt', 'Balanced');
      expect(result).toBe('mock response');
    });

    it('should throw AbortError when signal is already aborted', async () => {
      const { generateText } = await import('../../services/geminiService');
      const controller = new AbortController();
      controller.abort();

      await expect(generateText('test prompt', 'Balanced', controller.signal)).rejects.toThrow(
        'Aborted'
      );
    });

    it('should throw when offline', async () => {
      vi.stubGlobal('navigator', { onLine: false });
      const { generateText } = await import('../../services/geminiService');

      await expect(generateText('test prompt', 'Balanced')).rejects.toThrow('OFFLINE');
    });
  });

  describe('generateJson', () => {
    it('should parse JSON response from AI model', async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({ name: 'Test Character' }),
      });

      const { generateJson } = await import('../../services/geminiService');
      const result = await generateJson<{ name: string }>('test prompt', 'Balanced', {
        type: 'OBJECT' as unknown as typeof Type.OBJECT,
        properties: { name: { type: 'STRING' as unknown as typeof Type.STRING } },
      });
      expect(result).toEqual({ name: 'Test Character' });
    });
  });

  describe('getPrompts', () => {
    it('should generate logline prompts with correct structure', async () => {
      const { getPrompts } = await import('../../services/geminiService');
      const result = getPrompts('logline', {
        lang: 'en',
        project: { title: 'My Story', outline: [{ title: 'Ch1' }] },
      });
      expect(result.prompt).toContain('My Story');
      expect(result.schema).toBeDefined();
    });

    it('should generate character profile prompts', async () => {
      const { getPrompts } = await import('../../services/geminiService');
      const result = getPrompts('characterProfile', {
        lang: 'de',
        concept: 'A brave knight',
      });
      expect(result.prompt).toContain('brave knight');
      expect(result.prompt).toContain('German');
    });

    it('should throw for unknown prompt type', async () => {
      const { getPrompts } = await import('../../services/geminiService');
      expect(() =>
        getPrompts(
          'unknownType' as unknown as Parameters<typeof getPrompts>[0],
          { lang: 'en' } as unknown as Parameters<typeof getPrompts>[1]
        )
      ).toThrow('Unknown prompt type');
    });
  });

  describe('getUserFriendlyGeminiError', () => {
    it('should handle various error types', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Failed to fetch'));

      const { generateText } = await import('../../services/geminiService');

      await expect(generateText('test', 'Balanced')).rejects.toThrow();
    });
  });

  describe('retry logic', () => {
    it('should handle API key invalidation on 401', async () => {
      mockGenerateContent.mockRejectedValue(
        Object.assign(new Error('api key not valid'), { status: 401 })
      );

      const { generateText } = await import('../../services/geminiService');

      await expect(generateText('test', 'Balanced')).rejects.toThrow();
    });
  });

  describe('checkConsistency', () => {
    it('should accept a signal parameter', async () => {
      const { checkConsistency } = await import('../../services/geminiService');
      const controller = new AbortController();
      controller.abort();

      await expect(
        checkConsistency(
          'char-1',
          [
            {
              id: 'char-1',
              name: 'Test',
              backstory: '',
              motivation: '',
              appearance: '',
              personalityTraits: '',
              flaws: '',
              notes: '',
              characterArc: '',
              relationships: '',
            },
          ],
          [],
          [],
          [],
          'Balanced',
          'en',
          controller.signal
        )
      ).rejects.toThrow();
    });
  });

  describe('analyzeAsCritic', () => {
    it('should accept a signal parameter', async () => {
      const { analyzeAsCritic } = await import('../../services/geminiService');
      const controller = new AbortController();
      controller.abort();

      await expect(
        analyzeAsCritic('sample text', 'Balanced', 'en', controller.signal)
      ).rejects.toThrow();
    });
  });
});
