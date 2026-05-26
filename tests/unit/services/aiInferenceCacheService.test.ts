/**
 * Tests for services/ai/aiInferenceCacheService.ts
 * QNBS-v3: In-memory LRU path only (IDB not available in node test env).
 *          Tests: cache miss returns null, set+get roundtrip, long prompt skip, key isolation.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('aiInferenceCacheService', () => {
  let aiInferenceCacheService: typeof import('../../../services/ai/aiInferenceCacheService').aiInferenceCacheService;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../../services/ai/aiInferenceCacheService');
    aiInferenceCacheService = mod.aiInferenceCacheService;
  });

  it('returns null for uncached prompt', async () => {
    const result = await aiInferenceCacheService.getCachedInference('Hello world', 'gemini');
    expect(result).toBeNull();
  });

  it('returns cached result after setCachedInference', async () => {
    await aiInferenceCacheService.setCachedInference('Short prompt', 'gemini', 'AI response');
    const result = await aiInferenceCacheService.getCachedInference('Short prompt', 'gemini');
    expect(result).toBe('AI response');
  });

  it('separates cache by modelId', async () => {
    await aiInferenceCacheService.setCachedInference('Same prompt', 'gemini', 'gemini response');
    const otherResult = await aiInferenceCacheService.getCachedInference('Same prompt', 'openai');
    expect(otherResult).toBeNull();
  });

  it('skips caching for prompts longer than 512 chars', async () => {
    const longPrompt = 'a'.repeat(513);
    await aiInferenceCacheService.setCachedInference(longPrompt, 'gemini', 'should not be cached');
    const result = await aiInferenceCacheService.getCachedInference(longPrompt, 'gemini');
    expect(result).toBeNull();
  });

  it('caches exactly 512-char prompt', async () => {
    const exactPrompt = 'b'.repeat(512);
    await aiInferenceCacheService.setCachedInference(exactPrompt, 'gemini', 'cached');
    const result = await aiInferenceCacheService.getCachedInference(exactPrompt, 'gemini');
    expect(result).toBe('cached');
  });

  it('different prompts have different cache entries', async () => {
    await aiInferenceCacheService.setCachedInference('Prompt A', 'gemini', 'Response A');
    await aiInferenceCacheService.setCachedInference('Prompt B', 'gemini', 'Response B');
    expect(await aiInferenceCacheService.getCachedInference('Prompt A', 'gemini')).toBe(
      'Response A',
    );
    expect(await aiInferenceCacheService.getCachedInference('Prompt B', 'gemini')).toBe(
      'Response B',
    );
  });
});
