import { describe, expect, it } from 'vitest';
import { resolveProviderFallbackChain } from '../../services/ai/hybridFallback';

describe('resolveProviderFallbackChain (webllm)', () => {
  it('uses webllm then gemini when legacy ollama-style fallback lists gemini', () => {
    expect(
      resolveProviderFallbackChain({
        provider: 'webllm',
        fallbackProviders: ['gemini'],
      }),
    ).toEqual(['webllm', 'gemini']);
  });

  it('keeps primary-only when hybrid disabled and no legacy fallback', () => {
    expect(
      resolveProviderFallbackChain({
        provider: 'webllm',
      }),
    ).toEqual(['webllm']);
  });
});
