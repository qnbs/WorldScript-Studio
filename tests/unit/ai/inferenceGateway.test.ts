/**
 * InferenceGateway unit tests.
 * QNBS-v3: DefaultInferenceGateway is a thin wrapper — tests focus on the contract
 * (delegation, isFallback shape, error propagation) rather than re-testing aiProviderService internals.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createInferenceGateway,
  DefaultInferenceGateway,
  type GenerateRequest,
  type InferenceGateway,
  inferenceGateway,
} from '../../../services/ai/inferenceGateway';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGenerateText = vi.fn();
const mockEmbedText = vi.fn();

vi.mock('../../../services/aiProviderService', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

// localEmbeddingService is lazily imported inside embed() — mock the module
vi.mock('../../../services/ai/localEmbeddingService', () => ({
  embedText: (...args: unknown[]) => mockEmbedText(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<GenerateRequest> = {}): GenerateRequest {
  return {
    prompt: 'Write a short story.',
    creativity: 'Balanced',
    options: {
      model: 'gemini-2.5-flash',
      provider: 'gemini',
      maxTokens: 1000,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DefaultInferenceGateway.generate
// ---------------------------------------------------------------------------

describe('DefaultInferenceGateway.generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateText.mockResolvedValue('Once upon a time…');
  });

  it('delegates to aiProviderService.generateText with correct args', async () => {
    const gw = new DefaultInferenceGateway();
    const req = makeRequest();
    await gw.generate(req);
    expect(mockGenerateText).toHaveBeenCalledWith(req.prompt, req.creativity, req.options);
  });

  it('returns GenerateResult with text, model, provider', async () => {
    const gw = new DefaultInferenceGateway();
    const result = await gw.generate(makeRequest());
    expect(result).toMatchObject({
      text: 'Once upon a time…',
      model: 'gemini-2.5-flash',
      provider: 'gemini',
      isFallback: false,
    });
  });

  it('defaults creativity to Balanced when omitted', async () => {
    const gw = new DefaultInferenceGateway();
    const req: GenerateRequest = {
      prompt: 'Hello',
      options: { model: 'gemini-2.5-flash', provider: 'gemini' },
    };
    await gw.generate(req);
    expect(mockGenerateText).toHaveBeenCalledWith('Hello', 'Balanced', expect.anything());
  });

  it('propagates errors from aiProviderService', async () => {
    mockGenerateText.mockRejectedValueOnce(new Error('Provider offline'));
    const gw = new DefaultInferenceGateway();
    await expect(gw.generate(makeRequest())).rejects.toThrow('Provider offline');
  });

  it('passes model and provider from options into result', async () => {
    mockGenerateText.mockResolvedValue('text');
    const gw = new DefaultInferenceGateway();
    const result = await gw.generate(
      makeRequest({
        options: { model: 'gpt-4o-mini', provider: 'openai', maxTokens: 500 },
      }),
    );
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.provider).toBe('openai');
  });

  it('isFallback is always false on success', async () => {
    const gw = new DefaultInferenceGateway();
    const result = await gw.generate(makeRequest());
    expect(result.isFallback).toBe(false);
  });

  it('handles empty string response gracefully', async () => {
    mockGenerateText.mockResolvedValue('');
    const gw = new DefaultInferenceGateway();
    const result = await gw.generate(makeRequest());
    expect(result.text).toBe('');
  });

  it('passes options object as-is to aiProviderService', async () => {
    const gw = new DefaultInferenceGateway();
    const opts = {
      model: 'gemini-2.5-flash' as const,
      provider: 'gemini' as const,
      maxTokens: 2048,
      systemPrompt: 'You are a novelist.',
    };
    await gw.generate({ prompt: 'p', options: opts });
    expect(mockGenerateText).toHaveBeenCalledWith('p', 'Balanced', opts);
  });

  it('forwards Imaginative creativity correctly', async () => {
    const gw = new DefaultInferenceGateway();
    await gw.generate(makeRequest({ creativity: 'Imaginative' }));
    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.any(String),
      'Imaginative',
      expect.anything(),
    );
  });

  it('forwards Focused creativity correctly', async () => {
    const gw = new DefaultInferenceGateway();
    await gw.generate(makeRequest({ creativity: 'Focused' }));
    expect(mockGenerateText).toHaveBeenCalledWith(expect.any(String), 'Focused', expect.anything());
  });
});

// ---------------------------------------------------------------------------
// DefaultInferenceGateway.embed
// ---------------------------------------------------------------------------

describe('DefaultInferenceGateway.embed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbedText.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it('delegates to localEmbeddingService.embedText', async () => {
    const gw = new DefaultInferenceGateway();
    await gw.embed({ text: 'hello world' });
    // embedText does not accept a signal (Phase 3 addition); called with text only
    expect(mockEmbedText).toHaveBeenCalledWith('hello world');
  });

  it('returns vector in EmbedResult', async () => {
    const gw = new DefaultInferenceGateway();
    const result = await gw.embed({ text: 'test' });
    expect(result.vector).toEqual([0.1, 0.2, 0.3]);
  });

  it('accepts signal in EmbedRequest without forwarding (Phase 3 stub)', async () => {
    // embedText does not yet accept AbortSignal; the field is reserved for Phase 3.
    // Verify embed completes and calls embedText with the text only.
    const gw = new DefaultInferenceGateway();
    const controller = new AbortController();
    await gw.embed({ text: 'test', signal: controller.signal });
    expect(mockEmbedText).toHaveBeenCalledWith('test');
  });
});

// ---------------------------------------------------------------------------
// DefaultInferenceGateway.modelList / healthCheck (stubs)
// ---------------------------------------------------------------------------

// QNBS-v3: modelList() was a stub returning [] — now returns curated cloud + local models
describe('DefaultInferenceGateway modelList / healthCheck', () => {
  it('modelList returns a non-empty array of models', async () => {
    const gw = new DefaultInferenceGateway();
    const models = await gw.modelList();
    expect(models.length).toBeGreaterThan(0);
    // Each entry must have id, displayName, isLocal, and provider fields
    for (const m of models) {
      expect(m).toHaveProperty('id');
      expect(m).toHaveProperty('displayName');
      expect(m).toHaveProperty('isLocal');
      expect(m).toHaveProperty('provider');
    }
  });

  it('modelList includes at least one cloud and one local model', async () => {
    const gw = new DefaultInferenceGateway();
    const models = await gw.modelList();
    expect(models.some((m) => !m.isLocal)).toBe(true);
    expect(models.some((m) => m.isLocal)).toBe(true);
  });

  it('healthCheck returns ok or degraded status (embedding service may be unavailable in test)', async () => {
    const gw = new DefaultInferenceGateway();
    const health = await gw.healthCheck();
    expect(['ok', 'degraded', 'unavailable']).toContain(health.status);
  });
});

// ---------------------------------------------------------------------------
// Factory / singleton
// ---------------------------------------------------------------------------

describe('createInferenceGateway / singleton', () => {
  it('createInferenceGateway returns a new DefaultInferenceGateway', () => {
    const gw = createInferenceGateway();
    expect(gw).toBeInstanceOf(DefaultInferenceGateway);
  });

  it('createInferenceGateway returns distinct instances', () => {
    const a = createInferenceGateway();
    const b = createInferenceGateway();
    expect(a).not.toBe(b);
  });

  it('inferenceGateway singleton is a DefaultInferenceGateway', () => {
    expect(inferenceGateway).toBeInstanceOf(DefaultInferenceGateway);
  });
});

// ---------------------------------------------------------------------------
// InferenceGateway interface compliance (mock implementation)
// ---------------------------------------------------------------------------

describe('InferenceGateway interface — mock implementation', () => {
  it('accepts any class that implements the interface', async () => {
    const mock: InferenceGateway = {
      generate: vi
        .fn()
        .mockResolvedValue({ text: 'ok', model: 'm', provider: 'p', isFallback: false }),
      embed: vi.fn().mockResolvedValue({ vector: [] }),
      modelList: vi.fn().mockResolvedValue([]),
      healthCheck: vi.fn().mockResolvedValue({ status: 'ok', provider: 'p' }),
    };

    const result = await mock.generate(makeRequest());
    expect(result.text).toBe('ok');
    expect(mock.generate).toHaveBeenCalledTimes(1);
  });
});
