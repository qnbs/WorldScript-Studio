import type { Type } from '@google/genai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGenerateContent = vi.fn().mockResolvedValue({ text: 'mock response' });
// QNBS-v3: Hoisted so each test can set a fresh async generator before calling streamText/streamAiHelpResponse.
const mockGenerateContentStream = vi.fn();

// Mock the @google/genai module
vi.mock('@google/genai', () => {
  // Use a class so `new GoogleGenAI()` works as a constructor
  class MockGoogleGenAI {
    models = {
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream,
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
  function makeStream(...texts: string[]) {
    return (async function* () {
      for (const t of texts) yield { text: t };
    })();
  }

  beforeEach(() => {
    vi.stubGlobal('navigator', { onLine: true });
    mockGenerateContent.mockResolvedValue({ text: 'mock response' });
    mockGenerateContentStream.mockReturnValue(makeStream('chunk1', 'chunk2'));
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
        'Aborted',
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
        type: 'OBJECT' as unknown as Type,
        properties: { name: { type: 'STRING' as unknown as Type } },
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
          { lang: 'en' } as unknown as Parameters<typeof getPrompts>[1],
        ),
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
        Object.assign(new Error('api key not valid'), { status: 401 }),
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
          controller.signal,
        ),
      ).rejects.toThrow();
    });
  });

  describe('analyzeAsCritic', () => {
    it('should accept a signal parameter', async () => {
      const { analyzeAsCritic } = await import('../../services/geminiService');
      const controller = new AbortController();
      controller.abort();

      await expect(
        analyzeAsCritic('sample text', 'Balanced', 'en', controller.signal),
      ).rejects.toThrow();
    });
  });

  describe('detectPlotHoles', () => {
    it('returns plot-hole analysis text', async () => {
      mockGenerateContent.mockResolvedValue({ text: 'Plot hole: X is unresolved.' });
      const { detectPlotHoles } = await import('../../services/geminiService');
      const result = await detectPlotHoles('manuscript text', 'Balanced', 'en');
      expect(result).toBe('Plot hole: X is unresolved.');
    });

    it('throws when aborted', async () => {
      const { detectPlotHoles } = await import('../../services/geminiService');
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(detectPlotHoles('text', 'Balanced', 'en', ctrl.signal)).rejects.toThrow();
    });
  });

  describe('handleInvalidApiKey', () => {
    it('clears the api key from storage', async () => {
      const { storageService } = await import('../../services/storageService');
      const { handleInvalidApiKey } = await import('../../services/geminiService');
      await handleInvalidApiKey();
      expect(storageService.clearGeminiApiKey).toHaveBeenCalled();
    });

    it('does not throw when clearGeminiApiKey fails', async () => {
      const { storageService } = await import('../../services/storageService');
      vi.mocked(storageService.clearGeminiApiKey).mockRejectedValueOnce(new Error('IDB error'));
      const { handleInvalidApiKey } = await import('../../services/geminiService');
      await expect(handleInvalidApiKey()).resolves.toBeUndefined();
    });
  });

  describe('invalidateAiClientCache', () => {
    it('does not throw', async () => {
      const { invalidateAiClientCache } = await import('../../services/geminiService');
      expect(() => invalidateAiClientCache()).not.toThrow();
    });
  });

  describe('streamText', () => {
    it('calls onChunk for each yielded chunk', async () => {
      mockGenerateContentStream.mockReturnValue(makeStream('hello ', 'world'));
      const { streamText } = await import('../../services/geminiService');
      const chunks: string[] = [];
      await streamText('prompt', 'Balanced', (c) => chunks.push(c));
      expect(chunks).toEqual(['hello ', 'world']);
    });

    it('throws AbortError when signal is already aborted', async () => {
      const { streamText } = await import('../../services/geminiService');
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(streamText('prompt', 'Balanced', vi.fn(), ctrl.signal)).rejects.toThrow(
        'Aborted',
      );
    });

    it('throws when offline', async () => {
      vi.stubGlobal('navigator', { onLine: false });
      const { streamText } = await import('../../services/geminiService');
      await expect(streamText('prompt', 'Balanced', vi.fn())).rejects.toThrow('OFFLINE');
    });

    it('wraps non-AbortErrors and logs them', async () => {
      mockGenerateContentStream.mockImplementation(() => {
        throw new Error('Stream broken');
      });
      const { streamText } = await import('../../services/geminiService');
      await expect(streamText('prompt', 'Balanced', vi.fn())).rejects.toThrow('Stream broken');
    });

    it('passes a custom model name when provided', async () => {
      mockGenerateContentStream.mockReturnValue(makeStream('ok'));
      const { streamText } = await import('../../services/geminiService');
      await streamText('prompt', 'Focused', vi.fn(), undefined, 'gemini-custom');
      expect(mockGenerateContentStream).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-custom' }),
      );
    });
  });

  describe('streamAiHelpResponse', () => {
    it('calls onChunk with streamed chunks', async () => {
      mockGenerateContentStream.mockReturnValue(makeStream('Answer: ', '42'));
      const { streamAiHelpResponse } = await import('../../services/geminiService');
      const chunks: string[] = [];
      await streamAiHelpResponse('What is the answer?', (c) => chunks.push(c), 0.7);
      expect(chunks).toEqual(['Answer: ', '42']);
    });

    it('throws AbortError when aborted before stream', async () => {
      const { streamAiHelpResponse } = await import('../../services/geminiService');
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(streamAiHelpResponse('question', vi.fn(), 0.5, ctrl.signal)).rejects.toThrow(
        'Aborted',
      );
    });

    it('throws when offline', async () => {
      vi.stubGlobal('navigator', { onLine: false });
      const { streamAiHelpResponse } = await import('../../services/geminiService');
      await expect(streamAiHelpResponse('q', vi.fn(), 0.7)).rejects.toThrow('OFFLINE');
    });
  });

  describe('generateImage', () => {
    it('returns base64 inline data from the first image part', async () => {
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: 'base64imagedata' } }],
            },
          },
        ],
      });
      const { generateImage } = await import('../../services/geminiService');
      const result = await generateImage('a sunset over mountains');
      expect(result).toBe('base64imagedata');
    });

    it('throws when no image part is returned', async () => {
      mockGenerateContent.mockResolvedValue({ candidates: [{ content: { parts: [] } }] });
      const { generateImage } = await import('../../services/geminiService');
      await expect(generateImage('prompt')).rejects.toThrow('No image was generated.');
    });

    it('throws AbortError when signal is already aborted', async () => {
      const { generateImage } = await import('../../services/geminiService');
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(generateImage('prompt', ctrl.signal)).rejects.toThrow('Aborted');
    });

    it('throws when offline', async () => {
      vi.stubGlobal('navigator', { onLine: false });
      const { generateImage } = await import('../../services/geminiService');
      await expect(generateImage('prompt')).rejects.toThrow('OFFLINE');
    });
  });
});
