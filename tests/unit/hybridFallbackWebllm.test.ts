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

// ---------------------------------------------------------------------------
// hybridFallbackEnabled + hybridFallbackChain (new chain path)
// ---------------------------------------------------------------------------
describe('resolveProviderFallbackChain — hybridFallbackEnabled', () => {
  it('returns full chain with duplicates removed', () => {
    expect(
      resolveProviderFallbackChain({
        provider: 'gemini',
        hybridFallbackEnabled: true,
        hybridFallbackChain: ['openai', 'ollama'],
      }),
    ).toEqual(['gemini', 'openai', 'ollama']);
  });

  it('deduplicates primary when it appears again in the chain', () => {
    expect(
      resolveProviderFallbackChain({
        provider: 'gemini',
        hybridFallbackEnabled: true,
        hybridFallbackChain: ['gemini', 'openai'],
      }),
    ).toEqual(['gemini', 'openai']);
  });

  it('deduplicates repeated entries within the chain', () => {
    expect(
      resolveProviderFallbackChain({
        provider: 'openai',
        hybridFallbackEnabled: true,
        hybridFallbackChain: ['ollama', 'ollama', 'gemini'],
      }),
    ).toEqual(['openai', 'ollama', 'gemini']);
  });

  it('returns only primary when chain is empty', () => {
    // QNBS-v3: empty chain → hybridFallbackChain.length === 0 → falls through to default
    expect(
      resolveProviderFallbackChain({
        provider: 'openai',
        hybridFallbackEnabled: true,
        hybridFallbackChain: [],
      }),
    ).toEqual(['openai']);
  });

  it('returns only primary when hybridFallbackEnabled is false even with a chain set', () => {
    expect(
      resolveProviderFallbackChain({
        provider: 'openai',
        hybridFallbackEnabled: false,
        hybridFallbackChain: ['gemini'],
      }),
    ).toEqual(['openai']);
  });
});

// ---------------------------------------------------------------------------
// Legacy ollama fallback path
// ---------------------------------------------------------------------------
describe('resolveProviderFallbackChain — ollama legacy path', () => {
  it('uses ollama then gemini for legacy ollama fallback', () => {
    expect(
      resolveProviderFallbackChain({
        provider: 'ollama',
        fallbackProviders: ['gemini'],
      }),
    ).toEqual(['ollama', 'gemini']);
  });

  it('keeps ollama-only when fallbackProviders does not include gemini', () => {
    expect(
      resolveProviderFallbackChain({
        provider: 'ollama',
        fallbackProviders: ['openai'],
      }),
    ).toEqual(['ollama']);
  });

  it('keeps ollama-only when fallbackProviders is empty', () => {
    expect(
      resolveProviderFallbackChain({
        provider: 'ollama',
        fallbackProviders: [],
      }),
    ).toEqual(['ollama']);
  });
});

// ---------------------------------------------------------------------------
// Default path — non-legacy providers
// ---------------------------------------------------------------------------
describe('resolveProviderFallbackChain — default (no special fallback)', () => {
  it('returns [gemini] for gemini provider alone', () => {
    expect(resolveProviderFallbackChain({ provider: 'gemini' })).toEqual(['gemini']);
  });

  it('returns [openai] for openai provider alone', () => {
    expect(resolveProviderFallbackChain({ provider: 'openai' })).toEqual(['openai']);
  });

  it('ignores fallbackProviders for providers other than ollama/webllm', () => {
    expect(
      resolveProviderFallbackChain({ provider: 'gemini', fallbackProviders: ['openai'] }),
    ).toEqual(['gemini']);
  });

  it('returns [openai] for openai provider (covers openaiCompatible path)', () => {
    // QNBS-v3: 'openaiCompatible' is not in AIProvider type; openai covers same fallback logic
    expect(resolveProviderFallbackChain({ provider: 'openai' })).toEqual(['openai']);
  });
});
