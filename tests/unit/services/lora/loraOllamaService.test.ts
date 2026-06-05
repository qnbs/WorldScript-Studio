import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../app/store', () => ({
  appStoreRef: {
    current: {
      getState: () => ({
        settings: {
          localAi: {
            ollamaBaseUrl: 'http://custom-ollama:11434',
          },
        },
      }),
    },
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loraOllamaService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('AbortSignal', {
      timeout: vi.fn().mockReturnValue(new AbortController().signal),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('generateModelfile', () => {
    it('generates correct modelfile content', async () => {
      const { generateModelfile } = await import('../../../../services/lora/loraOllamaService');

      const result = generateModelfile('llama3', '/path/to/adapter.gguf', 'MyAssistant');

      expect(result).toContain('FROM llama3');
      expect(result).toContain('ADAPTER /path/to/adapter.gguf');
      expect(result).toContain('SYSTEM "You are MyAssistant');
    });

    it('handles special characters in assistant name', async () => {
      const { generateModelfile } = await import('../../../../services/lora/loraOllamaService');

      const result = generateModelfile('mistral', './adapter.Q4_K_M.gguf', 'Story Helper');

      expect(result).toContain('FROM mistral');
      expect(result).toContain('ADAPTER ./adapter.Q4_K_M.gguf');
      expect(result).toContain('SYSTEM "You are Story Helper');
    });
  });

  describe('listOllamaModels', () => {
    it('returns models from successful API response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () =>
            Promise.resolve({
              models: [
                { name: 'llama3', size: 123456789, digest: 'abc123' },
                { name: 'mistral', size: 987654321, digest: 'def456' },
              ],
            }),
        }),
      );

      const { listOllamaModels } = await import('../../../../services/lora/loraOllamaService');
      const result = await listOllamaModels();

      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe('llama3');
      expect(result[1]?.name).toBe('mistral');
    });

    it('returns empty array on non-ok response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
        }),
      );

      const { listOllamaModels } = await import('../../../../services/lora/loraOllamaService');
      const result = await listOllamaModels();

      expect(result).toEqual([]);
    });

    it('returns empty array on fetch error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const { listOllamaModels } = await import('../../../../services/lora/loraOllamaService');
      const result = await listOllamaModels();

      expect(result).toEqual([]);
    });

    it('uses custom baseUrl when provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const { listOllamaModels } = await import('../../../../services/lora/loraOllamaService');
      await listOllamaModels('http://custom:11434');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('http://custom:11434/api/tags'),
        expect.any(Object),
      );
    });
  });

  describe('createOllamaModelFromAdapter', () => {
    it('creates model successfully with streaming response', async () => {
      const mockReader = {
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('{"status":"pulling"}\n'),
          })
          .mockResolvedValueOnce({
            done: false,
            value: new TextEncoder().encode('{"status":"done"}\n'),
          })
          .mockResolvedValueOnce({ done: true }),
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          body: { getReader: () => mockReader },
        }),
      );

      const { createOllamaModelFromAdapter } = await import(
        '../../../../services/lora/loraOllamaService'
      );

      await expect(
        createOllamaModelFromAdapter('llama3', '/adapter.gguf', 'test-model'),
      ).resolves.toBeUndefined();
    });

    it('throws on non-ok response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: () => Promise.resolve('Invalid modelfile'),
        }),
      );

      const { createOllamaModelFromAdapter } = await import(
        '../../../../services/lora/loraOllamaService'
      );

      await expect(
        createOllamaModelFromAdapter('llama3', '/adapter.gguf', 'test-model'),
      ).rejects.toThrow('Ollama create failed (400)');
    });

    it('throws on error in streaming response', async () => {
      const mockReader = {
        read: vi.fn().mockResolvedValue({
          done: false,
          value: new TextEncoder().encode('{"error":"model not found"}\n'),
        }),
      };

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          body: { getReader: () => mockReader },
        }),
      );

      const { createOllamaModelFromAdapter } = await import(
        '../../../../services/lora/loraOllamaService'
      );

      await expect(
        createOllamaModelFromAdapter('llama3', '/adapter.gguf', 'test-model'),
      ).rejects.toThrow('Ollama error: model not found');
    });
  });
});
