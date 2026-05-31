import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultInferenceGateway, type GenerateRequest } from '../../services/ai/inferenceGateway';
import * as aiProviderService from '../../services/aiProviderService';

// QNBS-v3: Mock dependencies to avoid heavy imports in unit tests.
vi.mock('../../services/aiProviderService', () => ({
  generateText: vi.fn(),
}));

vi.mock('../../services/ai/localEmbeddingService', () => ({
  embedText: vi.fn(),
}));

vi.mock('@domain/ai-core', async () => {
  const actual = await vi.importActual<typeof import('@domain/ai-core')>('@domain/ai-core');
  return {
    ...actual,
  };
});

describe('DefaultInferenceGateway', () => {
  let gateway: DefaultInferenceGateway;

  beforeEach(() => {
    gateway = new DefaultInferenceGateway();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generate', () => {
    it('delegates to aiProviderService.generateText and returns result', async () => {
      vi.mocked(aiProviderService.generateText).mockResolvedValue('Hello from AI');

      const request: GenerateRequest = {
        prompt: 'Test prompt',
        options: { provider: 'gemini', model: 'gemini-2.5-flash' },
      };

      const result = await gateway.generate(request);

      expect(result.text).toBe('Hello from AI');
      expect(result.provider).toBe('gemini');
      expect(result.model).toBe('gemini-2.5-flash');
      expect(result.isFallback).toBe(false);
    });

    it('passes creativity temperature through', async () => {
      vi.mocked(aiProviderService.generateText).mockResolvedValue('Creative text');

      const request: GenerateRequest = {
        prompt: 'Creative prompt',
        creativity: 'Imaginative',
        options: { provider: 'gemini', model: 'gemini-2.5-flash' },
      };

      await gateway.generate(request);

      expect(aiProviderService.generateText).toHaveBeenCalledWith(
        'Creative prompt',
        'Imaginative',
        expect.objectContaining({ provider: 'gemini', model: 'gemini-2.5-flash' }),
      );
    });
  });

  describe('modelList', () => {
    it('returns cloud + local models with correct structure', async () => {
      const models = await gateway.modelList();

      expect(models.length).toBeGreaterThan(0);

      // Cloud models
      const gemini = models.find((m) => m.provider === 'gemini');
      expect(gemini).toBeDefined();
      expect(gemini?.isLocal).toBe(false);

      // Local models
      const webllmModels = models.filter((m) => m.provider === 'webllm');
      expect(webllmModels.length).toBeGreaterThan(0);
      expect(webllmModels[0]?.isLocal).toBe(true);

      const onnxModels = models.filter((m) => m.provider === 'onnx');
      expect(onnxModels.length).toBeGreaterThan(0);
      expect(onnxModels[0]?.isLocal).toBe(true);
    });
  });

  describe('healthCheck', () => {
    it('returns ok when embedding service works', async () => {
      const { embedText } = await import('../../services/ai/localEmbeddingService');
      vi.mocked(embedText).mockResolvedValue(new Float32Array([0.1, 0.2, 0.3]));

      const health = await gateway.healthCheck();

      expect(health.status).toBe('ok');
      expect(health.provider).toBe('local-embedding');
      expect(health.latencyMs).toBeDefined();
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns degraded when embedding service fails', async () => {
      const { embedText } = await import('../../services/ai/localEmbeddingService');
      vi.mocked(embedText).mockRejectedValue(new Error('Embedding failed'));

      const health = await gateway.healthCheck();

      expect(health.status).toBe('degraded');
      expect(health.provider).toBe('local-embedding');
    });
  });
});
