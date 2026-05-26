/**
 * Tests for services/ai/hybridFallback.ts
 * QNBS-v3: Pure function — resolveProviderFallbackChain covers all branches.
 */

import { describe, expect, it } from 'vitest';
import { resolveProviderFallbackChain } from '../../../services/ai/hybridFallback';

describe('resolveProviderFallbackChain', () => {
  it('returns [provider] when no fallback config is set', () => {
    expect(resolveProviderFallbackChain({ provider: 'gemini' })).toEqual(['gemini']);
  });

  it('returns [provider] when hybridFallbackEnabled is false', () => {
    expect(
      resolveProviderFallbackChain({
        provider: 'openai',
        hybridFallbackEnabled: false,
        hybridFallbackChain: ['gemini', 'ollama'],
      }),
    ).toEqual(['openai']);
  });

  it('returns [provider] when hybridFallbackChain is empty', () => {
    expect(
      resolveProviderFallbackChain({
        provider: 'gemini',
        hybridFallbackEnabled: true,
        hybridFallbackChain: [],
      }),
    ).toEqual(['gemini']);
  });

  it('uses hybridFallbackChain when enabled and non-empty', () => {
    expect(
      resolveProviderFallbackChain({
        provider: 'openai',
        hybridFallbackEnabled: true,
        hybridFallbackChain: ['gemini', 'ollama'],
      }),
    ).toEqual(['openai', 'gemini', 'ollama']);
  });

  it('deduplicates providers when primary is already in chain', () => {
    expect(
      resolveProviderFallbackChain({
        provider: 'gemini',
        hybridFallbackEnabled: true,
        hybridFallbackChain: ['gemini', 'openai'],
      }),
    ).toEqual(['gemini', 'openai']);
  });

  it('falls back ollama → gemini when fallbackProviders includes gemini', () => {
    expect(
      resolveProviderFallbackChain({
        provider: 'ollama',
        fallbackProviders: ['gemini'],
      }),
    ).toEqual(['ollama', 'gemini']);
  });

  it('falls back webllm → gemini when fallbackProviders includes gemini', () => {
    expect(
      resolveProviderFallbackChain({
        provider: 'webllm',
        fallbackProviders: ['gemini'],
      }),
    ).toEqual(['webllm', 'gemini']);
  });

  it('does not add gemini fallback for ollama when gemini not in fallbackProviders', () => {
    expect(
      resolveProviderFallbackChain({
        provider: 'ollama',
        fallbackProviders: ['openai'],
      }),
    ).toEqual(['ollama']);
  });

  it('hybridFallbackChain takes precedence over ollama→gemini fallback', () => {
    const result = resolveProviderFallbackChain({
      provider: 'ollama',
      hybridFallbackEnabled: true,
      hybridFallbackChain: ['openai', 'gemini'],
      fallbackProviders: ['gemini'],
    });
    expect(result).toEqual(['ollama', 'openai', 'gemini']);
  });
});
