import { describe, expect, it } from 'vitest';
import { resolveProviderFallbackChain } from '../../../services/ai/hybridFallback';

describe('resolveProviderFallbackChain', () => {
  it('returns single provider when no fallback is configured', () => {
    const result = resolveProviderFallbackChain({ provider: 'gemini' });
    expect(result).toEqual(['gemini']);
  });

  it('returns ollama+gemini fallback chain when ollama primary and fallback has gemini', () => {
    const result = resolveProviderFallbackChain({
      provider: 'ollama',
      fallbackProviders: ['gemini'],
    });
    expect(result).toEqual(['ollama', 'gemini']);
  });

  it('returns webllm+gemini fallback chain when webllm primary and fallback has gemini', () => {
    const result = resolveProviderFallbackChain({
      provider: 'webllm',
      fallbackProviders: ['gemini'],
    });
    expect(result).toEqual(['webllm', 'gemini']);
  });

  it('uses hybridFallbackChain when enabled', () => {
    const result = resolveProviderFallbackChain({
      provider: 'gemini',
      hybridFallbackEnabled: true,
      hybridFallbackChain: ['ollama', 'webllm'],
    });
    expect(result).toEqual(['gemini', 'ollama', 'webllm']);
  });

  it('deduplicates in hybrid chain when primary already in chain', () => {
    const result = resolveProviderFallbackChain({
      provider: 'gemini',
      hybridFallbackEnabled: true,
      hybridFallbackChain: ['gemini', 'ollama'],
    });
    expect(result).toEqual(['gemini', 'ollama']);
  });

  it('returns only primary when hybridFallbackEnabled but chain is empty', () => {
    const result = resolveProviderFallbackChain({
      provider: 'openai',
      hybridFallbackEnabled: true,
      hybridFallbackChain: [],
    });
    expect(result).toEqual(['openai']);
  });

  it('does not fall back when ollama primary without gemini in fallbackProviders', () => {
    const result = resolveProviderFallbackChain({
      provider: 'ollama',
      fallbackProviders: ['ollama'],
    });
    expect(result).toEqual(['ollama']);
  });
});
